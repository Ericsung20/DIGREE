begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is_empty(
    $$select relname from pg_class where relnamespace = 'public'::regnamespace
        and relkind in ('r', 'p') and not relrowsecurity$$,
    'All public tables have row-level security'
);
select is((select count(*) from courses), 3::bigint, 'Seed: three courses');
select is((select count(*) from section_bundles), 5::bigint, 'Seed: five section bundles');
select is((select count(*) from meetings), 10::bigint, 'Seed: ten meetings');
select is((select count(*) from walking_edges), 3::bigint, 'Seed: three walking edges');
select is((select count(*) from chat_rooms), 3::bigint, 'Seed: one room per course');
select is(
    (select array_agg(tablename::text order by tablename) from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'),
    array['chat_messages'], 'Only the alias-based chat message table is published'
);
select hasnt_column('public', 'chat_messages', 'user_id', 'Realtime rows carry no account ID');
select hasnt_column('public', 'community_posts', 'author_id', 'Post view excludes account IDs');
select hasnt_column('public', 'community_comments', 'author_id', 'Comment view excludes account IDs');

insert into auth.users (id) values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002'), ('10000000-0000-0000-0000-000000000003');
insert into academic_profiles (user_id, college_id, program_id, catalog_year)
select '10000000-0000-0000-0000-000000000002', college_id, id, catalog_year from academic_programs order by label limit 1;

insert into terms (id, label) values ('TEST-PAST', 'Previous term test');
select throws_ok(
    $$insert into terms values ('TEST-CURRENT', 'Conflicting term', true)$$,
    '23505', null, 'Only one term can be current'
);

insert into section_bundles (term, course_id, bundle_id) values ('2027SP', 'cs400', 'test-async');
select is_empty(
    $$select id from meetings where bundle_id = 'test-async'$$,
    'An asynchronous bundle can have no meeting rows'
);
select throws_ok(
    $$insert into meetings (term, course_id, bundle_id, day, start_min, end_min, mode)
        values ('2027SP', 'cs400', 'test-async', 'MON', 700, 700, 'online_sync')$$,
    '23514', null, 'A meeting must end after it starts'
);
select throws_ok(
    $$insert into meetings (term, course_id, bundle_id, day, start_min, end_min, mode)
        values ('2027SP', 'cs400', 'test-async', 'SUN', 600, 1441, 'online_sync')$$,
    '23514', null, 'Meeting minutes must remain in the campus-local day'
);

insert into user_course_records (id, user_id, term, course_id, bundle_id, credits, status)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2027SP', 'cs400', 'cs400-A', 3, 'enrolled_self_reported');
insert into user_course_records (user_id, term, course_id, bundle_id, credits, status) values
    ('10000000-0000-0000-0000-000000000001', '2027SP', 'math234', 'math234-A', 4, 'enrolled_self_reported'),
    ('10000000-0000-0000-0000-000000000001', 'TEST-PAST', 'cs400', null, 3, 'enrolled_self_reported'),
    ('10000000-0000-0000-0000-000000000002', '2027SP', 'cs400', 'cs400-A', 3, 'planned'),
    ('10000000-0000-0000-0000-000000000003', '2027SP', 'cs400', 'cs400-A', 3, 'enrolled_self_reported');
select throws_ok(
    $$insert into user_course_records (user_id, term, course_id, credits, status)
        values ('10000000-0000-0000-0000-000000000001', '2027SP', 'cs400', 3, 'completed')$$,
    '23505', null, 'Completed and enrolled cannot coexist for one user, term and course'
);
insert into grade_entries (record_id, letter_grade) values ('20000000-0000-0000-0000-000000000001', 'A');
insert into saved_schedules (id, user_id, term, mode, name)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2027SP', 'planned', 'Private schedule');
insert into saved_schedule_items (schedule_id, term, course_id, bundle_id, credits)
values ('30000000-0000-0000-0000-000000000001', '2027SP', 'cs400', 'cs400-A', 3);
insert into friendships (requester_id, receiver_id, status) values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'accepted');
insert into posts (id, author_id, course_id, category, body)
values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'cs400', 'test', 'Test post');
update chat_rooms set id = '50000000-0000-0000-0000-000000000001' where term = '2027SP' and course_id = 'cs400';
update chat_rooms set id = '50000000-0000-0000-0000-000000000002' where term = '2027SP' and course_id = 'math234';
insert into chat_rooms (id, term, course_id) values ('50000000-0000-0000-0000-000000000003', 'TEST-PAST', 'cs400');

set local role anon;
select ok(exists (select from colleges), 'Anon can read colleges');
select ok(exists (select from academic_programs), 'Anon can read programs');
select ok(exists (select from terms where is_current), 'Anon can read the current term');
select throws_ok($$insert into colleges (label) values ('Blocked')$$, '42501', null,
    'Anon cannot write reference data');
select throws_ok($$select * from academic_profiles$$, '42501', null, 'Anon cannot read profiles');
select throws_ok($$select * from courses$$, '42501', null, 'Anon cannot read the course catalog');
select throws_ok($$select * from grade_entries$$, '42501', null, 'Anon cannot read grades or GPA inputs');
select throws_ok($$select * from saved_schedule_items$$, '42501', null, 'Anon cannot read schedules');
select throws_ok($$select * from schedule_free_busy('10000000-0000-0000-0000-000000000001', '2027SP', 'planned')$$,
    '42501', null, 'Anon cannot read free/busy');
select throws_ok($$select * from chat_messages$$, '42501', null, 'Anon cannot read messages');
select lives_ok($$insert into post_reports (post_id, reason) values ('40000000-0000-0000-0000-000000000001', 'Anon report')$$,
    'Anon can submit a post report without exposing its contents');
select throws_ok($$select * from post_reports$$, '42501', null, 'Anon cannot read reports');

reset role;
set local role service_role;
select lives_ok($$update courses set title = null where id = 'cs400'$$, 'Service role can write catalog');
select is((select count(*) from post_reports), 1::bigint, 'Service role can read post reports');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select ok(exists (select from meetings where day = 'MON'), 'Signed-in users can read catalog meetings');
select throws_ok($$update courses set title = 'Blocked'$$, '42501', null, 'Users cannot write the catalog');
select is_empty($$select user_id from academic_profiles$$, 'Another user profile is invisible');
select lives_ok(
    $$insert into academic_profiles (user_id, college_id, program_id, catalog_year)
        select auth.uid(), college_id, id, catalog_year from academic_programs order by label limit 1
        on conflict (user_id) do update set program_id = excluded.program_id$$,
    'Owner can upsert their own academic profile'
);
select results_eq($$select letter_grade::text from grade_entries$$, $$values ('A'::text)$$,
    'Owner can read their own grade');
select is((select count(*) from my_chat_rooms()), 2::bigint, 'Only enrolled current-term course rooms are listed');
select results_eq($$select course_code from my_chat_rooms()$$, $$values ('COMP SCI 400'::text), ('MATH 234')$$,
    'Chat room list is sorted by course code');
select ok(not is_room_member('50000000-0000-0000-0000-000000000003'), 'An enrolled record in a prior term gives no access');
select throws_ok($$select join_chat_room('50000000-0000-0000-0000-000000000003')$$, '42501', null, 'Prior-term room join denied');

select ok(join_chat_room('50000000-0000-0000-0000-000000000001') is not null, 'Eligible user can join and get an alias');
select is(join_chat_room('50000000-0000-0000-0000-000000000001'), (select my_alias from my_chat_rooms() where room_id = '50000000-0000-0000-0000-000000000001'),
    'Repeated joins keep the same room alias');
select lives_ok(
    $$insert into chat_messages (room_id, alias, body)
        select room_id, my_alias, 'B8 chat test' from my_chat_rooms() where room_id = '50000000-0000-0000-0000-000000000001'$$,
    'Eligible user can post with their own alias'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select ok(join_chat_room('50000000-0000-0000-0000-000000000001') is not null, 'Another current-course user can join');
select throws_ok(
    $$insert into chat_messages (room_id, alias, body)
        select room_id, alias, 'Spoof' from chat_messages where room_id = '50000000-0000-0000-0000-000000000001'$$,
    '42501', null, 'A member cannot send under another member alias'
);
select is((select participant_count from my_chat_rooms() where room_id = '50000000-0000-0000-0000-000000000001'), 2::bigint,
    'Participant count includes joined, currently eligible members');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select is_empty($$select record_id from grade_entries$$, 'Even an accepted friend cannot read grades');
select is_empty(
    $$with matched as (update grade_entries set letter_grade = 'F' where record_id = '20000000-0000-0000-0000-000000000001' returning record_id) select record_id from matched$$,
    'A friend cannot update grades'
);
select is_empty($$select room_id from my_chat_rooms()$$, 'A planned record exposes no rooms');
select is_empty($$select id from chat_rooms where id = '50000000-0000-0000-0000-000000000001'$$, 'Direct room lookup is also blocked');
select is_empty($$select id from chat_messages where room_id = '50000000-0000-0000-0000-000000000001'$$, 'Nonmembers see no room messages');
select throws_ok($$select join_chat_room('50000000-0000-0000-0000-000000000001')$$, '42501', null, 'Planned record cannot join the room');
select throws_ok($$select author_id from posts$$, '42501', null, 'Author IDs cannot be read from base posts');
select is_empty(
    $$with matched as (update community_posts set body = 'Cross-user update' where id = '40000000-0000-0000-0000-000000000001' returning id) select id from matched$$,
    'Other users cannot edit a community post'
);
select lives_ok(
    $$insert into community_comments (post_id, body) values ('40000000-0000-0000-0000-000000000001', 'A reply')$$,
    'Community comment view accepts a signed-in author'
);
select throws_ok($$select author_id from comments$$, '42501', null, 'Author IDs cannot be read from base comments');
select lives_ok(
    $$insert into user_blocks (blocked_id) values ('10000000-0000-0000-0000-000000000001')$$,
    'A signed-in user can create their own block'
);
select is_empty($$select id from community_posts where id = '40000000-0000-0000-0000-000000000001'$$, 'Blocked authors are hidden from the feed');
delete from user_blocks where blocked_id = '10000000-0000-0000-0000-000000000001';

-- Exercise all visibility levels for owner, accepted friend and nonfriend.
reset role;
create function pg_temp.schedule_access(
    permission public.visibility, viewer uuid, expected_raw bigint, expected_busy bigint, label text
) returns setof text language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', viewer::text, true);
    return next is((select count(*) from saved_schedules where id = '30000000-0000-0000-0000-000000000001'),
        expected_raw, label || ' / ' || permission || ' / raw schedule');
    return next is((select count(*) from saved_schedule_items where schedule_id = '30000000-0000-0000-0000-000000000001'),
        expected_raw, label || ' / ' || permission || ' / raw items');
    return next is((select count(*) from schedule_free_busy('10000000-0000-0000-0000-000000000001', '2027SP', 'planned')),
        expected_busy, label || ' / ' || permission || ' / busy blocks');
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
insert into schedule_permissions (owner_id, viewer_id) values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'), ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003');
select * from pg_temp.schedule_access('private', '10000000-0000-0000-0000-000000000001', 1, 2, 'owner');
select * from pg_temp.schedule_access('private', '10000000-0000-0000-0000-000000000002', 0, 0, 'friend');
select * from pg_temp.schedule_access('private', '10000000-0000-0000-0000-000000000003', 0, 0, 'nonfriend');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
update schedule_permissions set visibility = 'free_busy';
select * from pg_temp.schedule_access('free_busy', '10000000-0000-0000-0000-000000000001', 1, 2, 'owner');
select * from pg_temp.schedule_access('free_busy', '10000000-0000-0000-0000-000000000002', 0, 2, 'friend');
select * from pg_temp.schedule_access('free_busy', '10000000-0000-0000-0000-000000000003', 0, 0, 'nonfriend');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
update schedule_permissions set visibility = 'full';
select * from pg_temp.schedule_access('full', '10000000-0000-0000-0000-000000000001', 1, 2, 'owner');
select * from pg_temp.schedule_access('full', '10000000-0000-0000-0000-000000000002', 1, 2, 'friend');
select * from pg_temp.schedule_access('full', '10000000-0000-0000-0000-000000000003', 0, 0, 'nonfriend');
select is(schedule_visibility('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')::text, 'private', 'A caller cannot impersonate another viewer');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
delete from schedule_permissions where viewer_id = '10000000-0000-0000-0000-000000000002';
select * from pg_temp.schedule_access('private', '10000000-0000-0000-0000-000000000002', 0, 0, 'friend after permission revocation');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
insert into schedule_permissions values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'full');
delete from friendships where requester_id = '10000000-0000-0000-0000-000000000001' and receiver_id = '10000000-0000-0000-0000-000000000002';
select * from pg_temp.schedule_access('full', '10000000-0000-0000-0000-000000000002', 0, 0, 'former friend');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
    $$update user_course_records set status = 'withdrawn' where id = '20000000-0000-0000-0000-000000000001'$$,
    'Student can withdraw their self-reported record'
);
select is_empty($$select id from chat_messages where room_id = '50000000-0000-0000-0000-000000000001'$$, 'Withdrawal immediately denies message reads');
select throws_ok(
    $$insert into chat_messages (room_id, alias, body) values ('50000000-0000-0000-0000-000000000001', 'old-alias', 'After withdrawal')$$,
    '42501', null, 'Withdrawal immediately denies sends'
);
select is_empty($$select room_id from my_chat_rooms() where room_id = '50000000-0000-0000-0000-000000000001'$$, 'Withdrawn room disappears from the list');

reset role;
select * from finish();
rollback;
