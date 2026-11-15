create table public.supplemental_program_catalog (
    catalog_year integer not null check (catalog_year between 1900 and 9999),
    program_key text not null check (length(program_key) > 0),
    kind text not null check (kind in ('certificate', 'minor')),
    name text not null check (length(btrim(name)) > 0),
    source_url text not null,
    course_groups jsonb not null check (jsonb_typeof(course_groups) = 'array' and course_groups <> '[]'::jsonb),
    declaration_groups jsonb not null check (jsonb_typeof(declaration_groups) = 'array'),
    fetched_at timestamptz not null,
    primary key (catalog_year, program_key)
);

create index supplemental_program_catalog_lookup
    on public.supplemental_program_catalog (catalog_year, kind, name);

alter table public.supplemental_program_catalog enable row level security;
revoke all on public.supplemental_program_catalog from public, anon, authenticated, service_role;
grant select on public.supplemental_program_catalog to authenticated;
grant select, insert, update, delete on public.supplemental_program_catalog to service_role;

create policy supplemental_program_catalog_read on public.supplemental_program_catalog
    for select to authenticated using (true);
