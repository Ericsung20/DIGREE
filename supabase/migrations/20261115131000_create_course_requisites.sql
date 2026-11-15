create table public.course_requisites (
    term text not null references public.terms (id),
    course_id text not null references public.courses (id),
    enrollment_requisites text,
    advisory_requisites text,
    requirement_groups jsonb check (jsonb_typeof(requirement_groups) = 'object'),
    source_url text not null,
    fetched_at timestamptz not null,
    primary key (term, course_id)
);

alter table public.course_requisites enable row level security;
revoke all on public.course_requisites from public, anon, authenticated, service_role;
grant select on public.course_requisites to authenticated;
grant select, insert, update, delete on public.course_requisites to service_role;
create policy course_requisites_read on public.course_requisites for select to authenticated using (true);
