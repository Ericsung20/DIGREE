-- Forward migration. Constant default preserves every existing plan in slot 1.
-- Rollback needs a forward migration after reconciling users with multiple plans.
alter table public.saved_schedules add column plan_slot smallint not null default 1 check(plan_slot between 1 and 3);
drop index public.one_active_schedule_idx;
create unique index active_plan_slot_idx on public.saved_schedules(user_id,term,mode,plan_slot) where state='active';

create or replace function public.save_schedule(p_term text,p_items jsonb,p_request_id text,p_name text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare owner uuid:=auth.uid(); saved uuid:=gen_random_uuid(); available smallint;
begin
    if owner is null then raise exception 'Sign in to save a schedule.' using errcode='42501'; end if;
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
        raise exception 'A schedule needs 1 to 50 courses.' using errcode='22023';
    end if;
    if length(coalesce(p_request_id,'')) not between 1 and 200 or length(coalesce(p_name,''))>160 then
        raise exception 'Invalid schedule metadata.' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(owner::text||':'||p_term,0));
    select slot into available from generate_series(1,3) slot
    where not exists(select from public.saved_schedules s where s.user_id=owner and s.term=p_term and s.mode='planned' and s.state='active' and s.plan_slot=slot)
    order by slot limit 1;
    if available is null then raise exception 'PLANS_FULL: Delete a saved plan before saving another. Maximum 3 plans per semester.' using errcode='P0001'; end if;
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
    insert into public.saved_schedules(id,user_id,term,mode,name,source_request_id,state,plan_slot)
    values(saved,owner,p_term,'planned',coalesce(nullif(btrim(p_name),''),'Plan '||available),p_request_id,'active',available);
    insert into public.saved_schedule_items(schedule_id,term,course_id,bundle_id,credits)
    select saved,p_term,x.course_id,x.bundle_id,x.credits from jsonb_to_recordset(p_items) x(course_id text,bundle_id text,credits integer);
    return saved;
end;
$$;

create function public.archive_schedule(p_schedule_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare schedule_term text;
begin
    if auth.uid() is null then raise exception 'Sign in to delete a plan.' using errcode='42501'; end if;
    select term into schedule_term from public.saved_schedules where id=p_schedule_id and user_id=auth.uid() and mode='planned';
    if schedule_term is null then raise exception 'Plan not found.' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||schedule_term,0));
    update public.saved_schedules set state='archived' where id=p_schedule_id and user_id=auth.uid() and mode='planned';
end;
$$;
revoke all on function public.archive_schedule(uuid) from public,anon;
grant execute on function public.archive_schedule(uuid) to authenticated;
