# DIGREE DB 구성 정리

2026-11-23 실제 Supabase 조회와 `db_fix` 구현을 기준으로 정리했다. 데이터 건수는 조회 시점의 값이다.

기존 데이터를 보존하면서 **공통 대학 자료 → 개인 학업 기록 → 시간표·공유**로 역할을 나눈 구조다. 기존 DIGREE Supabase 프로젝트를 공동 개발 DB로 사용하며, 별도 운영 DB는 아직 분리하지 않았다. 각 개발자는 웹과 optimizer를 자기 컴퓨터에서 실행한다. 평소 개발에는 Docker가 필요 없고, 격리된 로컬 DB 회귀 검사에만 사용한다.

## 영역별 구성

| 영역 | 주요 테이블 | 역할 |
|---|---|---|
| 계정 | `auth.users`, `private.account_emails` | 로그인 계정과 정규화된 이메일 중복 방지 |
| 과목 | `courses`, `course_aliases` | 과목의 고유 ID와 cross-list 이름 |
| 학기별 개설 정보 | `terms`, `course_offerings` | 학기별 학점·과목명·분류·재수강 가능 여부 |
| 분반·수업 시간 | `section_bundles`, `meetings` | 분반 조합, 요일, 시간, 수업 방식, 강의실 |
| 선수조건·과목 특성 | `course_requisites`, `course_designations`, `course_instructors` | 선수조건, 교양 분류, 교수 정보 |
| 전공·졸업 요건 | `program_versions`, `requirement_groups` | 전공과 catalog year에 맞는 졸업 조건 |
| 개인 학업 기록 | `academic_profiles`, `academic_profile_programs`, `user_course_records`, `grade_entries` | 선택 전공, 이수·수강 중·계획 과목, 개인 성적 |
| 편입 학점 | `transfer_credits` | 인정된 UW 과목, 인정 학점·학기, 선택적인 학교·메모 |
| 저장된 시간표 | `saved_schedules`, `saved_schedule_items` | 학기별 계획과 선택한 과목·분반 |
| 건물·이동 | `buildings`, `walking_edges` | 강의 건물과 건물 사이 이동 시간 |
| 친구·커뮤니티 | `friendships`, `user_blocks`, 게시판·채팅 테이블 | 친구 관계, 차단, 게시글, 수업 채팅 |

## 과목과 cross-list

과목은 이름이 아니라 하나의 고유 ID로 연결한다. 예를 들어 `CS 240`, `COMP SCI 240`, `MATH 240`은 같은 과목 ID에 연결되고 화면에는 `CS/MATH 240`으로 표시된다. 검색·선수조건·졸업 요건에서 이 연결을 사용한다.

`courses`가 과목의 기준 정보를 저장하고, `course_aliases`가 여러 이름을 연결한다. `course_offerings`는 `(학기, 과목 ID)`별 학점·분류·재수강 가능 여부를 보존한다. 분반과 수업 시간은 `(term, course_id, bundle_id)` 조합을 유지해 optimizer 및 저장된 시간표와 연결한다.

## 전공과 졸업 요건

`program_versions`가 전공·부전공·certificate와 catalog year를 구분하고, `requirement_groups`가 해당 버전의 조건을 저장한다. 조건 안에는 과목 목록뿐 아니라 GPA, residency, 학점 제한, 각주 같은 원문도 들어 있다.

기존 `academic_programs`, `program_requirement_catalog`, `supplemental_program_catalog`는 원본 전공·요건 자료로 유지한다. 원본이 바뀌면 트리거가 앱 조회용 `program_versions`와 `requirement_groups`를 갱신한다.

알려진 과목 요건은 `4 of 5 · 1 now`처럼 충족 수·필요 수·현재 이수 중인 수를 표시한다. 추가 조건이 있어도 숫자를 숨기지 않는다. 다만 모든 원문 조건이 자동 실행 가능한 규칙으로 변환된 상태는 아니다. GPA·residency·중복 인정 제한 등 별도 조건이 남으면 상세 내용에서 검토 안내를 보여주며, 자동 `Done` 판정에는 이를 반영한다.

## 개인 수강 기록과 편입 학점

직접 이수한 과목과 성적은 `user_course_records`·`grade_entries`에 저장한다. 기록의 상태는 이수 완료, 수강 중, 계획, 철회로 구분한다.

외부에서 인정받은 학점은 `transfer_credits`에 저장한다. 앱에서는 인정된 UW 과목과 학점만으로 입력할 수 있다. 학교·메모는 선택 사항이고, 인정 학기를 별도로 지정하지 않으면 현재 학기를 사용한다. 기존 원래 과목 정보는 보존한다.

UW 대응 과목이 연결된 편입 학점은 선수조건과 졸업 요건의 이수 근거로 사용한다. UW GPA, residency 이수, 현재 수강 중인 과목의 채팅 자격에는 포함하지 않는다. 성적이 없는 편입 기록만으로 최소 성적 조건을 충족했다고 판정하지 않는다. 비반복 과목을 UW 이수 기록과 편입 기록에 모두 입력해도 학점은 한 번만 계산한다.

## DIG 계획 저장

추천 결과는 `saved_schedules`와 `saved_schedule_items`에 저장한다. `save_schedule` 함수가 시간표 전체를 한 트랜잭션으로 저장하며, 사용자·학기별 계획을 최대 3개까지 유지한다. `plan_slot` 1~3으로 Plan 1·2·3을 구분한다. 새 계획은 빈 슬롯에 저장하고, 이미 3개라면 기존 계획을 먼저 삭제하도록 안내한다. 기존 계획을 자동으로 덮어쓰지 않는다.

계획은 화면의 **Plans**, 실제 수강 기록은 **Enrolled**로 구분한다. Plans 드롭다운에서 계획을 선택하거나 삭제할 수 있다. 삭제는 `archive_schedule` 함수로 상태를 `archived`로 변경하며, 다음 저장에서 빈 슬롯을 재사용한다. 저장에 성공하면 해당 학기·계획의 Plans 화면으로 이동한다. 미래 학기를 선택하면 Plans가 기본으로 열리고, 현재·과거 학기는 Enrolled가 기본이다. 새로고침 시 활성 계획들을 DB에서 다시 읽으며, 조회 실패와 계획이 없는 상태를 구분해 안내한다.

optimizer는 DB를 직접 읽거나 저장하지 않는다. 웹 서버가 과목·분반·선수조건 등을 읽어 요청을 구성하고 optimizer가 계산한다. 선택한 결과의 DB 저장은 앱의 별도 저장 경로가 담당한다.

## 테이블과 조회용 뷰의 차이

| 주요 뷰 | 실제 저장 기반과 의미 |
|---|---|
| `catalog_courses` | 과목과 cross-list 이름을 합쳐 보여줌 |
| `catalog_instructors` | 교수 기준 정보와 원본에만 남은 교수 정보를 함께 조회 |
| `student_programs` | 주전공·추가 전공·부전공 선택을 합쳐 보여줌 |
| `course_attempts` | `user_course_records`의 이수·수강 중·철회 기록을 조회 |
| `planner_courses` | 같은 저장 테이블에서 계획 과목만 조회 |
| `program_requirement_course_options` | 원본 전공 요건에서 과목 선택지를 추출해 조회 |

뷰는 데이터를 별도로 중복 저장하는 테이블이 아니라, 기존 자료를 필요한 형태로 보여주는 창구다. 개인 수강 기록은 하나의 저장 기반을 유지한다. 반면 원본 전공 요건과 앱 조회용 전공·요건 테이블은 원본과 파생 자료의 관계이며 트리거로 동기화한다.

## 접근 권한

개인 학적·성적·편입 기록은 RLS로 본인에게 제한한다. 친구 수락 후에는 시간표를 공유하며, 친구라는 이유로 개인 성적이나 편입 기록까지 공개하지 않는다. 차단 관계는 시간표 접근에도 반영한다.

`schedule_permissions`는 기존 클라이언트와의 호환성을 위해 남아 있지만 현재 시간표 공유 권한은 수락된 친구 관계와 차단 상태를 기준으로 판단한다. `private`와 `ingestion` 영역은 일반 앱 사용자에게 직접 노출하지 않는다.

## 조회 시점의 규모와 남은 작업

| 항목 | 확인한 값 |
|---|---:|
| `public` 테이블 | 39개 |
| `public` 뷰 | 8개 |
| 적용된 마이그레이션 | 37개 |
| 과목 | 6,890개 |
| 과목 별칭 | 7,952개 |
| 여러 이름이 연결된 과목 | 791개 |
| 학기별 과목 정보 | 10,841개 |
| 전공·연도별 버전 | 1,268개 |
| 그중 주전공 버전 | 763개 |
| 부전공·certificate 버전 | 505개 |
| 졸업 요건 그룹 | 12,728개 |
| 요건이 없는 전공 버전 | 0개 |

최신 적용 마이그레이션은 `20261123090900_three_saved_plans.sql`이다.

수집 이력용 `ingestion.import_runs`·`ingestion.source_snapshots`는 구조를 준비했지만, 조회 시점의 저장 이력은 각각 **0건**이다. 기존 수집 자료 전체의 원본·변경 이력을 이 테이블에서 추적하는 작업은 남아 있다. 정식 배포 전 별도 운영 DB 분리도 필요하다.

관련 문서: [공동 개발 설정](shared-development.md), [DB 기술 설명 및 변경 이력](database-architecture.md), [DB 계약](../supabase/DB_HANDOFF.md), [환경 구분](../supabase/environments.json).
