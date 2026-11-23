-- Sending or receiving a pending request does not grant schedule access.
-- Acceptance creates a default share from each owner unless they already set a preference.
create function private.share_schedules_on_friend_acceptance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if old.status = 'accepted' then
            return new;
        end if;
    end if;

    insert into public.schedule_permissions (owner_id, viewer_id, visibility)
    values (new.requester_id, new.receiver_id, 'full'),
           (new.receiver_id, new.requester_id, 'full')
    on conflict (owner_id, viewer_id) do nothing;

    return new;
end;
$$;

revoke all on function private.share_schedules_on_friend_acceptance() from public, anon, authenticated;

create trigger share_schedules_on_friend_acceptance
after insert or update of status on public.friendships
for each row when (new.status = 'accepted')
execute function private.share_schedules_on_friend_acceptance();
