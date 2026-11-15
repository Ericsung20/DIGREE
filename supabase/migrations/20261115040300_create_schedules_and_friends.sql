create type public.schedule_mode as enum ('planned', 'enrolled_self_reported');
create type public.friendship_status as enum ('pending', 'accepted', 'blocked');
create type public.visibility as enum ('private', 'free_busy', 'full');

create table public.saved_schedules (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    term text not null references public.terms (id),
    mode public.schedule_mode not null,
    name text not null,
    source_request_id text,
    unique (id, term)
);

create index saved_schedules_owner_term_idx on public.saved_schedules (user_id, term);

create table public.saved_schedule_items (
    schedule_id uuid not null,
    term text not null,
    course_id text not null,
    bundle_id text not null,
    credits integer not null check (credits between 1 and 30),
    primary key (schedule_id, course_id),
    foreign key (schedule_id, term)
        references public.saved_schedules (id, term) on delete cascade,
    foreign key (term, course_id, bundle_id)
        references public.section_bundles (term, course_id, bundle_id)
);

create table public.friendships (
    requester_id uuid references auth.users (id) on delete cascade,
    receiver_id uuid references auth.users (id) on delete cascade,
    status public.friendship_status not null default 'pending',
    blocked_by uuid,
    primary key (requester_id, receiver_id),
    check (requester_id <> receiver_id),
    check (
        (status = 'blocked' and blocked_by is not null and blocked_by in (requester_id, receiver_id))
        or (status <> 'blocked' and blocked_by is null)
    )
);

create unique index friendships_unordered_pair_idx on public.friendships (
    least(requester_id, receiver_id), greatest(requester_id, receiver_id)
);
create index friendships_receiver_idx on public.friendships (receiver_id);

create table public.schedule_permissions (
    owner_id uuid references auth.users (id) on delete cascade,
    viewer_id uuid references auth.users (id) on delete cascade,
    visibility public.visibility not null default 'private',
    primary key (owner_id, viewer_id),
    check (owner_id <> viewer_id)
);

alter table public.saved_schedules enable row level security;
alter table public.saved_schedule_items enable row level security;
alter table public.friendships enable row level security;
alter table public.schedule_permissions enable row level security;

revoke all on public.saved_schedules, public.saved_schedule_items, public.friendships,
    public.schedule_permissions from public, anon, authenticated;
grant select, insert, update, delete on public.saved_schedules, public.saved_schedule_items,
    public.schedule_permissions to authenticated;
grant select, insert, delete on public.friendships to authenticated;
grant update (status, blocked_by) on public.friendships to authenticated;

create function public.schedule_visibility(owner uuid, viewer uuid)
returns public.visibility
language sql stable security definer set search_path = ''
as $$
    select case
        when viewer is distinct from auth.uid() or viewer is null then 'private'::public.visibility
        when owner = viewer then 'full'::public.visibility
        else coalesce((
            select permission.visibility
            from public.schedule_permissions as permission
            join public.friendships as friendship
                on least(friendship.requester_id, friendship.receiver_id) = least(owner, viewer)
                and greatest(friendship.requester_id, friendship.receiver_id) = greatest(owner, viewer)
                and friendship.status = 'accepted'
            where permission.owner_id = owner and permission.viewer_id = viewer
        ), 'private'::public.visibility)
    end;
$$;

create function public.can_view_schedule(owner uuid, viewer uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select public.schedule_visibility(owner, viewer) = 'full';
$$;

create function public.schedule_free_busy(
    schedule_owner uuid, schedule_term text, requested_mode public.schedule_mode
)
returns table (day public.meeting_day, start_min integer, end_min integer)
language sql stable security definer set search_path = ''
as $$
    select distinct meeting.day, meeting.start_min, meeting.end_min
    from public.saved_schedules as schedule
    join public.saved_schedule_items as item using (term)
    join public.meetings as meeting using (term, course_id, bundle_id)
    where item.schedule_id = schedule.id
        and schedule.user_id = schedule_owner
        and schedule.term = schedule_term
        and schedule.mode = requested_mode
        and public.schedule_visibility(schedule_owner, auth.uid()) in ('free_busy', 'full')
    order by meeting.day, meeting.start_min, meeting.end_min;
$$;

revoke all on function public.schedule_visibility(uuid, uuid),
    public.can_view_schedule(uuid, uuid), public.schedule_free_busy(uuid, text, public.schedule_mode)
    from public, anon, authenticated;
grant execute on function public.schedule_visibility(uuid, uuid),
    public.can_view_schedule(uuid, uuid), public.schedule_free_busy(uuid, text, public.schedule_mode)
    to authenticated;

create policy saved_schedules_owner on public.saved_schedules for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));
create policy saved_schedules_full_read on public.saved_schedules for select to authenticated
    using (public.can_view_schedule(user_id, (select auth.uid())));

create policy saved_schedule_items_owner on public.saved_schedule_items for all to authenticated
    using (exists (
        select from public.saved_schedules as schedule
        where schedule.id = saved_schedule_items.schedule_id and schedule.user_id = (select auth.uid())
    ))
    with check (exists (
        select from public.saved_schedules as schedule
        where schedule.id = saved_schedule_items.schedule_id and schedule.user_id = (select auth.uid())
    ));
create policy saved_schedule_items_full_read on public.saved_schedule_items for select to authenticated
    using (exists (select from public.saved_schedules as schedule where schedule.id = saved_schedule_items.schedule_id));

create policy friendships_participant_read on public.friendships for select to authenticated
    using ((select auth.uid()) in (requester_id, receiver_id));
create policy friendships_request on public.friendships for insert to authenticated
    with check (requester_id = (select auth.uid()) and status = 'pending');
create policy friendships_respond on public.friendships for update to authenticated
    using (status <> 'blocked' and (select auth.uid()) in (requester_id, receiver_id))
    with check (
        (status = 'accepted' and receiver_id = (select auth.uid()))
        or (status = 'blocked' and blocked_by = (select auth.uid()))
    );
create policy friendships_remove on public.friendships for delete to authenticated
    using (
        (status <> 'blocked' and (select auth.uid()) in (requester_id, receiver_id))
        or blocked_by = (select auth.uid())
    );
create policy schedule_permissions_owner on public.schedule_permissions for all to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
