-- Expand only. Existing IDs and optimizer-facing bundle identities remain valid.
create schema if not exists ingestion;
revoke all on schema ingestion from public, anon, authenticated;

create table ingestion.import_runs (
    id uuid primary key default gen_random_uuid(),
    source text not null,
    term text,
    parser_version text not null,
    status text not null default 'running' check (status in ('running','completed','failed')),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    summary jsonb not null default '{}'
);
create table ingestion.source_snapshots (
    run_id uuid not null references ingestion.import_runs(id) on delete cascade,
    source_key text not null,
    payload jsonb not null,
    checksum text not null,
    fetched_at timestamptz not null,
    primary key (run_id, source_key)
);
alter table ingestion.import_runs enable row level security;
alter table ingestion.source_snapshots enable row level security;
grant usage on schema ingestion to service_role;
grant select, insert, update on ingestion.import_runs, ingestion.source_snapshots to service_role;

create table public.course_aliases (
    course_id text not null references public.courses(id) on delete cascade,
    code text not null check (code = upper(btrim(code)) and length(code) between 3 and 100),
    source text not null,
    observed_at timestamptz not null default now(),
    primary key (course_id, code)
);
create index course_aliases_code_idx on public.course_aliases(code text_pattern_ops);
alter table public.course_aliases enable row level security;
grant select on public.course_aliases to authenticated;
grant all on public.course_aliases to service_role;
create policy course_aliases_read on public.course_aliases for select to authenticated using (true);

create table public.course_offerings (
    term text not null references public.terms(id),
    course_id text not null references public.courses(id),
    title text,
    credit_options integer[] not null,
    breadth text[],
    repeatable boolean not null,
    source text not null,
    fetched_at timestamptz,
    snapshot_kind text not null check (snapshot_kind in ('imported','legacy_backfill')),
    primary key (term, course_id)
);
create index course_offerings_course_idx on public.course_offerings(course_id);
alter table public.course_offerings enable row level security;
grant select on public.course_offerings to authenticated;
grant all on public.course_offerings to service_role;
create policy course_offerings_read on public.course_offerings for select to authenticated using (true);

create function private.capture_course_aliases()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if tg_table_name = 'courses' then
        insert into public.course_aliases(course_id,code,source,observed_at)
        values(new.id,upper(btrim(new.code)),new.source,coalesce(new.fetched_at,now()))
        on conflict(course_id,code) do update set observed_at=greatest(course_aliases.observed_at,excluded.observed_at);
    else
        insert into public.course_aliases(course_id,code,source,observed_at)
        select new.course_id,upper(btrim(a)),new.source_url,new.fetched_at
        from unnest(coalesce(new.course_aliases,'{}')) a where length(btrim(a)) between 3 and 100
        on conflict(course_id,code) do update set observed_at=greatest(course_aliases.observed_at,excluded.observed_at);
    end if;
    return new;
end;
$$;
revoke all on function private.capture_course_aliases() from public,anon,authenticated;
create trigger courses_capture_aliases after insert or update of code on public.courses
    for each row execute function private.capture_course_aliases();
create trigger requisites_capture_aliases after insert or update of course_aliases on public.course_requisites
    for each row execute function private.capture_course_aliases();

create view public.catalog_courses with(security_invoker=true) as
select c.*, coalesce(a.aliases,array[c.code]) as aliases,
    case when cardinality(a.aliases)>1 and not exists(
        select from unnest(a.aliases) x where substring(x from '[0-9]+[A-Z]?$') is distinct from substring(c.code from '[0-9]+[A-Z]?$')
    ) then (select string_agg(replace(regexp_replace(x,' [0-9]+[A-Z]?$',''),'COMP SCI','CS'),'/' order by (x=c.code) desc,x)
        from unnest(a.aliases) x) || ' ' || substring(c.code from '[0-9]+[A-Z]?$')
    else replace(c.code,'COMP SCI ','CS ') end as display_code
from public.courses c
left join lateral(select array_agg(code order by (code=c.code) desc,code) aliases from public.course_aliases where course_id=c.id) a on true;
grant select on public.catalog_courses to authenticated,service_role;

create function public.search_catalog_courses(p_query text,p_limit integer default 20)
returns setof public.catalog_courses language sql stable security invoker set search_path = '' as $$
    with q as(select regexp_replace(regexp_replace(upper(btrim(p_query)),'^CS[[:space:]]*([0-9]|$)','COMP SCI \1'),'[[:space:]]+',' ','g') needle)
    select c.* from public.catalog_courses c cross join q
    where length(q.needle)>=2 and (c.code ilike '%'||replace(replace(q.needle,'%','\%'),'_','\_')||'%'
        or exists(select from unnest(c.aliases) a where a ilike '%'||replace(replace(q.needle,'%','\%'),'_','\_')||'%'))
    order by (q.needle=any(c.aliases)) desc,c.code,c.id limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.search_catalog_courses(text,integer) from public,anon;
grant execute on function public.search_catalog_courses(text,integer) to authenticated;

-- A single instructor read interface; raw rows outside planner coverage stay available.
create view public.catalog_instructors with(security_invoker=true) as
select term,course_id,bundle_id,instructors,source_url,fetched_at from public.course_instructors
union all
select s.term,s.course_id,s.bundle_id,s.instructors,s.source_url,s.fetched_at
from public.course_instructors_source_only s
where not exists(select from public.course_instructors i where (i.term,i.course_id,i.bundle_id)=(s.term,s.course_id,s.bundle_id));
grant select on public.catalog_instructors to authenticated,service_role;

create function private.sync_bundle_instructors()
returns trigger language plpgsql security definer set search_path='' as $$
begin
    update public.section_bundles set instructors=new.instructors
    where(term,course_id,bundle_id)=(new.term,new.course_id,new.bundle_id);
    return new;
end;
$$;
revoke all on function private.sync_bundle_instructors() from public,anon,authenticated;
create trigger instructors_sync_bundle after insert or update on public.course_instructors
    for each row execute function private.sync_bundle_instructors();
comment on column public.section_bundles.instructors is 'Compatibility display cache; course_instructors is authoritative for imported names.';
