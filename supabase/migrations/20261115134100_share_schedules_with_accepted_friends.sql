-- Accepted friendship is the sharing rule in both directions.
-- Authenticate the requested viewer before resolving access.
create or replace function public.schedule_visibility(owner uuid, viewer uuid)
returns public.visibility
language sql stable security definer set search_path = ''
as $$
    select case
        when viewer is distinct from auth.uid() or viewer is null then 'private'::public.visibility
        when owner = viewer then 'full'::public.visibility
        when exists (
            select from public.friendships as link
            where least(link.requester_id, link.receiver_id) = least(owner, viewer)
              and greatest(link.requester_id, link.receiver_id) = greatest(owner, viewer)
              and link.status = 'accepted'
        ) then 'full'::public.visibility
        else 'private'::public.visibility
    end;
$$;

-- The previous trigger wrote per-friend permissions, which are no longer needed.
drop trigger if exists share_schedules_on_friend_acceptance on public.friendships;
drop function if exists private.share_schedules_on_friend_acceptance();
