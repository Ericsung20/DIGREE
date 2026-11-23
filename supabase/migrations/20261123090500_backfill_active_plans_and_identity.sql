-- Fail rather than discard any conflicting account. Transactional uniqueness is
-- also enforced by the already-installed Auth trigger for concurrent changes.
insert into private.account_emails(user_id,normalized_email)
select id,lower(btrim(email)) from auth.users
where email is not null and deleted_at is null and not coalesce(is_sso_user,false)
on conflict(user_id) do update set normalized_email=excluded.normalized_email;

with latest as(
    select id,row_number() over(partition by user_id,term,mode order by name desc,id) position
    from public.saved_schedules where mode='planned'
)
update public.saved_schedules s set state=case when l.position=1 then 'active' else 'archived' end
from latest l where l.id=s.id;
