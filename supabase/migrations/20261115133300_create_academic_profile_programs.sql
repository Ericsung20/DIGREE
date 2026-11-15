-- The original academic profile remains the primary program used by the degree audit.
create table public.academic_profile_programs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.academic_profiles (user_id) on delete cascade,
    kind text not null,
    program_id uuid references public.academic_programs (id),
    name text,
    catalog_year integer check (catalog_year between 1900 and 9999),
    constraint academic_profile_program_shape check (
        (kind = 'major' and program_id is not null and name is null and catalog_year is null)
        or (kind in ('certificate', 'minor') and program_id is null and name is not null
            and char_length(btrim(name)) between 1 and 120)
    ),
    unique (user_id, program_id)
);

create unique index academic_profile_programs_custom_name_idx
    on public.academic_profile_programs (user_id, kind, lower(btrim(name)))
    where name is not null;

alter table public.academic_profile_programs enable row level security;
revoke all on public.academic_profile_programs from public, anon, authenticated;
grant select, insert, delete on public.academic_profile_programs to authenticated;

create policy academic_profile_programs_owner_read on public.academic_profile_programs
    for select to authenticated using (user_id = (select auth.uid()));
create policy academic_profile_programs_owner_insert on public.academic_profile_programs
    for insert to authenticated with check (user_id = (select auth.uid()));
create policy academic_profile_programs_owner_delete on public.academic_profile_programs
    for delete to authenticated using (user_id = (select auth.uid()));
