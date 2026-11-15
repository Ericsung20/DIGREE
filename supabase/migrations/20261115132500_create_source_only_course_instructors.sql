-- Some UW courses publish instructor names outside the planner's credit constraints.
create table public.course_instructors_source_only (
    term text not null references public.terms (id),
    course_id text not null,
    bundle_id text not null,
    instructors text[] not null check (cardinality(instructors) > 0),
    source_url text not null,
    fetched_at timestamptz not null,
    primary key (term, course_id, bundle_id)
);

alter table public.course_instructors_source_only enable row level security;
revoke all on public.course_instructors_source_only from public, anon, authenticated, service_role;
grant select on public.course_instructors_source_only to authenticated;
grant select, insert, update, delete on public.course_instructors_source_only to service_role;
create policy course_instructors_source_only_read on public.course_instructors_source_only for select to authenticated using (true);
