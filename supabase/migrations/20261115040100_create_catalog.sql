create type public.seat_status as enum ('open', 'full', 'unknown');
create type public.meeting_day as enum ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');
create type public.meeting_mode as enum ('in_person', 'hybrid', 'online_sync');

create table public.courses (
    id text primary key,
    code text not null unique,
    title text,
    credit_options integer[] not null check (
        array_ndims(credit_options) = 1
        and cardinality(credit_options) > 0
        and array_position(credit_options, null) is null
        and 1 <= all (credit_options)
        and 30 >= all (credit_options)
    ),
    breadth text[],
    repeatable boolean not null,
    source text not null,
    fetched_at timestamptz
);

create table public.buildings (
    id text primary key,
    name text
);

create table public.section_bundles (
    term text not null references public.terms (id),
    course_id text not null references public.courses (id),
    bundle_id text not null check (length(bundle_id) > 0),
    seat_status public.seat_status not null default 'unknown',
    instructor_score numeric check (instructor_score between 0 and 1),
    primary key (term, course_id, bundle_id)
);

create index section_bundles_course_idx on public.section_bundles (course_id);

create table public.meetings (
    id uuid primary key default gen_random_uuid(),
    term text not null,
    course_id text not null,
    bundle_id text not null,
    day public.meeting_day not null,
    start_min integer not null check (start_min between 0 and 1439),
    end_min integer not null check (end_min between 1 and 1440),
    mode public.meeting_mode not null,
    building_id text references public.buildings (id),
    check (start_min < end_min),
    foreign key (term, course_id, bundle_id)
        references public.section_bundles (term, course_id, bundle_id) on delete cascade
);

create index meetings_bundle_idx on public.meetings (term, course_id, bundle_id);

create table public.walking_edges (
    from_building_id text references public.buildings (id),
    to_building_id text references public.buildings (id),
    minutes integer not null check (minutes >= 0),
    bidirectional boolean not null default true,
    primary key (from_building_id, to_building_id)
);

alter table public.courses enable row level security;
alter table public.buildings enable row level security;
alter table public.section_bundles enable row level security;
alter table public.meetings enable row level security;
alter table public.walking_edges enable row level security;

revoke all on public.courses, public.buildings, public.section_bundles,
    public.meetings, public.walking_edges from public, anon, authenticated, service_role;
grant select on public.courses, public.buildings, public.section_bundles,
    public.meetings, public.walking_edges to authenticated;
grant select, insert, update, delete on public.courses, public.buildings, public.section_bundles,
    public.meetings, public.walking_edges to service_role;

create policy courses_read on public.courses for select to authenticated using (true);
create policy buildings_read on public.buildings for select to authenticated using (true);
create policy section_bundles_read on public.section_bundles for select to authenticated using (true);
create policy meetings_read on public.meetings for select to authenticated using (true);
create policy walking_edges_read on public.walking_edges for select to authenticated using (true);
