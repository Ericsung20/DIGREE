-- A request is addressed by UW NetID. Only the authenticated requester can
-- create it, and the recipient still has to accept before either schedule is visible.
create function public.send_friend_request(p_netid text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    requester uuid := auth.uid();
    recipient uuid;
    netid text := lower(btrim(p_netid));
begin
    if requester is null then
        raise exception 'Sign in first.' using errcode = '42501';
    end if;
    if netid !~ '^[a-z][a-z0-9._-]{1,31}$' then
        raise exception 'Enter a valid UW NetID.' using errcode = '22023';
    end if;
    select id into recipient from auth.users
    where lower(email) = netid || '@wisc.edu' and email_confirmed_at is not null;
    if recipient is null then
        raise exception 'No account has that NetID.' using errcode = 'P0002';
    end if;
    if recipient = requester then
        raise exception 'You cannot add yourself.' using errcode = '22023';
    end if;
    insert into public.friendships (requester_id, receiver_id, status)
    values (requester, recipient, 'pending');
    return recipient;
exception when unique_violation then
    raise exception 'A friend request already exists.' using errcode = '23505';
end;
$$;

-- Reveal NetIDs only to people already connected by a request.
create function public.friend_netids()
returns table (id uuid, netid text)
language sql stable security definer set search_path = ''
as $$
    select other.id, split_part(lower(other.email), '@', 1)
    from public.friendships as link
    join auth.users as other on other.id = case
        when link.requester_id = auth.uid() then link.receiver_id
        else link.requester_id end
    where auth.uid() in (link.requester_id, link.receiver_id)
        and link.status <> 'blocked';
$$;

-- An accepted friendship grants both directions full schedule access.
create or replace function public.schedule_visibility(owner uuid, viewer uuid)
returns public.visibility
language sql stable security definer set search_path = ''
as $$
    select case
        when viewer is distinct from auth.uid() or viewer is null then 'private'::public.visibility
        when owner = viewer then 'full'::public.visibility
        when exists (
            select from public.friendships as friendship
            where least(friendship.requester_id, friendship.receiver_id) = least(owner, viewer)
                and greatest(friendship.requester_id, friendship.receiver_id) = greatest(owner, viewer)
                and friendship.status = 'accepted'
        ) then 'full'::public.visibility
        else 'private'::public.visibility
    end;
$$;

-- Expose only course labels and meeting times for a friend's self-reported
-- enrollment. Grades and other course-record fields stay owner-only.
create function public.friend_enrolled_schedule(p_owner uuid, p_term text)
returns table (course_code text, meetings jsonb)
language sql stable security definer set search_path = ''
as $$
    select course.code,
        coalesce(jsonb_agg(jsonb_build_object(
            'day', meeting.day,
            'start_min', meeting.start_min,
            'end_min', meeting.end_min,
            'mode', meeting.mode,
            'building_id', meeting.building_id
        ) order by meeting.day, meeting.start_min)
        filter (where meeting.id is not null), '[]'::jsonb)
    from public.user_course_records as record
    join public.courses as course on course.id = record.course_id
    left join public.meetings as meeting
        on meeting.term = record.term
        and meeting.course_id = record.course_id
        and meeting.bundle_id = record.bundle_id
    where record.user_id = p_owner and record.term = p_term
        and record.status = 'enrolled_self_reported'
        and public.can_view_schedule(p_owner, auth.uid())
    group by record.id, course.code
    order by course.code;
$$;

revoke all on function public.send_friend_request(text), public.friend_netids(),
    public.friend_enrolled_schedule(uuid, text)
    from public, anon, authenticated;
grant execute on function public.send_friend_request(text), public.friend_netids(),
    public.friend_enrolled_schedule(uuid, text)
    to authenticated;
