-- UW can publish instructors for sections that lack schedulable meeting data.
create table public.course_instructors (
    term text not null references public.terms (id),
    course_id text not null references public.courses (id),
    bundle_id text not null,
    instructors text[] not null check (cardinality(instructors) > 0),
    source_url text not null,
    fetched_at timestamptz not null,
    primary key (term, course_id, bundle_id)
);

alter table public.course_instructors enable row level security;
revoke all on public.course_instructors from public, anon, authenticated, service_role;
grant select on public.course_instructors to authenticated;
grant select, insert, update, delete on public.course_instructors to service_role;
create policy course_instructors_read on public.course_instructors for select to authenticated using (true);
