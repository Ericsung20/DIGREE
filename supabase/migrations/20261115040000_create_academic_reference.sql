create table public.terms (
    id text primary key,
    label text not null,
    is_current boolean not null default false
);

create unique index terms_one_current_idx
    on public.terms (is_current)
    where is_current;

create table public.colleges (
    id uuid primary key default gen_random_uuid(),
    label text not null unique
);

create table public.academic_programs (
    id uuid primary key default gen_random_uuid(),
    college_id uuid not null references public.colleges (id),
    label text not null,
    catalog_year integer not null,
    unique (college_id, catalog_year, label),
    unique (id, college_id, catalog_year)
);

create table public.academic_profiles (
    user_id uuid primary key references auth.users (id) on delete cascade,
    college_id uuid not null,
    program_id uuid not null,
    catalog_year integer not null,
    foreign key (program_id, college_id, catalog_year)
        references public.academic_programs (id, college_id, catalog_year)
);

alter table public.terms enable row level security;
alter table public.colleges enable row level security;
alter table public.academic_programs enable row level security;
alter table public.academic_profiles enable row level security;

revoke all on public.terms, public.colleges, public.academic_programs,
    public.academic_profiles from public, anon, authenticated;
grant select on public.terms, public.colleges, public.academic_programs
    to anon, authenticated;
grant select, insert, update on public.academic_profiles to authenticated;

create policy terms_read on public.terms
    for select to anon, authenticated using (true);
create policy colleges_read on public.colleges
    for select to anon, authenticated using (true);
create policy academic_programs_read on public.academic_programs
    for select to anon, authenticated using (true);

create policy academic_profiles_owner_read on public.academic_profiles
    for select to authenticated using ((select auth.uid()) = user_id);
create policy academic_profiles_owner_insert on public.academic_profiles
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy academic_profiles_owner_update on public.academic_profiles
    for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
