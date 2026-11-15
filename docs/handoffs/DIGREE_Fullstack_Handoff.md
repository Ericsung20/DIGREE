# DIGREE | Full-stack 개발 핸드오프

> **대상:** 풀스택 개발 담당자 / AI 코딩 도구에 전달할 기준 문서  
> **버전:** 1.0 · Hackathon MVP · 2026-11-14  
> **한 줄 목표:** 앱은 데이터를 수집·정규화하고 사용자 경험을 책임진다. 시간표 최적화는 독립 API로 호출한다.

## 0. 1분 요약

- **네 책임:** 앱 화면, 계정·DB, course history 입력, 학사 데이터 연결, GPA, Schedule, Community, Chat, Friends, 보안, 배포 및 최적화 API 호출.
- **알고리즘 담당 책임:** 이미 정규화된 과목/섹션/도보시간/제약 조건을 받아 `POST /v1/schedules/generate` 결과를 반환.
- **절대 하지 말 것:** 앱에서 별도의 시간표 최적화 로직 구현, 학생의 실제 수강 여부를 자체 입력만으로 검증되었다고 표현, 비공개 UW 학적 API 접근 시도.
- **공통 기준 파일:** `DIGREE_API_CONTRACT_v1.yaml`, `DIGREE_fixture_request.json`, `DIGREE_fixture_expected_response.json`.
- **첫 통합 목표:** 목업 데이터 → Generate 버튼 → 최적화 서비스 → Top 3 시간표 → Save → My Schedule 반영.

## 1. 제품 정의 및 화면 설계

**DIGREE = Schedule-first 대학생 학업 도구.** 하단 탭 순서는 다음과 같이 고정한다.

`Schedule | GPA | DIG (중앙 강조) | Community | Chat`

Profile/Settings는 상단 아바타에 배치한다. 앱 최초 진입 시 **My Schedule**이 기본 화면이다.

| 화면 | MVP에서 반드시 동작할 행동 | 후순위 |
|---|---|---|
| **Onboarding / Academic Profile** | College → 해당 Major만 보이는 dependent dropdown → catalog year → 과거/현재 수강 입력 | 모든 전공의 완벽한 학위감사 |
| **DIG** | 학기/목표 학점/필수과목/필터 입력 → Generate → Top 3~5 결과 → 저장 | 실시간 정원, 고급 추천 |
| **Schedule** | 현재 학기 주간표, 과목 탭 시 Course Detail, 직접 수정/저장 | 학교에서 자동 수강내역 수집 |
| **Friends** | 친구 요청/수락, 허용된 시간표 보기, 공개범위 설정 | 공통 공강 고급 분석 |
| **GPA** | 학기별 과목/학점 불러오기, 수동 성적, 학기/누적/전공 GPA 및 line graph | 공식 성적표와 100% 동기화 |
| **Community** | 글·댓글·과목 태그·검색·신고 | 복잡한 추천 피드 |
| **Chat** | 현재 학기 자기신고 수강 과목 방만 노출, 알파벳순, 익명 이름, 참여 인원, 실시간 메시지 | 공식 등록 인증/DM/미디어 |

### 핵심 UX 플로우

1. **Signup → Academic Profile:** 학교/단과대 선택, 그 소속 전공 dropdown, 적용 catalog year 선택.
2. **Course History:** 과거 `completed`와 현재 `enrolled_self_reported` 과목을 검색하여 추가; 현재 과목은 section 선택. `planned`와 구분.
3. **Degree tracking:** 사용자 선택 방식은 (A) 전공·catalog year + 수동 수강 이력 비교 또는 (B) 자발적 DARS PDF 업로드/추출 결과 확인. **두 방식 모두 정규화된 `degree_progress`에 저장.** PDF 파싱은 선택적 확장 기능.
4. **DIG:** 고정 수업, 추가로 원하는 학점, 시간/요일/도보 선호 지정 → 서버 API 호출 → 결과 비교·저장.
5. **Schedule:** 저장된 계획을 표시. 사용자가 `현재 수강 중`으로 표시한 수업과 **DIG에서 저장한 미래 계획을 섞지 않는다.**
6. **Chat:** 현재 학기의 `enrolled_self_reported` 레코드로 접근 권한 판단; 단, **학교 인증 수강생이라고 표현하지 않는다.**

## 2. 권장 구조와 소유권

> 기술 스택은 제안안이다. 변경할 경우 팀이 **개발 시작 전에 하나로 확정**한다.

```text
[Next.js + TypeScript UI]
          |
[Next.js server route / BFF] --- [Supabase Auth + PostgreSQL + Realtime]
          |                               |
          |                       course/profile/grade/chat
          |
          +--> [Catalog / Degree / Madgrades data adapters]
          |          |
          |    normalize + cache
          |
          +--> POST /v1/schedules/generate
                         |
                [Python FastAPI optimizer]
                         |
                   pure computation
```

**경계선:**

| Full-stack 소유 | Algorithm 소유 |
|---|---|
| 외부 소스 수집/캐시, DB, 로그인/권한 | 요청 스키마 검증, 조합 생성 |
| 과목·섹션 정규화, prerequisites 상태 판정 | 시간 충돌·이동시간 검사 |
| DARS PDF 추출 및 사용자 확인 UI | 이수요건 점수(`requirement_fit`) 활용 |
| 교수·Madgrades 데이터 정규화 | 후보 선택/가중치 점수/Top K |
| Google Maps/로컬 도보시간 매트릭스 구축 | 제공된 매트릭스로 이동 가능성 판정 |
| 결과 렌더링, 저장, Chat·Community·GPA | API 서버, 테스트, 탐색 진단 |

**데이터 원칙:** 최적화 API에 `user_id`, email, GPA 원본, DARS 원본 PDF, 비밀번호, 채팅 메시지를 전송하지 않는다. 필요한 **익명화된 계산 입력**만 전달한다.

## 3. 가장 먼저 만들어야 하는 데이터 모델

다음은 초기 스키마의 개념 정의다. PK/FK와 인덱스, Row Level Security는 구현 단계에서 확정한다.

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `users` / `academic_profiles` | user_id, college_id, program_id, catalog_year | 국제학생 규정은 별도 확인 상태로 관리 |
| `colleges` / `academic_programs` | id, parent_college_id, label, catalog_year | **dependent dropdown**의 데이터 소스 |
| `courses` | id, code, title, credits, breadth, repeatable | 정확한 외부 소스/갱신시점 저장 |
| `sections` / `meetings` | term, bundle_id, day, start_min, end_min, building_id | lecture+lab 조합을 단일 bundle로 구성 가능해야 함 |
| `user_course_records` | user_id, term, course_id, bundle_id, credits, status, source | `completed`, `enrolled_self_reported`, `planned`, `withdrawn` |
| `grade_entries` | record_id, letter_grade, is_final, counts_toward_major | 성적은 사용자 입력, 외부 공유 금지 |
| `degree_progress` | user_id, program_id, requirement_id, credits_remaining, source, review_status | `manual`, `dars_pdf`, `unverified` 등 |
| `saved_schedules` / `saved_schedule_items` | user_id, term, mode, course_id, bundle_id | generated 계획과 enrolled 시간표 분리 |
| `friendships` / `schedule_permissions` | requester_id, receiver_id, status, visibility | 기본 비공개 |
| `posts` / `comments` | author_id, course_id?, category, body, created_at | 신고/차단 관리 필요 |
| `chat_rooms` / `chat_memberships` / `chat_messages` | term, course_id, user_id, alias, message | 서버 측 입장 인증 필수 |

**중요한 상태 차이:** `planned`는 학교 등록이 아니고, `enrolled_self_reported`도 실제 등록이 검증된 것이 아니다. UI 문구에 그대로 반영한다.

## 4. Full-stack이 맡는 데이터 수집 및 정규화

### 4.1 공개 학사 데이터

- **UW–Madison Guide / 공개 Course Search & Enroll:** course/section, 학점, breadth, prerequisite, term, 시간, 강의실, instruction mode를 가능한 범위에서 확보. **공식 지원·사용 가능한 API인지 확인**하며 확인되지 않은 엔드포인트를 의존성으로 고정하지 말 것.
- **Madgrades:** 사용 조건과 API 키를 확인하여 grade distribution을 수집·캐시. 과목 코드, 교수, 학기 매칭 시 정규화에 주의.
- **Walking:** 지도 서비스에서 **도보 소요 분**을 가져오거나 목업 거리 매트릭스를 DB에 저장. `building_id` 기준 엣지 목록으로 API에 제공. 도보시간 **조회는 풀스택의 책임**이며 최적화 호출 중 외부 지도 API를 직접 호출하지 않는다.
- **Rate My Professors:** 검증된 공식 공개 API를 전제하지 않는다. 접근이 허용된 정보만 선택적으로 사용하며, 없으면 `instructor_score: null`.
- **Degree requirements:** 학교/전공/적용 연도에 따른 요건을 **지원 전공 몇 개만 큐레이션**하여 먼저 구현. 불확실한 해석은 UI에서 사용자가 검토하도록 한다.

### 4.2 DARS 두 가지 경로

**A. Manual tracking:** College → Major → 적용 연도 선택 후 수강 이력과 준비된 요건 규칙을 비교. 처음부터 모든 전공에 대한 공식 DARS와 동일한 정확도를 약속하지 않는다.

**B. Optional PDF import:** 사용자가 직접 제공한 DARS PDF를 파싱하고 항목별 신뢰도/근거를 표시 → **확인 화면** → 구조화된 degree-progress만 저장. 원본 PDF는 가능한 한 클라이언트에서 처리하고, 서버 업로드가 필요하면 접근 통제 및 삭제 정책을 확정한다. **PDF 업로드 = 학교 등록 검증이 아니다.**

**중요:** 2026–27부터 일부 GenEd 표시 방식이 변경되었고, catalog year는 개인의 학적 이력에 따라 달라질 수 있다. 전공만으로 모든 요건을 단정하지 않는다.

### 4.3 정규화 인터페이스

알고리즘 담당에게 넘길 것은 원본 API 응답이 아니라 **고정된 JSON 규격**이다.

- Course 코드 예: `COMP SCI 400`, 내부 id 예: `cs400`.
- Section은 단일 section이 아니라 필요 시 **lecture + discussion + lab의 유효한 묶음 `section_bundles`**로 제공.
- Meeting 시간은 `HH:MM` 문자열이 아닌 **현지 자정 이후 분**. 예: 10:00 → `600`.
- 여러 요일에 진행되면 `meetings`에 요일별 개별 행.
- 비동기 수업은 `meetings: []`; 대면 건물 미확인 시 `building_id: null`로 처리하고 미확인 경고.
- 선수요건은 `eligible / ineligible / unknown`으로 명시. `unknown`을 임의로 `eligible`로 바꾸지 않는다.
- 가변학점 과목은 `credit_options` 배열. 완료된 비반복 과목은 추천 후보에 넣지 않거나 `already_completed: true`로 표시.
- `walking_edges`에는 건물 쌍별 분 단위 추정치. 없으면 최적화가 추정치를 지어내지 않는다.

## 5. 최적화 API 연결 명세 — 두 사람이 공통으로 사용할 계약

**공식 소스 파일:** `DIGREE_API_CONTRACT_v1.yaml` (OpenAPI 3.0.3). 이를 변경하려면 양측 동의와 버전 업데이트가 필요하다.

| 메서드 | 주소 | 역할 |
|---|---|---|
| GET | `/health` | 최적화 서비스 가용 여부 |
| POST | `/v1/schedules/generate` | 요청 1건 → 가능한 상위 시간표 0~5개 |

**요청:** `contract_version, request_id, term, top_k, constraints, preferences, courses, walking_edges`.

**응답:** `contract_version, request_id, term, results[], diagnostics`.

각 결과에는 `rank`, `score` (0~100), `status` (`ready | needs_review`), `selected[]` (course/bundle/credits/meetings), `metrics` (총 학점/주간 이동분/공강분/등교일), `warnings[]`, `reasons[]`가 포함된다.

### 동일한 fixture로 통합 테스트

```bash
curl -s http://localhost:8000/health
curl -s -X POST http://localhost:8000/v1/schedules/generate \
  -H 'Content-Type: application/json' \
  --data-binary @DIGREE_fixture_request.json
```

**기준 데모:** 3개 필수 과목, 총 10학점, 오전 10시 이후, 이동 최소화. 정답 결과는 **주간 수업 간 도보 0분인 조합이 1위**, 다음 12분, 36분. `DIGREE_fixture_expected_response.json`과 비교한다. 이 수치는 **가상 데이터만을 위한 기준**이다.

**BFF 권장:** 웹 UI → 인증된 앱 서버(BFF) → 최적화 서비스. 최적화 서비스가 브라우저의 세션 토큰을 직접 해석하지 않아도 되도록 앱 서버가 요청을 준비한다. 인증된 사용자만 저장할 수 있도록 서버에서 소유권을 검사한다.

### UI 상태를 반드시 구현

1. `idle` — 과목과 필터 선택 중
2. `loading` — Generate 요청 진행 중; 버튼 중복 클릭 방지
3. `success` — 상위 3~5개 카드, 점수/도보/학점, 미확인 경고, 저장 버튼
4. `empty` — `results: []`; `diagnostics.no_results_reasons` 안내 후 필터 완화
5. `error` — 422 유효성 오류, 503 서비스 오류, 네트워크 오류를 분리 안내
6. `saved` — 저장한 계획을 **planned** 스케줄로 보여주고, 현재 수강 시간표와 구분

## 6. 기능별 구현 체크리스트

### 6.1 Schedule & Friends

- [ ] 현재 학기 주간 timetable을 초기 화면에 표시; 과목 블록 클릭 → Course Detail.
- [ ] `planned` / `enrolled_self_reported` 탭 또는 명확한 배지 구분.
- [ ] accepted friends 목록; 한 명 클릭 시 허용된 시간표 열기.
- [ ] `private` 기본, `free_busy`, `full` 중 사용자가 명시적으로 설정.
- [ ] 친구 관계 해제/권한 철회 즉시 서버에서 반영. GPA는 항상 숨김.

### 6.2 GPA

- [ ] 과거+현재 학기 수업/학점을 user_course_records에서 가져오기.
- [ ] letter grade(A=4, AB=3.5, B=3, BC=2.5, C=2, D=1, F=0) **직접 선택**.
- [ ] 학기 GPA, 누적 GPA, 전공 GPA(사용자 선택한 major-course 플래그), 누적 이수학점 계산.
- [ ] 총 이수학점 / 전공 이수학점 / 수강 중 학점을 분리.
- [ ] **학기별 overall vs major-only GPA line graph**, 데이터 없으면 빈 값으로 표현.
- [ ] 현재 학기 성적은 예상(`projected`)으로 표시. 불완전/Pass/Fail/재수강 정책은 별도 처리.

### 6.3 Community

- [ ] 전체 피드 + 과목 tag 기반 필터; 게시글/댓글 CRUD.
- [ ] Course Detail에서 해당 과목 태그 게시글 진입.
- [ ] 검색, 최신 정렬, 기본 신고/삭제/관리; 익명 표시명과 내부 계정 ID 분리.

### 6.4 Course Chat

- [ ] DB 시드 스크립트로 **해당 학기 개설 과목별 1개 방** 사전 생성. 모든 과목 수동 클릭 생성 금지.
- [ ] `term + course_id` unique key; 같은 과목의 여러 섹션은 하나의 방.
- [ ] 현재 학기의 `enrolled_self_reported` 과목방 **만** 채팅 목록에 노출, **course code 알파벳순**.
- [ ] 방 제목 + 현재 참여 인원 + 익명 별명 + 실시간 메시지/타임스탬프.
- [ ] 방 URL을 직접 입력해도 서버가 self-reported membership 확인. 방 목록만 숨기는 것으로는 부족.
- [ ] 수강 취소 시 채팅 접근 취소. 신고·스팸 대응·사용자 차단을 최소 기능으로 구현.
- [ ] 화면에는 “Self-reported course membership” 안내. **학교가 검증한 수강생 전용이라고 홍보하지 않음.**

## 7. AI로 개발할 때의 순서

### P0 — 바로 해야 할 일 (알고리즘 없이도 진행)

1. 프로젝트 리포지토리, 앱 구동, Auth/DB, schema migration, `.env.example`.
2. `colleges → academic_programs` dependent dropdown 및 Course History 수동 입력 화면.
3. **Mock data adapter** 작성: `DIGREE_fixture_request.json`을 그대로 반환하는 `buildGenerateRequest()` 구현.
4. Generate UI와 result cards를 **`DIGREE_fixture_expected_response.json` 목업으로 완성**.
5. Course/Schedule 저장과 GPA 계산을 연결.

### P1 — 알고리즘과 첫 연결

1. 알고리즘 담당의 `/health` 및 generate endpoint 접속.
2. mock result를 **실제 HTTP 응답**으로 치환. 데이터 필드명/의미 변경 금지.
3. 같은 fixture 요청에 대해 순위·도보시간·bundle ID가 정확히 매칭되는지 공동 확인.
4. DB의 실제 course/section rows를 API input으로 변환하는 adapter 연결.

### P2 — 통합 기능과 데모

1. Community/Chat/Friends의 최소 동작 구현.
2. Madgrades 및 도보 데이터 연동 (불가능하면 **출처 명시된 mock**).
3. 반복 가능한 데모 계정과 seed 스크립트, 접근권한 테스트, 에러/빈 결과 화면.
4. 공유/개인정보 QA, 모바일 반응형, 배포, 최종 데모 리허설.

## 8. 최종 완료 기준 (Definition of Done)

- [ ] 새 사용자가 college→major를 선택하고 학기별 3과목을 수동 입력할 수 있다.
- [ ] `DIG` 호출로 실제 알고리즘 응답이 온다; `score, status, selected, metrics` 표시.
- [ ] `Save`하면 planned 시간표로 반영되고 이후 수정 가능하다.
- [ ] 현재 학기 course records → GPA와 Chat 목록이 일관되게 연결된다.
- [ ] 친구는 **명시적으로 허용된 범위**의 Schedule만 조회한다.
- [ ] 수강 과목이 없는 사용자는 빈 Chat 목록과 안내를 본다.
- [ ] 로그인 없는 사람이 다른 학생의 GPA/친구 시간표/채팅 메시지를 API로 조회할 수 없다.
- [ ] 외부 API 부재 시 mock 모드로 **끝까지 시연 가능**하다.

## 9. 매일 협업 방식 (서로 AI를 써도 코드가 충돌하지 않게)

**공동 첫 30분:** API 계약(`v1`), 시간 단위, course/section ID, demo term, 폴더 경로, 역할 소유권을 승인한다.

**권장 폴더:**

```text
digree/
  apps/web/                     # Full-stack owns
  apps/optimizer/               # Algorithm owns
  contracts/openapi.yaml        # Jointly approved, locked v1
  fixtures/request.json         # Shared, immutable for v1
  fixtures/expected.json        # Shared, immutable for v1
  docs/                         # Handoff and decisions
```

**브랜치:** `feature/web-*`, `feature/optimizer-*`; `contracts/` 변경은 두 사람 모두 리뷰.

**Sync 3회:** (1) 시작: 계약/범위, (2) 중간: fixture 기반 HTTP 첫 연결, (3) 종료: 통합 테스트/데모. 매일 10분씩 `완료 / 막힌 점 / 계약 변경 필요`를 공유.

**계약 변경 룰:** 스키마·enum·필드명 변경은 반드시 (a) 논의, (b) OpenAPI 수정, (c) 양쪽 fixture 및 테스트 수정, (d) 각자 AI 세션에 새 버전 전달 순서. **AI가 임의로 API 형식을 바꾸도록 두지 않는다.**

## 10. 풀스택 AI 코딩 도구에 붙여넣을 프롬프트

> You are implementing **only the full-stack application** of DIGREE. Read this handoff, `DIGREE_API_CONTRACT_v1.yaml`, and both JSON fixtures first. Use Next.js + TypeScript + PostgreSQL/Supabase unless the team approves a different stack. Implement the five tabs in the specified order. Own the data ingestion/normalization adapter and call `POST /v1/schedules/generate` server-side. Do **not** implement a second scheduling algorithm or change the API contract. Until the optimizer is available, make the Generate UI work against the exact expected fixture. Distinguish planned courses, self-reported enrollment, and officially verified enrollment. Protect GPA and sharing permissions with server-side authorization. Deliver incremental files, migrations, tests, and setup commands. Never invent official UW–Madison private API access.

**주의:** 학교 공개 페이지가 존재한다는 사실은 개인 학적 연동 API의 이용 허가를 의미하지 않는다. 해커톤 MVP는 사용자 수동 입력과 seeded mock으로 완결되도록 만든다.

## 11. 유용한 검증 링크 / 외부 의존성

- UW–Madison Course Search & Enroll: https://registrar.wisc.edu/course-search-enroll/
- UW–Madison Guide: https://guide.wisc.edu/
- DARS 설명: https://registrar.wisc.edu/dars/
- Madgrades API: https://api.madgrades.com/

