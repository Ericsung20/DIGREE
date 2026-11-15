-- Keep existing profile entries readable while new selections reference the UW Guide catalog.
alter table public.supplemental_program_catalog
    add constraint supplemental_program_catalog_year_key_kind unique (catalog_year, program_key, kind);

alter table public.academic_profile_programs
    add column supplemental_program_key text,
    add constraint academic_profile_supplemental_shape check (
        supplemental_program_key is null or (kind in ('certificate', 'minor') and catalog_year is not null)
    ),
    add constraint academic_profile_supplemental_catalog_fkey
        foreign key (catalog_year, supplemental_program_key, kind)
        references public.supplemental_program_catalog (catalog_year, program_key, kind);

create unique index academic_profile_programs_supplemental_key_idx
    on public.academic_profile_programs (user_id, supplemental_program_key)
    where supplemental_program_key is not null;
