select private.refresh_program_version('major:'||id::text) from public.academic_programs;
select private.refresh_program_version('supplemental:'||catalog_year||':'||program_key) from public.supplemental_program_catalog;
