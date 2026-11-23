begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values('91000000-0000-0000-0000-000000000001','dbfix-owner@wisc.edu'),('91000000-0000-0000-0000-000000000002','dbfix-other@wisc.edu');
select throws_ok($$insert into auth.users(id,email) values('91000000-0000-0000-0000-000000000003',' DBFIX-OWNER@WISC.EDU ')$$,'23505',null,'Normalized email identity prevents case/whitespace duplicate accounts');
select throws_ok($$update auth.users set email='DBFIX-OWNER@WISC.EDU' where id='91000000-0000-0000-0000-000000000002'$$,'23505',null,'Email changes cannot bypass identity uniqueness');
select is((select count(*) from private.account_emails where normalized_email='dbfix-owner@wisc.edu'),1::bigint,'One canonical account identity');

insert into courses(id,code,title,credit_options,repeatable,source) values('dbfix-cross','COMP SCI 240','Discrete Mathematics',array[3],false,'test');
insert into course_requisites(term,course_id,course_aliases,source_url,fetched_at)
values('2027SP','dbfix-cross',array['COMP SCI 240','MATH 240'],'https://public.enroll.wisc.edu',now());
insert into section_bundles(term,course_id,bundle_id) values('2027SP','dbfix-cross','cross-A');
select is((select count(*) from course_aliases where course_id='dbfix-cross'),2::bigint,'Cross-list aliases share a canonical ID');
select is((select display_code from catalog_courses where id='dbfix-cross'),'CS/MATH 240','Consolidated cross-list label');

insert into academic_profiles(user_id,college_id,program_id,catalog_year)
select '91000000-0000-0000-0000-000000000001',college_id,id,catalog_year from academic_programs order by id limit 1;
select is((select count(*) from student_programs where user_id='91000000-0000-0000-0000-000000000001' and is_primary),1::bigint,'Unified programs include the primary major');
select throws_ok($$insert into academic_profile_programs(user_id,kind,program_id)
select user_id,'major',program_id from academic_profiles where user_id='91000000-0000-0000-0000-000000000001'$$,'23505',null,'Primary program cannot be duplicated as additional');

insert into friendships(requester_id,receiver_id,status) values('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','pending');
set local role authenticated;
set local request.jwt.claim.sub='91000000-0000-0000-0000-000000000001';
select is((select id from search_catalog_courses('CS 240') limit 1),'dbfix-cross','CS alias search resolves canonical course');
select is((select id from search_catalog_courses('MATH 240') limit 1),'dbfix-cross','MATH alias search resolves the same course');
select is((select count(*) from search_catalog_courses('240') where id='dbfix-cross'),1::bigint,'Search does not duplicate cross-listed course');
select throws_ok($$select * from private.account_emails$$,'42501',null,'Account identity registry is not exposed to clients');
select throws_ok($$select * from ingestion.source_snapshots$$,'42501',null,'Import raw data is not exposed to clients');
select lives_ok($$insert into transfer_credits(institution,source_course,equivalent_course_id,credits,awarded_term)
values('Other College','MAT 240','dbfix-cross',3,'2027SP')$$,'Owner can record a recognized equivalent');
select throws_ok($$insert into transfer_credits(institution,source_course,credits,awarded_term)
values(' other college ','mat 240',3,'2027SP')$$,'23505',null,'Duplicate source transfer is rejected');
select throws_ok($$insert into transfer_credits(institution,source_course,equivalent_course_id,credits,awarded_term)
values('Another College','X 1','dbfix-cross',3,'2027SP')$$,'23505',null,'Same UW equivalent cannot be credited twice');
select throws_ok($$insert into transfer_credits(institution,source_course,credits,awarded_term)
values('Other College','bad',-1,'2027SP')$$,'23514',null,'Negative transfer credits are rejected');
select is((select count(*) from grade_entries),0::bigint,'Transfer credits create no UW grade entries');
select is((select count(*) from my_chat_rooms()),0::bigint,'Transfer equivalence grants no current course chat');

select lives_ok($$select save_schedule('2027SP','[{"course_id":"cs400","bundle_id":"cs400-A","credits":3}]','test-one')$$,'Atomic schedule save succeeds');
select is((select count(*) from saved_schedules where state='active'),1::bigint,'One active plan');
select throws_ok($$select save_schedule('2027SP','[{"course_id":"cs400","bundle_id":"missing","credits":3}]','test-bad')$$,'23503',null,'Wrong bundle rejects entire transaction');
select is((select source_request_id from saved_schedules where state='active'),'test-one','Failed save preserves previous active plan');
select is((select count(*) from saved_schedules),1::bigint,'Failed save leaves no orphan header');
select throws_ok($$select save_schedule('2027SP','[{"course_id":"cs400","bundle_id":"cs400-A","credits":29}]','test-bad-credit')$$,'22023',null,'Invalid credit choice rejected');
select throws_ok($$select save_schedule('2027SP','[{"course_id":"cs400","bundle_id":"cs400-A","credits":3},{"course_id":"cs400","bundle_id":"cs400-A","credits":3}]','test-duplicate')$$,'23505',null,'Same canonical course cannot occur twice');
select lives_ok($$select save_schedule('2027SP','[{"course_id":"math234","bundle_id":"math234-A","credits":4}]','test-two')$$,'Second save succeeds');
select is((select count(*) from saved_schedules where state='active'),1::bigint,'Second save still has only one active plan');
select is((select count(*) from saved_schedules where state='archived'),1::bigint,'Previous plan preserved as archive');

set local request.jwt.claim.sub='91000000-0000-0000-0000-000000000002';
select is((select count(*) from transfer_credits),0::bigint,'Other account cannot read transfers');
select is((select count(*) from student_programs),0::bigint,'Other account cannot read academic profile');
select is(schedule_visibility('91000000-0000-0000-0000-000000000001',auth.uid())::text,'private','Pending friend has no schedule access');
select lives_ok($$update friendships set status='accepted' where requester_id='91000000-0000-0000-0000-000000000001' and receiver_id=auth.uid()$$,'Recipient can accept friendship');
select is(schedule_visibility('91000000-0000-0000-0000-000000000001',auth.uid())::text,'full','Accepted friend gets shared schedule');
select is((select count(*) from transfer_credits),0::bigint,'Accepted friend still cannot read transfers');
select is_empty($$with changed as(update saved_schedules set name='hijack' returning id) select id from changed$$,'Accepted friend cannot mutate owner schedules');
insert into user_blocks(blocked_id) values('91000000-0000-0000-0000-000000000001');
select is(schedule_visibility('91000000-0000-0000-0000-000000000001',auth.uid())::text,'private','User block immediately revokes schedule access');
delete from user_blocks where blocked_id='91000000-0000-0000-0000-000000000001';
delete from friendships where receiver_id=auth.uid();
select is(schedule_visibility('91000000-0000-0000-0000-000000000001',auth.uid())::text,'private','Friend removal immediately revokes schedule access');

reset role;
select * from finish();
rollback;
