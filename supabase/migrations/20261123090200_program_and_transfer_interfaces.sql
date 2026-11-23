create table public.program_versions (
    id text primary key,
    kind text not null check(kind in('major','minor','certificate')),
    program_id uuid unique references public.academic_programs(id),
    supplemental_program_key text,
    catalog_year integer not null,
    college_id uuid references public.colleges(id),
    name text not null,
    source_url text,
    fetched_at timestamptz,
    foreign key(catalog_year,supplemental_program_key) references public.supplemental_program_catalog(catalog_year,program_key),
    check((kind='major' and program_id is not null and supplemental_program_key is null)
        or(kind in('minor','certificate') and program_id is null and supplemental_program_key is not null))
);
create table public.requirement_groups (
    id text primary key,
    program_version_id text not null references public.program_versions(id) on delete cascade,
    position integer not null check(position>0),
    heading text not null,
    definition jsonb not null check(jsonb_typeof(definition)='object'),
    source_url text,
    fetched_at timestamptz,
    unique(program_version_id,position)
);
alter table public.program_versions enable row level security;
alter table public.requirement_groups enable row level security;
grant select on public.program_versions,public.requirement_groups to authenticated;
grant all on public.program_versions,public.requirement_groups to service_role;
create policy program_versions_read on public.program_versions for select to authenticated using(true);
create policy requirement_groups_read on public.requirement_groups for select to authenticated using(true);

create function private.refresh_program_version(p_id text)
returns void language plpgsql security definer set search_path='' as $$
declare v record;
begin
    select * into v from(
        select 'major:'||p.id::text id,'major'::text kind,p.id program_id,null::text supplemental_program_key,
            p.catalog_year,p.college_id,p.label name,r.source_url,r.fetched_at,coalesce(r.course_groups,'[]'::jsonb) groups
        from public.academic_programs p left join public.program_requirement_catalog r on r.program_id=p.id
        union all
        select 'supplemental:'||p.catalog_year||':'||p.program_key,p.kind,null::uuid,p.program_key,p.catalog_year,
            null::uuid,p.name,p.source_url,p.fetched_at,p.course_groups from public.supplemental_program_catalog p
    ) x where x.id=p_id;
    if not found then return; end if;
    insert into public.program_versions(id,kind,program_id,supplemental_program_key,catalog_year,college_id,name,source_url,fetched_at)
    values(v.id,v.kind,v.program_id,v.supplemental_program_key,v.catalog_year,v.college_id,v.name,v.source_url,v.fetched_at)
    on conflict(id) do update set name=excluded.name,source_url=excluded.source_url,fetched_at=excluded.fetched_at;
    -- This is a versioned read model, not the storage for student observations.
    delete from public.requirement_groups where program_version_id=v.id;
    insert into public.requirement_groups(id,program_version_id,position,heading,definition,source_url,fetched_at)
    select md5(v.id||'/'||g.ordinality||'/'||coalesce(g.value->>'heading','Requirements')),v.id,g.ordinality,
        coalesce(g.value->>'heading','Requirements'),g.value,v.source_url,v.fetched_at
    from jsonb_array_elements(v.groups) with ordinality g(value,ordinality);
end;
$$;
revoke all on function private.refresh_program_version(text) from public,anon,authenticated;
create function private.refresh_program_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
    if tg_table_name='academic_programs' then
        perform private.refresh_program_version('major:'||new.id::text);
    elsif tg_table_name='program_requirement_catalog' then
        perform private.refresh_program_version('major:'||new.program_id::text);
    else
        perform private.refresh_program_version('supplemental:'||new.catalog_year||':'||new.program_key);
    end if;
    return new;
end;
$$;
revoke all on function private.refresh_program_trigger() from public,anon,authenticated;
create trigger programs_refresh_version after insert or update on public.academic_programs for each row execute function private.refresh_program_trigger();
create trigger requirements_refresh_version after insert or update on public.program_requirement_catalog for each row execute function private.refresh_program_trigger();
create trigger supplemental_refresh_version after insert or update on public.supplemental_program_catalog for each row execute function private.refresh_program_trigger();

-- A single owner-filtered program interface, backed by existing write paths.
create view public.student_programs with(security_invoker=true) as
select 'primary:'||p.user_id::text id,p.user_id,'major:'||p.program_id::text program_version_id,true is_primary,
    'major'::text kind,v.name,v.catalog_year,v.source_url,p.program_id
from public.academic_profiles p join public.program_versions v on v.id='major:'||p.program_id::text
union all
select p.id::text,p.user_id,v.id,false,p.kind,v.name,v.catalog_year,v.source_url,p.program_id
from public.academic_profile_programs p join public.program_versions v on v.id=case
    when p.kind='major' then 'major:'||p.program_id::text
    else 'supplemental:'||p.catalog_year||':'||p.supplemental_program_key end;
grant select on public.student_programs to authenticated,service_role;

create function private.check_primary_program_duplicate()
returns trigger language plpgsql set search_path='' as $$
begin
    if tg_table_name='academic_profiles' then
        if exists(select from public.academic_profile_programs where user_id=new.user_id and program_id=new.program_id) then
            raise exception 'This program is already in your profile.' using errcode='23505';
        end if;
    elsif new.kind='major' then
        perform user_id from public.academic_profiles where user_id=new.user_id for no key update;
        if exists(select from public.academic_profiles where user_id=new.user_id and program_id=new.program_id) then
            raise exception 'This program is already in your profile.' using errcode='23505';
        end if;
    end if;
    return new;
end;
$$;
revoke all on function private.check_primary_program_duplicate() from public,anon,authenticated;
create trigger profile_no_duplicate_program before insert or update of program_id on public.academic_profiles
    for each row execute function private.check_primary_program_duplicate();
create trigger additional_no_duplicate_program before insert on public.academic_profile_programs
    for each row execute function private.check_primary_program_duplicate();

create table public.transfer_credits (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    institution text not null check(length(btrim(institution)) between 1 and 160),
    source_course text not null check(length(btrim(source_course)) between 1 and 160),
    equivalent_course_id text references public.courses(id),
    credits numeric(5,2) not null check(credits>0 and credits<=30),
    awarded_term text not null references public.terms(id),
    source text not null default 'self_reported_award' check(source='self_reported_award'),
    notes text not null default '' check(length(notes)<=1000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create unique index transfer_source_unique on public.transfer_credits(user_id,lower(btrim(institution)),lower(btrim(source_course)));
create unique index transfer_equivalent_unique on public.transfer_credits(user_id,equivalent_course_id) where equivalent_course_id is not null;
create index transfer_equivalent_idx on public.transfer_credits(equivalent_course_id);
alter table public.transfer_credits enable row level security;
grant select,insert,update,delete on public.transfer_credits to authenticated;
grant all on public.transfer_credits to service_role;
create policy transfer_owner on public.transfer_credits for all to authenticated
    using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end;
$$;
revoke all on function private.touch_updated_at() from public,anon,authenticated;
create trigger transfer_touch before update on public.transfer_credits for each row execute function private.touch_updated_at();
comment on table public.transfer_credits is 'Student-entered recognized external credit. Mapped UW equivalents inform planning; no UW GPA, residency, or chat membership is implied.';

-- Keep user-entered report observations separate from executable catalog rules.
alter table public.degree_progress add column created_at timestamptz not null default now(),
    add column updated_at timestamptz not null default now();
create trigger degree_progress_touch before update on public.degree_progress for each row execute function private.touch_updated_at();
comment on table public.degree_progress is 'Legacy-compatible student report observations, not a verified automated degree audit.';
