insert into public.academic_requirement_policies (policy_key, scope, policy, source_url)
values
    ('ls_one_breadth_area_per_course', 'College of Letters & Science degree breadth',
     '{"max_breadth_areas_per_course":1,"may_split_credits":false,"example":["Humanities","Social Science"]}'::jsonb,
     'https://guide.wisc.edu/undergraduate/letters-science/#requirementstext'),
    ('ls_breadth_and_distinct_designation', 'College of Letters & Science degree requirements',
     '{"combination_can_count":true,"examples":[["QR-B","Social Science"],["Ethnic Studies","Humanities"]],"subject_to_program_rules":true}'::jsonb,
     'https://guide.wisc.edu/undergraduate/letters-science/#requirementstext'),
    ('uw_core_gened_cohort', 'UW–Madison university general education',
     '{"first_postsecondary_enrollment_at_or_after_term":"1266","framework":"core_gened","max_categories_per_course":1}'::jsonb,
     'https://gened.wisc.edu/summer-2026-and-later-core-gened/'),
    ('uw_legacy_gened_cohort', 'UW–Madison university general education',
     '{"first_postsecondary_enrollment_before_term":"1266","framework":"legacy","designations_include":["Communication A","Communication B","QR-A","QR-B","Ethnic Studies"],"other_degree_overlap":"check_school_or_college"}'::jsonb,
     'https://kb.wisc.edu/160621'),
    ('uw_major_and_degree_overlap', 'Program and college-specific degree requirements',
     '{"allowance_depends_on_program_and_college":true,"use_program_and_catalog_year_rules":true,"student_audit":"DARS"}'::jsonb,
     'https://gened.wisc.edu/frequently-asked-questions/')
on conflict (policy_key) do update set scope=excluded.scope, policy=excluded.policy, source_url=excluded.source_url;
