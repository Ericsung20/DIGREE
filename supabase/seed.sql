-- Synthetic local demo data. Catalog entries and programs do not describe UW requirements.
insert into public.terms (id, label, is_current) values ('2027SP', 'Spring 2027 (demo)', true);

insert into public.colleges (label) values
    ('Demo College of Letters and Science'),
    ('Demo College of Engineering');

insert into public.academic_programs (college_id, label, catalog_year)
select college.id, program.label, 2027
from (values
    ('Demo College of Letters and Science', 'Demo Computer Science'),
    ('Demo College of Letters and Science', 'Demo Statistics'),
    ('Demo College of Engineering', 'Demo Engineering')
) as program(college_label, label)
join public.colleges as college on college.label = program.college_label;

-- Catalog fields from fixtures/request.json. Unknown names and fetch times are null.
insert into public.courses (id, code, credit_options, repeatable, source) values
    ('cs400', 'COMP SCI 400', array[3], false, 'demo_fixture'),
    ('math234', 'MATH 234', array[4], false, 'demo_fixture'),
    ('stat240', 'STAT 240', array[3], false, 'demo_fixture');

insert into public.buildings (id) values
    ('ALPHA'),
    ('BETA'),
    ('DELTA'),
    ('GAMMA');

insert into public.section_bundles (term, course_id, bundle_id, seat_status, instructor_score) values
    ('2027SP', 'cs400', 'cs400-A', 'open', null),
    ('2027SP', 'cs400', 'cs400-B', 'open', null),
    ('2027SP', 'math234', 'math234-A', 'open', null),
    ('2027SP', 'math234', 'math234-B', 'open', null),
    ('2027SP', 'stat240', 'stat240-A', 'open', null);

insert into public.meetings (term, course_id, bundle_id, day, start_min, end_min, mode, building_id) values
    ('2027SP', 'cs400', 'cs400-A', 'MON', 600, 650, 'in_person', 'ALPHA'),
    ('2027SP', 'cs400', 'cs400-A', 'WED', 600, 650, 'in_person', 'ALPHA'),
    ('2027SP', 'cs400', 'cs400-B', 'MON', 660, 710, 'in_person', 'GAMMA'),
    ('2027SP', 'cs400', 'cs400-B', 'WED', 660, 710, 'in_person', 'GAMMA'),
    ('2027SP', 'math234', 'math234-A', 'MON', 660, 710, 'in_person', 'BETA'),
    ('2027SP', 'math234', 'math234-A', 'WED', 660, 710, 'in_person', 'BETA'),
    ('2027SP', 'math234', 'math234-B', 'MON', 720, 770, 'in_person', 'GAMMA'),
    ('2027SP', 'math234', 'math234-B', 'WED', 720, 770, 'in_person', 'GAMMA'),
    ('2027SP', 'stat240', 'stat240-A', 'TUE', 600, 675, 'in_person', 'DELTA'),
    ('2027SP', 'stat240', 'stat240-A', 'THU', 600, 675, 'in_person', 'DELTA');

insert into public.walking_edges (from_building_id, to_building_id, minutes, bidirectional) values
    ('ALPHA', 'BETA', 6, true),
    ('ALPHA', 'GAMMA', 18, true),
    ('BETA', 'GAMMA', 12, true);

insert into public.chat_rooms (term, course_id)
select distinct term, course_id from public.section_bundles;
