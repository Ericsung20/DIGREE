create or replace view public.program_requirement_course_options with (security_invoker = true) as
select distinct catalog.program_id, program.catalog_year, program.label as program,
    group_info.value->>'heading' as requirement_group,
    option_info.value->>'code' as course_code, catalog.source_url, catalog.extraction_method,
    row_info.value->>'kind' as listing_kind
from public.program_requirement_catalog catalog
join public.academic_programs program on program.id = catalog.program_id
cross join lateral jsonb_array_elements(catalog.course_groups) group_info(value)
cross join lateral jsonb_array_elements(group_info.value->'rows') row_info(value)
cross join lateral jsonb_array_elements(row_info.value->'courses') option_info(value)
where row_info.value->>'kind' in ('course', 'alternative');
