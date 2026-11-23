-- Distinct, writable planning/history interfaces over the legacy storage. There is
-- one source of truth during the compatibility window, not two mirrored tables.
create view public.planner_courses with(security_invoker=true) as
select * from public.user_course_records where status='planned' with local check option;
create view public.course_attempts with(security_invoker=true) as
select * from public.user_course_records where status<>'planned' with local check option;
grant select,insert,update,delete on public.planner_courses,public.course_attempts to authenticated;
create unique index planned_course_once_idx on public.user_course_records(user_id,term,course_id) where status='planned';

alter table public.saved_schedules add column state text not null default 'draft' check(state in('draft','active','archived')),
    add column created_at timestamptz not null default now(),
    add column updated_at timestamptz not null default now();
create unique index one_active_schedule_idx on public.saved_schedules(user_id,term,mode) where state='active';
create trigger schedule_touch before update on public.saved_schedules for each row execute function private.touch_updated_at();

create function public.save_schedule(p_term text,p_items jsonb,p_request_id text,p_name text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare owner uuid:=auth.uid(); saved uuid:=gen_random_uuid();
begin
    if owner is null then raise exception 'Sign in to save a schedule.' using errcode='42501'; end if;
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
        raise exception 'A schedule needs 1 to 50 courses.' using errcode='22023';
    end if;
    if length(coalesce(p_request_id,'')) not between 1 and 200 or length(coalesce(p_name,''))>160 then
        raise exception 'Invalid schedule metadata.' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(owner::text||':'||p_term,0));
    if exists(
        select from jsonb_to_recordset(p_items) x(course_id text,bundle_id text,credits integer)
        left join public.courses c on c.id=x.course_id
        left join public.course_offerings o on o.term=p_term and o.course_id=c.id
        where c.id is null or x.bundle_id is null or x.credits is null
            or not(x.credits=any(coalesce(o.credit_options,c.credit_options)))
    ) then raise exception 'Invalid course, section, or credit choice.' using errcode='22023'; end if;
    if (select count(distinct x->>'course_id') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then
        raise exception 'A course can appear only once in a schedule.' using errcode='23505';
    end if;
    update public.saved_schedules set state='archived' where user_id=owner and term=p_term and mode='planned' and state='active';
    insert into public.saved_schedules(id,user_id,term,mode,name,source_request_id,state)
    values(saved,owner,p_term,'planned',coalesce(nullif(btrim(p_name),''),'DIG plan'),p_request_id,'active');
    insert into public.saved_schedule_items(schedule_id,term,course_id,bundle_id,credits)
    select saved,p_term,x.course_id,x.bundle_id,x.credits
    from jsonb_to_recordset(p_items) x(course_id text,bundle_id text,credits integer);
    return saved;
end;
$$;
revoke all on function public.save_schedule(text,jsonb,text,text) from public,anon;
grant execute on function public.save_schedule(text,jsonb,text,text) to authenticated;

-- Supabase owns auth.users' indexes. The private identity registry adds atomic,
-- case/whitespace-insensitive application uniqueness without replacing them.
create table private.account_emails (
    user_id uuid primary key references auth.users(id) on delete cascade,
    normalized_email text not null unique check(normalized_email=lower(btrim(normalized_email)))
);
alter table private.account_emails enable row level security;
revoke all on private.account_emails from public,anon,authenticated;
create function private.enforce_account_email()
returns trigger language plpgsql security definer set search_path='' as $$
begin
    if new.email is null or new.deleted_at is not null or coalesce(new.is_sso_user,false) then
        delete from private.account_emails where user_id=new.id;
    else
        insert into private.account_emails(user_id,normalized_email) values(new.id,lower(btrim(new.email)))
        on conflict(user_id) do update set normalized_email=excluded.normalized_email;
    end if;
    return new;
end;
$$;
revoke all on function private.enforce_account_email() from public,anon,authenticated;
create trigger digree_unique_account_email after insert or update of email,deleted_at,is_sso_user on auth.users
    for each row execute function private.enforce_account_email();

-- Blocks apply consistently to shared schedules. Friend pending/blocked/removed
-- states never confer access. The historical permissions table is not consulted.
create or replace function public.schedule_visibility(owner uuid,viewer uuid)
returns public.visibility language sql stable security definer set search_path='' as $$
    select case
        when viewer is distinct from auth.uid() or viewer is null then 'private'::public.visibility
        when owner=viewer then 'full'::public.visibility
        when exists(select from public.user_blocks where (blocker_id=owner and blocked_id=viewer) or(blocker_id=viewer and blocked_id=owner)) then 'private'::public.visibility
        when exists(select from public.friendships f where least(f.requester_id,f.receiver_id)=least(owner,viewer)
            and greatest(f.requester_id,f.receiver_id)=greatest(owner,viewer) and f.status='accepted') then 'full'::public.visibility
        else 'private'::public.visibility end;
$$;
comment on table public.schedule_permissions is 'Deprecated compatibility data; accepted friendship and blocks determine sharing. No current app writes.';

create index course_requisites_course_idx on public.course_requisites(course_id);
create index course_instructors_course_idx on public.course_instructors(course_id);
create index meetings_building_idx on public.meetings(building_id);
create index walking_edges_destination_idx on public.walking_edges(to_building_id);
create index chat_memberships_user_idx on public.chat_memberships(user_id);
create index user_blocks_blocked_idx on public.user_blocks(blocked_id);
