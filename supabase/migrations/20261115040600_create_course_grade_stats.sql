create table public.course_grade_stats (
    course_id text primary key references public.courses (id) on delete cascade,
    a_ab_count integer not null,
    sample_size integer not null check (sample_size > 0),
    a_ab_rate numeric generated always as (a_ab_count::numeric / sample_size) stored,
    source_url text not null,
    first_term_code text not null,
    last_term_code text not null,
    fetched_at timestamptz not null,
    check (a_ab_count between 0 and sample_size)
);

alter table public.course_grade_stats enable row level security;
revoke all on public.course_grade_stats from public, anon, authenticated, service_role;
grant select on public.course_grade_stats to authenticated;
grant select, insert, update, delete on public.course_grade_stats to service_role;

create policy course_grade_stats_read on public.course_grade_stats
    for select to authenticated using (true);
