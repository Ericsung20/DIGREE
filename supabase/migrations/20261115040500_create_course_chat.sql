create table public.chat_rooms (
    id uuid primary key default gen_random_uuid(),
    term text not null references public.terms (id),
    course_id text not null references public.courses (id),
    unique (term, course_id)
);

create table public.chat_memberships (
    room_id uuid references public.chat_rooms (id) on delete cascade,
    user_id uuid references auth.users (id) on delete cascade,
    alias text not null default ('Student-' || left(replace(gen_random_uuid()::text, '-', ''), 16)),
    joined_at timestamptz not null default now(),
    primary key (room_id, user_id),
    unique (room_id, alias)
);

-- Realtime publishes message rows. Keep account IDs in memberships.
create table public.chat_messages (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null,
    alias text not null,
    body text not null check (length(btrim(body)) > 0),
    created_at timestamptz not null default now(),
    foreign key (room_id, alias)
        references public.chat_memberships (room_id, alias) on delete cascade
);

create index chat_messages_room_created_at_idx on public.chat_messages (room_id, created_at);

create table public.chat_reports (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null references public.chat_messages (id) on delete cascade,
    reporter_id uuid default auth.uid() references auth.users (id) on delete set null,
    reason text not null check (length(btrim(reason)) > 0),
    created_at timestamptz not null default now()
);

alter table public.chat_rooms enable row level security;
alter table public.chat_memberships enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reports enable row level security;

revoke all on public.chat_rooms, public.chat_memberships, public.chat_messages, public.chat_reports
    from public, anon, authenticated;
grant select on public.chat_rooms, public.chat_messages to authenticated;
grant select (room_id, alias, joined_at) on public.chat_memberships to authenticated;
grant insert (room_id, alias, body) on public.chat_messages to authenticated;
grant insert (message_id, reason) on public.chat_reports to authenticated;
grant select on public.chat_reports to service_role;

create function public.is_room_member(room_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1
        from public.chat_rooms as room
        join public.terms as term on term.id = room.term and term.is_current
        join public.user_course_records as record
            on record.term = room.term and record.course_id = room.course_id
        where room.id = is_room_member.room_id
            and record.user_id = auth.uid()
            and record.status = 'enrolled_self_reported'
    );
$$;

create function public.join_chat_room(room_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    room_alias text;
begin
    if not public.is_room_member(room_id) then
        raise insufficient_privilege using message = 'Self-reported current-term course required';
    end if;

    insert into public.chat_memberships (room_id, user_id)
    values (join_chat_room.room_id, caller_id)
    on conflict on constraint chat_memberships_pkey do nothing
    returning alias into room_alias;

    if room_alias is null then
        select membership.alias into room_alias
        from public.chat_memberships as membership
        where membership.room_id = join_chat_room.room_id and membership.user_id = caller_id;
    end if;

    return room_alias;
end;
$$;

create function public.my_chat_rooms()
returns table (room_id uuid, term text, course_id text, course_code text, title text, participant_count bigint, my_alias text)
language sql stable security definer set search_path = ''
as $$
    select room.id, room.term, course.id, course.code, coalesce(course.title, course.code),
        (
            select count(*)
            from public.chat_memberships as member
            join public.user_course_records as record
                on record.user_id = member.user_id
                and record.term = room.term and record.course_id = room.course_id
                and record.status = 'enrolled_self_reported'
            where member.room_id = room.id
        ),
        mine.alias
    from public.chat_rooms as room
    join public.courses as course on course.id = room.course_id
    left join public.chat_memberships as mine on mine.room_id = room.id and mine.user_id = auth.uid()
    where public.is_room_member(room.id)
    order by course.code, room.id;
$$;

revoke all on function public.is_room_member(uuid), public.join_chat_room(uuid), public.my_chat_rooms()
    from public, anon, authenticated;
grant execute on function public.is_room_member(uuid), public.join_chat_room(uuid), public.my_chat_rooms()
    to authenticated;

create policy chat_rooms_member_read on public.chat_rooms for select to authenticated
    using (public.is_room_member(id));
create policy chat_memberships_own_read on public.chat_memberships for select to authenticated
    using (user_id = (select auth.uid()) and public.is_room_member(room_id));
create policy chat_messages_member_read on public.chat_messages for select to authenticated
    using (public.is_room_member(room_id));
create policy chat_messages_member_send on public.chat_messages for insert to authenticated
    with check (
        public.is_room_member(room_id)
        and exists (
            select 1 from public.chat_memberships as membership
            where membership.room_id = chat_messages.room_id and membership.alias = chat_messages.alias
        )
    );
create policy chat_reports_member_create on public.chat_reports for insert to authenticated
    with check (
        reporter_id = (select auth.uid())
        and exists (select 1 from public.chat_messages as message where message.id = chat_reports.message_id)
    );

alter publication supabase_realtime add table public.chat_messages;
