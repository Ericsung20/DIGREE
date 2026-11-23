-- Give existing accepted friendships the same default as new ones.
insert into public.schedule_permissions (owner_id, viewer_id, visibility)
select peers.owner_id, peers.viewer_id, 'full'::public.visibility
from public.friendships as link
cross join lateral (values (link.requester_id, link.receiver_id),
                           (link.receiver_id, link.requester_id)) as peers(owner_id, viewer_id)
where link.status = 'accepted'
on conflict (owner_id, viewer_id) do nothing;
