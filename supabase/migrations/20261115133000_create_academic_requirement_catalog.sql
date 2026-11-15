create table public.course_designations (
    term text not null references public.terms (id),
    course_id text not null,
    course_code text not null,
    breadth_codes text[] not null,
    general_ed_code text,
    core_gen_ed_code text,
    ethnic_studies_code text,
    ls_credit_code text,
    level_codes text[] not null,
    designations jsonb not null,
    source_url text not null,
    fetched_at timestamptz not null,
    primary key (term, course_id)
);
create index course_designations_term_code_idx on public.course_designations (term, course_code);

create table public.program_requirement_catalog (
    program_id uuid primary key references public.academic_programs (id),
    source_url text not null,
    extraction_method text not null check (extraction_method in ('guide_html', 'guide_pdf')),
    course_groups jsonb not null check (jsonb_typeof(course_groups) = 'array'),
    fetched_at timestamptz not null
);

create table public.academic_requirement_policies (
    policy_key text primary key,
    scope text not null,
    policy jsonb not null,
    source_url text not null
);

alter table public.course_designations enable row level security;
alter table public.program_requirement_catalog enable row level security;
alter table public.academic_requirement_policies enable row level security;

revoke all on public.course_designations, public.program_requirement_catalog, public.academic_requirement_policies
    from public, anon, authenticated, service_role;
grant select on public.course_designations, public.program_requirement_catalog, public.academic_requirement_policies to authenticated;
grant select, insert, update, delete on public.course_designations, public.program_requirement_catalog,
    public.academic_requirement_policies to service_role;
create policy course_designations_read on public.course_designations for select to authenticated using (true);
create policy program_requirement_catalog_read on public.program_requirement_catalog for select to authenticated using (true);
create policy academic_requirement_policies_read on public.academic_requirement_policies for select to authenticated using (true);

create view public.program_requirement_course_options with (security_invoker = true) as
select distinct catalog.program_id, program.catalog_year, program.label as program,
    group_info.value->>'heading' as requirement_group,
    option_info.value->>'code' as course_code, catalog.source_url, catalog.extraction_method
from public.program_requirement_catalog catalog
join public.academic_programs program on program.id = catalog.program_id
cross join lateral jsonb_array_elements(catalog.course_groups) group_info(value)
cross join lateral jsonb_array_elements(group_info.value->'rows') row_info(value)
cross join lateral jsonb_array_elements(row_info.value->'courses') option_info(value);

revoke all on public.program_requirement_course_options from public, anon, authenticated;
grant select on public.program_requirement_course_options to authenticated, service_role;
