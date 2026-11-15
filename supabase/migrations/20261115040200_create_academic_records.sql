create type public.course_record_status as enum ('completed', 'enrolled_self_reported', 'planned', 'withdrawn');
create type public.academic_data_source as enum ('manual', 'dars_pdf', 'dig');
create type public.letter_grade as enum ('A', 'AB', 'B', 'BC', 'C', 'D', 'F');
create type public.degree_review_status as enum ('manual', 'dars_pdf', 'unverified');

create table public.user_course_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    term text not null references public.terms (id),
    course_id text not null references public.courses (id),
    bundle_id text,
    credits integer not null check (credits between 0 and 30),
    status public.course_record_status not null,
    source public.academic_data_source not null default 'manual',
    counts_toward_major boolean not null default false,
    foreign key (term, course_id, bundle_id)
        references public.section_bundles (term, course_id, bundle_id)
);

create index user_course_records_user_term_idx on public.user_course_records (user_id, term);

create unique index user_course_records_active_attempt_idx
    on public.user_course_records (user_id, term, course_id)
    where status in ('completed', 'enrolled_self_reported');

create table public.grade_entries (
    record_id uuid primary key references public.user_course_records (id) on delete cascade,
    letter_grade public.letter_grade,
    is_final boolean not null default false
);

create table public.degree_progress (
    user_id uuid references auth.users (id) on delete cascade,
    program_id uuid references public.academic_programs (id),
    requirement_id text,
    credits_remaining integer check (credits_remaining >= 0),
    source public.academic_data_source not null default 'manual',
    review_status public.degree_review_status not null default 'unverified',
    primary key (user_id, program_id, requirement_id)
);

alter table public.user_course_records enable row level security;
alter table public.grade_entries enable row level security;
alter table public.degree_progress enable row level security;

revoke all on public.user_course_records, public.grade_entries, public.degree_progress
    from public, anon, authenticated;
grant select, insert, update, delete
    on public.user_course_records, public.grade_entries, public.degree_progress to authenticated;

create policy user_course_records_owner on public.user_course_records
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

create policy grade_entries_owner on public.grade_entries
    for all to authenticated
    using (exists (
        select 1 from public.user_course_records as record
        where record.id = grade_entries.record_id and record.user_id = (select auth.uid())
    ))
    with check (exists (
        select 1 from public.user_course_records as record
        where record.id = grade_entries.record_id and record.user_id = (select auth.uid())
    ));

create policy degree_progress_owner on public.degree_progress
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
