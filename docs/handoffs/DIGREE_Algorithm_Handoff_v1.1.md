# DIGREE | 시간표 알고리즘 개발 핸드오프

> **대상:** 시간표 최적화 담당자(너) / AI 코딩 도구에 전달할 기준 문서  
> **문서 버전:** 1.1 · Hackathon MVP · 2026-11-14  
> **API 계약 버전:** 1.0 (변경 없음)  
> **한 줄 목표:** 정규화된 과목·섹션 데이터를 받아, 조건을 만족하는 최상위 3~5개의 시간표를 **독립 API**로 반환한다.

## 0. 네가 최종적으로 제출할 것

```text
apps/optimizer/
  app/main.py                  # FastAPI endpoints
  app/models.py                # OpenAPI와 일치하는 Pydantic models
  app/engine.py                # pure optimization core
  app/scoring.py               # scores + missing-data handling
  tests/test_contract.py       # fixture request -> expected response
  tests/test_constraints.py    # 시간/이동/학점/prerequisite 테스트
  tests/test_ranking.py        # Top K/동점/재현성 테스트
  requirements.txt 또는 pyproject.toml
  Dockerfile
  README.md                    # 로컬 실행/테스트/환경변수
```

**완료의 의미:** 풀스택 담당자가 Python 구현 내부를 전혀 모르더라도 `POST /v1/schedules/generate`로 JSON을 보내고 결과를 바로 렌더링할 수 있는 상태.

## 1. 정확한 역할 범위

| 네가 개발한다 | 네가 개발하지 않는다 |
|---|---|
| 요청 스키마 검증과 실패 메시지 | 앱 로그인·회원가입·DB 권한 |
| 수강 후보 집합 및 섹션 조합 탐색 | 공식 UW·Madgrades·Maps API 호출 |
| hard constraints (시간 충돌, 이동, 학점 등) | 원본 DARS PDF 텍스트 추출 |
| course eligibility 필드에 따른 필터링 | 실제 선수요건 정책 해석/학교 검증 |
| soft scoring, Top K, 설명, diagnostics | GPA 계산기, 시간표 UI, 채팅, 게시판 |
| 재현 가능한 모의 입력·테스트 | 수강생 개인정보/원본 학적 저장 |

### 핵심 원칙

- **계산 엔진은 외부 API/DB와 독립적**이어야 한다. 입력이 같으면 출력도 같다.
- 수업 원본 정보는 풀스택이 정규화한다. **개별 section(LEC/DIS/LAB)과 `section_bundle`은 다르다.** 옵티마이저에는 학교가 허용하는 lecture/discussion/lab **등록 조합 전체를 하나의 `section_bundle`**로 입력한다.
- 수강 중·완료·DARS 정보를 원본으로 받지 않는다. `already_completed`, `repeatable`, `eligibility_status`, `requirement_fit`처럼 **검증 수준이 표시된 계산 필드**만 받는다.
- GPA/사용자 이메일/NetID/친구 정보/원본 DARS PDF는 최적화 API에 전달하지 않는다.
- **공식 수강 보장, 공식 졸업 판정, 비자 규정 준수 보장**이라는 표현을 응답에서 쓰지 않는다.

## 2. 팀과 먼저 고정할 API 계약 (절대 임의로 바꾸지 말기)

**진짜 단일 기준:** `DIGREE_API_CONTRACT_v1.yaml` (OpenAPI 3.0.3). 예시 입출력: `DIGREE_fixture_request.json`, `DIGREE_fixture_expected_response.json`.

| Endpoint | Contract |
|---|---|
| `GET /health` | `{ "status": "ok", "contract_version": "1.0" }` |
| `POST /v1/schedules/generate` | `GenerateRequest` → `GenerateResponse` |

### 요청 요약

```json
{
  "contract_version": "1.0",
  "request_id": "demo-001",
  "term": "2027SP",
  "top_k": 3,
  "constraints": {
    "min_credits": 10, "max_credits": 10,
    "earliest_start_min": 600, "latest_end_min": 1080,
    "blocked_days": [], "walking_buffer_min": 3,
    "max_walk_per_transition_min": 30,
    "exclude_full_sections": false
  },
  "preferences": { "weights": {
    "walking": 1, "idle_gap": 0, "campus_days": 0,
    "grade_outcomes": 0, "degree_fit": 0, "instructor": 0
  }},
  "courses": ["... CandidateCourse objects ..."],
  "walking_edges": ["... WalkingEdge objects ..."]
}
```

이 코드 블록은 **필드 구조 요약**이므로 `courses` 배열이 실제 객체가 아니어서 그대로 요청하면 유효하지 않다. HTTP 호출에는 제공된 완전한 fixture 파일을 사용한다.

### 응답 요약

```json
{
  "contract_version": "1.0",
  "request_id": "demo-001",
  "term": "2027SP",
  "results": [
    {
      "rank": 1, "score": 100.0, "status": "ready",
      "selected": ["... course_id / bundle_id / credits / meetings ..."],
      "metrics": {
        "total_credits": 10,
        "walking_minutes_weekly": 0,
        "idle_gap_minutes_weekly": 20,
        "campus_days": 4
      },
      "warnings": [], "reasons": ["... human-readable explanation ..."]
    }
  ],
  "diagnostics": {
    "explored_combinations": 4,
    "rejected_by_reason": { "time_overlap": 1 },
    "search_truncated": false,
    "no_results_reasons": []
  }
}
```

이 역시 축약 예시다. **응답의 모든 `selected` 항목은 실제 API 계약상의 객체**여야 한다. 결과가 0개여도 **HTTP 200 + `results: []`**를 반환하고 diagnostics에서 원인을 설명한다. 요청 JSON 자체가 잘못된 경우만 422 등 에러로 반환한다.

**계약 불변 요소:** enum 값, `day` 값(MON/TUE/...), 시간 단위(`start_min`, `end_min`), 과목·bundle ID, warning/status 문자열과 JSON 키. 변경은 반드시 팀 합의 후 OpenAPI·fixture·클라이언트 동시 변경.

## 3. 입력 데이터 해석

| 필드 | 의미 | 알고리즘에서의 처리 |
|---|---|---|
| `courses[].is_required` | 유저가 필수로 고정한 과목 | 무조건 포함해야 함 |
| `credit_options` | 가능한 수강 학점들 | 하나 선택; 총 학점 범위 준수 |
| `section_bundles[].meetings` | 섹션 패키지의 모든 회의 시간 | 요일별 충돌 검사 |
| `eligibility_status` | `eligible / ineligible / unknown` | 확실한 `ineligible` 제외; `unknown` 검토 경고 |
| `already_completed` / `repeatable` | 이미 이수/재수강 가능 여부 | 완료+비반복 후보 자동 제외 또는 고정과목이면 원인 명시 |
| `seat_status` | `open / full / unknown` | 정원 제외 옵션이 켜져 있고 데이터가 신뢰 가능할 때만 `full` 제외 |
| `grade_stats` | A/AB 비율 및 표본 수 | optional 과목들 비교에만 주로 사용 |
| `requirement_fit` | 0~1 학위요건 충족 기여 신호 | optional course 추천 점수에 활용; 없으면 비교 근거 없음 |
| `walking_edges` | 건물 쌍 도보 소요 분 | **지도 API 재호출 금지**, 제공된 값으로만 검사 |
| `top_k` | 결과 최대 개수(1~5) | 유효 결과가 적으면 적은 수만 반환 |

**시간:** UW–Madison 현지 시각(`America/Chicago`) 자정부터 분. 학교 API의 시각 인코딩과 DST 여부를 확인한 뒤 정규화한다. 10:00=`600`, 11:50=`710`. 모든 회의는 `[start_min, end_min)` 반열린 구간; 10:50 종료, 10:50 시작은 **시간 충돌 자체는 아님**(이동 가능성은 별도 검사).

**건물 간 이동:** 같은 건물은 0분; `walking_edges`의 `bidirectional=true`는 양방향 동일 거리 뜻. 정보가 없는 서로 다른 건물은 **0분이라고 가정하지 않는다**. `needs_review`와 경고로 표시하고, 정확한 이동 가능성 보장 불가.

**비동기 온라인:** 회의 시간 없음 → `meetings: []`, 학점에는 포함. 대면↔동기온라인 이동은 사용자의 실제 위치가 불확실할 수 있으므로 필요 시 `needs_review`.

## 4. 두 단계의 탐색을 명확히 분리

### Stage A. Course-set selection — “어떤 과목을 들을까?”

- 우선 `is_required=true`를 전부 포함.
- 필수 학점 합이 상한보다 크면 **0개 결과 + 원인**.
- 필수 학점만으로 목표 범위가 충족되면 **선택 과목은 추가하지 않는 것이 기본**.
- 학점이 부족하면 `is_required=false`인 **eligible** 후보 중 optional courses를 조합.
- 선수요건 불확실(`unknown`) 과목은 정책상 허용하되 결과를 `needs_review`로 표시. 확실히 불가능한(`ineligible`) 과목은 제외.
- 이미 이수한 비반복 과목은 자동 추천하지 않음.
- `requirement_fit`이 있으면 남은 전공/breadth 요건을 먼저 채우도록 후보 정렬 또는 soft scoring에 활용.
- **실제 전공 요건을 네가 직접 파싱하지 않는다.** Full-stack이 `requirement_fit`으로 전달한다.

### Stage B. Section-bundle selection — “어떤 시간표로 들을까?”

- 선택한 과목마다 정확히 **하나의 section bundle**을 고른다.
- 필수 lecture+discussion+lab 관계는 bundle 제작 단계에서 이미 유효해야 한다.
- bundle 내 모든 meeting을 요일별로 정렬하여 overlap/요일/시간/이동 검사.
- 동일 과목을 두 번 선택하지 않는다. Cross-list를 같은 과목으로 정규화하는 책임은 upstream.
- 가능한 경우를 탐색한 뒤 점수순으로 Top K 반환. 동일 결과 중복 제거.

## 5. Hard Constraints — 반드시 정확해야 할 것

| 번호 | 조건 | 실패 처리 |
|---|---|---|
| H1 | 필수 course 모두 선택 | 해당 조합 제외 |
| H2 | `min_credits <= 총 학점 <= max_credits` | 해당 조합 제외 |
| H3 | 모든 meeting `start>=earliest`, `end<=latest` | 해당 조합 제외 |
| H4 | `blocked_days`에 고정 수업 시간 없음 | 해당 조합 제외 |
| H5 | 같은 요일에 `[start,end)` 구간 겹침 없음 | 해당 조합 제외 |
| H6 | 연속 대면 수업 사이 `gap >= walking + buffer` | 알려진 이동시간으로 불가능하면 제외 |
| H7 | `max_walk_per_transition_min` 상한 | 알려진 이동이 상한 초과면 제외 |
| H8 | `eligibility_status=ineligible` 또는 완료+비반복 | 후보 제외, 필수이면 결과 0개와 설명 |
| H9 | 필수 bundle 및 과목 중복 없음 | 해당 조합 제외 |
| H10 | `exclude_full_sections=true`이며 `full` 확인 | 해당 bundle 제외 |

`gap = next.start_min - prev.end_min`  
**정확한 부등식:** `gap >= walk_min + buffer_min` (같은 값이면 허용).  
주의: “공백이 이동시간보다 같거나 **작아야** 한다”는 표현은 거꾸로다.

**미확인 정보 정책:** `eligibility_status=unknown`, `seat_status=unknown`, 대면 건물/도보시간 미확인 등은 `needs_review`와 해당 이유를 반환한다. 반드시 검증되어야 하는 자격 조건이 불명확할 경우 UI에서 최종 신청 전 확인하도록 경고. **없는 시간을 임의로 추측하지 않는다.**

**국제학생 정책:** 알고리즘이 국적만 보고 F-1을 자동 판단하지 않는다. 풀스택이 관련 학적 유형과 승인된 예외를 확인한 뒤 적절한 credit rule을 명확하게 넣어야 한다. MVP에서는 12학점/대면학점 관련 **확인 경고**를 표시하고 법적 준수를 보장하지 않는다. 현재 계약은 일반적인 `min_credits/max_credits`만 강제한다.

## 6. Soft scoring — 우선 순위를 만드는 방식

**MVP 1차:** 걷기/긴 공강/등교일만 구현해도 된다. JSON weights가 모두 0이면 422 또는 명시적 기본값을 적용하는 정책을 팀과 고정한다. 권장은 **422**(입력 실수 발견 용이).

| 요소 | 데이터 | 0~1 점수 아이디어 |
|---|---|---|
| 주간 도보시간 | `walk_week` | `exp(-walk_week / 30)` |
| 수업 간 빈 시간 | `idle_gap_week` | `exp(-idle_gap_week / 60)` |
| 캠퍼스 등교일 | `campus_days` | `max(0, 1 - (campus_days-1)/4)` |
| 역사적 학점 분포 | grade A/AB rate + sample size | 표본 수를 고려한 smoothing |
| 전공/교양 요건 | `requirement_fit` | 선택한 optional 과목 평균 또는 추가 충족치 |
| 교수 신호 | `instructor_score` | `null`이면 평가 없는 상태로 취급 |

```text
score = 100 * sum(weight_i * normalized_metric_i)
              / sum(active_weight_i)
```

**중요한 공정성:** 특정 요소의 데이터가 **모든 후보에 없으면 해당 요소의 가중치를 전체 비교에서 제외**. 일부 후보에만 없으면 missing을 0으로 주지 말고 중립값(예: 후보군 중앙값)으로 대체 + “정보 부족” 표시. 이렇게 해야 RMP 평점이 없는 교수가 자동 불이익을 받지 않는다.

**성적 분포는 신뢰도 조정:** 극소수 표본에서 A 비율 100%라고 최상위 추천하면 위험하다. 예: `smoothed_rate = (n*observed_rate + 50*0.5)/(n+50)`은 MVP용 예시 규칙이며 검증된 학교 공식 지표는 아니다.

**고정된 과목끼리의 section 비교:** 학위요건/과목별 grade A 비율이 모든 조합에서 똑같다면 그 요인의 가중치를 **제외**하고 수업시간·도보·교수 등 달라지는 요소만으로 점수화한다.

**정렬:** (1) `ready` 우선 (2) 점수 내림차순 (3) 동일 점수면 안정적인 `course_id + bundle_id` 정렬. **한 optional 과목 조합만 Top 5를 독점**하지 않도록 후속 단계에서 diversity 옵션 추가 가능.

## 7. 최적화 알고리즘 의사코드

```python
def generate(req):
    validate_contract_and_invariants(req)
    required = [c for c in req.courses if c.is_required]
    optional = [c for c in req.courses if not c.is_required]

    # Confirmed ineligibility => cannot choose. Unknown => warning later.
    if any(is_definitely_ineligible(c) for c in required):
        return empty_response(reason="required_course_ineligible")

    results = []
    counters = Counter()

    # Option A: all selected courses fixed. Option B: fill remaining credits.
    for course_set in enumerate_course_sets(required, optional, req.constraints):
        for assignment in choose_one_bundle_and_credit_option_per_course(course_set):
            counters["explored"] += 1

            if violates_credit_or_time_constraints(assignment, req.constraints):
                counters["time_or_credit"] += 1
                continue

            feasibility = evaluate_walking_and_eligibility(
                assignment, req.walking_edges, req.constraints
            )
            if feasibility.definitely_impossible:
                counters["unreachable_walk"] += 1
                continue

            metrics = compute_weekly_metrics(assignment, feasibility)
            results.append(build_result(assignment, metrics,
                                        feasibility.review_warnings))

    apply_cohort_consistent_scores(results, req.preferences.weights)
    results.sort(key=lambda r: (
        r.status != "ready", -r.score, stable_bundle_key(r)
    ))
    return response(results=deduplicate(results)[:req.top_k],
                    diagnostics=counters)
```

**성능 관리:**

- 필수 과목의 가능 section 수가 가장 적은 것부터 선택(MRV heuristic).
- 부분 선택만으로 time conflict 발생 시 바로 가지치기.
- 부분 학점이 최대를 넘거나 남은 과목으로 최소 학점을 못 채우면 중단.
- 걷기 불가능한 부분 선택도 가능한 한 즉시 중단.
- 대규모 후보는 optional course shortlist로 제한(예: 관련성 높은 상위 20개)하고 **후보 축소 사실을 진단에 기록**.
- 탐색 cap/timeout이 걸리면 `diagnostics.search_truncated=true`; 계산된 결과를 **전역 최적**이라고 단정하지 않는다.
- 후속 업그레이드: Google OR-Tools CP-SAT. API는 그대로 유지한다.

## 8. 가상 fixture로 강제되는 정답

입력 파일 `DIGREE_fixture_request.json`은 다음 상황을 재현한다.

- 반드시 수강: **COMP SCI 400 (3), MATH 234 (4), STAT 240 (3)** → 총 10학점.
- 수업 시작 ≥ 오전 10:00, 도보 buffer 3분, 걷기만 점수화(`walking=1`).
- CS 400 `A`: 월/수 10:00–10:50 ALPHA; `B`: 월/수 11:00–11:50 GAMMA.
- MATH 234 `A`: 월/수 11:00–11:50 BETA; `B`: 월/수 12:00–12:50 GAMMA.
- STAT 240 `A`: 화/목 10:00–11:15 DELTA.
- ALPHA↔BETA=6분, ALPHA↔GAMMA=18분, BETA↔GAMMA=12분.

| 순위 | 선택 bundle | 주간 수업 간 걷기 | 점수 (걷기만) |
|---|---|---:|---:|
| 1 | `cs400-B + math234-B + stat240-A` | **0분** | **100.00** |
| 2 | `cs400-A + math234-A + stat240-A` | 12분 | 67.03 |
| 3 | `cs400-A + math234-B + stat240-A` | 36분 | 30.12 |

`cs400-B + math234-A`는 월/수 11시에 **시간 충돌**이므로 제외해야 한다. fixture에는 4개 조합 중 1개가 겹친다고 명시된다. 결과의 `selected` 배열에는 각 meeting이 모두 포함되어 UI가 주간 시간표를 바로 렌더링할 수 있어야 한다.

## 9. 네가 구현할 테스트 — 이 기준 미달이면 API 전달 금지

| 테스트 ID | 입력 상황 | 기대 결과 |
|---|---|---|
| T01 | 기준 fixture | 0 → 12 → 36분, bundle/순위 정확히 일치 |
| T02 | 09:00 시작, earliest 10:00 | 제외 |
| T03 | 같은 요일 수업 11:00–11:50 겹침 | 제외 |
| T04 | 10분 gap, 6분 walk, 3분 buffer | **허용** (10≥9) |
| T05 | 10분 gap, 12분 walk, 3분 buffer | **제외** |
| T06 | 서로 다른 요일 동일 시각 | 시간 충돌 아님 |
| T07 | 필수 credits > max credits | `results: []` + 원인 |
| T08 | 필수 credits < min, optional 후보 있음 | 학점 범위 충족하도록 추가 |
| T09 | `ineligible` optional / 완료+비반복 | 자동 추천에서 제외 |
| T10 | 필수 eligibility `unknown` | 결과 `needs_review` 또는 안내 (학교 검증이라고 표시 금지) |
| T11 | walking edge 누락 | 0분 가정 금지, `needs_review` 경고 |
| T12 | empty async meeting | 시간 충돌·도보 계산 제외, credit 합산 |
| T13 | lecture+lab bundle 2개 meeting | bundle 전체 시간 충돌 검사 |
| T14 | 동일 요청 2회 | 순서·점수·ID 재현 가능 |
| T15 | 적합한 시간표 0개 | 200 + 빈 결과 + 진단 |
| T16 | optional grade rating / instructor rating missing | 누락을 점수 0으로 처리하지 않음 |
| T17 | variable credit options | 선택 학점 합이 범위 정확히 일치 |
| T18 | 캡으로 탐색 중단 | `search_truncated=true`와 적절한 주의 문구 |

추가로 Pydantic으로 `start_min < end_min`, `min_credits <= max_credits`, 중복 `course_id` 금지, 음수 weights 금지, 모든 weights가 0인 요청 거부를 검사한다.

## 10. 개발 순서와 풀스택에게 넘길 산출물

### Milestone A — Contract + Basic Engine

- [ ] OpenAPI/Pydantic 스키마 구현(필드명 변경 없음).
- [ ] `/health`, `/v1/schedules/generate` 실행.
- [ ] 필수과목만 있는 fixture 정확한 Top 3 반환.
- [ ] pytest, `README.md`에 로컬 실행 명령 기재.

### Milestone B — Hard Constraints + Diagnostics

- [ ] 시간/요일/중복/credit/도보/eligible 검사 구현.
- [ ] `results=[]`와 `rejected_by_reason` 구현.
- [ ] 미확인 data의 `needs_review` 및 warning 구현.

### Milestone C — Soft Score + Optional Courses

- [ ] 걷기/공강/등교일 가중치.
- [ ] required credits 부족하면 optional course 추천.
- [ ] grade, degree-fit, instructor missing-data-safe scoring.
- [ ] 조합 폭발 pruning, deterministic Top K.

### Milestone D — Integration

- [ ] Dockerfile와 `.env.example`(필요 시) 작성.
- [ ] Full-stack이 제공한 실제 normalized JSON 1건으로 smoke test. 아래 §13 데이터 출처·품질 점검표 통과 여부도 확인.
- [ ] `422`, `results=[]`, `needs_review`, `503` 케이스 공유.
- [ ] **버전 1 계약을 수정하지 않은 채 배포**하고 마지막 데모 fixture 통과.

**풀스택에게 전달해야 할 정확한 것:** Optimizer base URL, 서비스 실행 명령, OpenAPI, 테스트 통과 로그, fixture 기반 curl 명령, 결과가 0개일 때 에러가 아니라 정상 비즈니스 응답이라는 설명.

## 11. AI 코딩 도구에 그대로 붙여넣을 프롬프트

> Implement **only the DIGREE scheduling optimizer** in Python 3.12+ and FastAPI. Read this handoff, `DIGREE_API_CONTRACT_v1.yaml`, `DIGREE_fixture_request.json`, and `DIGREE_fixture_expected_response.json` first. The API must exactly implement `GET /health` and `POST /v1/schedules/generate`. Use Pydantic and a pure, deterministic backtracking + pruning engine. Do not scrape UW–Madison, call Google Maps, read DARS PDF, implement GPA/UI/auth, or store user data. Enforce every documented hard constraint, treat unknown eligibility/travel as review-required instead of inventing values, and calculate normalized weighted scores. First make the provided fixture return exactly the given top three bundles with 0, 12, and 36 weekly walking minutes. Then implement remaining constraint tests, diagnostics, optional-course filling, ranking, and a Dockerfile. Do not change field names, enums, request/response formats, or the contract version without explicit team approval. Output runnable source code, tests, commands, and documented assumptions.

## 12. 협업 규칙과 검증 가능한 범위

- **미팅 1:** API 계약 lock, fixture 예상값 확인, 입력 데이터가 누가 만드는지 확정.
- **미팅 2:** 네 서버에서 curl fixture 통과 → 풀스택의 Generate UI가 즉시 연동.
- **미팅 3:** 실데이터/목업 혼합 요청, empty/warnings, 저장, 배포 리허설.
- **규칙:** `contracts/` 변경은 둘 다 리뷰. AI에게 매번 **동일한 contract 파일**을 제공한다.
- **현실적 범위:** 1차는 고정 과목의 섹션 최적화를 완성한 뒤, 나머지 학점 채우는 과목 추천을 추가한다.
- **비자/졸업요건:** 정확한 적용 규칙과 공개 데이터 접근권은 풀스택/학교 공식 근거를 통해 확인되어야 한다. 엔진은 주어진 계산 규칙만 평가한다.

**최종 성공 기준:** 너의 알고리즘은 사용자 계정도, Next.js 코드도, 학교 API 키도 몰라도 **고정 JSON 입력 → 안정적인 상위 시간표 JSON 출력**을 수행한다. 이 상태라면 팀원이 별도로 만든 앱과 바로 합칠 수 있다.


## 13. 실데이터·외부 API 연동 경계 (추가: 문서 v1.1, **계약 v1.0 유지**)

> **핵심:** 이 절은 옵티마이저가 UW/Madgrades/DARS를 직접 호출하도록 만들라는 뜻이 아니다. **Full-stack/데이터 수집 담당의 입력 정규화·신뢰도 규칙**을 명시하고, 알고리즘 담당이 받을 **입력의 보장 조건**을 확정하기 위한 부록이다. `DIGREE_API_CONTRACT_v1.yaml`과 fixture가 단일 계약 기준이며, **이 절을 근거로 JSON 필드/enum을 임의 추가하지 않는다.**

### 13.1 확인된 출처, 접근 수준, 누가 담당하는가

| 데이터 | 조사된 접근 경로 | 접근·운영 판정 | 옵티마이저에는 무엇을 전달하나 |
|---|---|---|---|
| 실제 과목/분반/수업 시간/개설 좌석 | UW Course Search & Enroll 공개 검색 사이트. 제3자 프로젝트가 `https://public.enroll.wisc.edu/api/search/v1`에서 `POST /`와 `GET /enrollmentPackages/{term}/{subjectCode}/{courseId}`를 사용 | **공개 검색/제3자 작동 사례 확인.** 외부 앱 대량 수집·캐싱·재배포 허용 여부와 API 안정적 지원은 **미확인** | 등록 가능한 `section_bundles`와 `meetings`, `seat_status`, 학점 |
| 과거 성적 분포 | Madgrades `https://api.madgrades.com/` | 공식 API 안내에 **GitHub 로그인 후 API 토큰 발급** 명시 | 표본 수가 포함된 `grade_stats` (선택적) |
| 과거 성적 분포 대안 | MadEnroll `https://madenroll.com/openapi` | **공개 읽기 전용, API key 불필요**. 성적 분포용이며 공식 등록 좌석/학생 기록 API가 아님 | 정규화된 `grade_stats` (선택적) |
| 현재 등록 과목/과거 수강 기록/성적 | 학교 승인형 CAOS 및 학사 시스템 | CAOS는 **authorized recipient systems** 대상. DIGREE의 학생별 self-service 조회 권한은 **미확인/별도 승인 필요** | 원본 기록 전송 금지. Full-stack이 확인한 `already_completed`, `eligibility_status` 등만 |
| 개인별 DARS / 학위요건 | 학생이 직접 다운로드하는 DARS PDF / UW Guide | PDF 가져오기 **가능**. 외부 앱에 공개된 학생별 DARS 자동조회 API/권한은 **미확인** | `requirement_fit` (참고 신호만); 공식 졸업 판정 불가 |
| UW NetID / Canvas 연동 | UW Identity Management 승인, Canvas 승인형 토큰·통합 | **로그인·학적 자동 조회와는 별도 권한**. Canvas 학생 토큰 수동 생성은 제한됨 | **아무 토큰/NetID도 엔진에 전달하지 않음** |

**참고 출처(검토 및 운영 승인 전 확인):**

- UW 공식 공개 검색과 기능: https://registrar.wisc.edu/course-search-enroll/ ; https://kb.wisc.edu/registrar/74443
- UW 공개 검색 API를 사용하는 제3자 소스(공식 지원 계약 아님): https://github.com/WEBGRS/uw-course-lookup/blob/main/scripts/uwapi.py
- Madgrades API: https://api.madgrades.com/
- MadEnroll OpenAPI: https://madenroll.com/openapi
- CAOS 접근 안내: https://kb.wisc.edu/instructional-resources/11753
- DARS 안내: https://registrar.wisc.edu/dars/ ; https://kb.wisc.edu/helpdesk/94069
- 학생 Canvas 토큰 제한: https://kb.wisc.edu/instructional-resources/156712

**주의:** 외부 API의 직접 호출 성공, 응답 스키마, rate limit, 서비스 운영 허가를 **본 문서에서 검증 완료라고 주장하지 않는다.** 실제 요청/응답을 저장해 Full-stack 담당이 확인해야 한다. 학교 사이트에 로그인한 학생의 세션/NetID 비밀번호를 수집하거나 비공식 엔드포인트로 개인 기록을 우회 조회하지 않는다.

### 13.2 정규화 규칙 — 풀스택이 보장해야 하는 입력 조건

1. **Term ID 매핑:** `term: "2027SP"`는 DIGREE 계약용 표시 값이다. UW API가 사용하는 학기 코드(예: `1274`)는 **Full-stack이 조회·검증해 매핑**한다. 코드를 예측하여 하드코딩하거나 다른 학기의 섹션을 섞지 않는다.
2. **코스·분반·번들 구분:** `course_id`는 동일 과목의 cross-list alias를 통합한 **내부 안정 ID**로, `bundle_id`는 그 학기에 선택 가능한 **등록 조합 ID**로 관리한다. 단일 Lecture를 하나의 번들로 취급하면 안 되는 과목이 있다. LEC/DIS/LAB 각 class number 및 관계를 보존하며, **학교의 사전 조합에 없는 경우를 임의 생성하지 않는다.**
3. **분반별 requisites:** 과목 전체 선수요건 외에도 **개별 섹션의 조건**이 있을 수 있다. 확정 불가한 경우 `eligibility_status=unknown`으로 보수적으로 정규화한다. ‘선수과목을 들었다’만으로 자동 `eligible` 판정 금지.
4. **날짜 범위/세션:** 같은 요일·시각이어도 수업 **개설 기간이 겹치지 않을 수 있다**. 반대로 온라인 동기·시험·특별 미팅이 있을 수 있다. **현재 v1 계약에는 meeting별 시작일/종료일을 명시하는 필드가 보장되지 않는다.** 따라서 v1은 검증된 동일 정규 주간 기간의 meeting만 완전 자동 비교한다. 부분학기·불규칙 일정·기간 미확인은 Full-stack이 별도 검토 대상으로 분리하고 **정확한 무충돌 시간표라고 표시하지 않는다**. 정밀한 날짜별 충돌 검사는 계약 v2 제안 사항이다.
5. **시간·시간대:** UW 원본 시간 문자열/UTC 유사 표기를 그대로 분으로 파싱하지 않는다. `America/Chicago` 현지 시간과 실제 학교 화면을 대조해서 `start_min`/`end_min`으로 변환한다. 최소 1개 Fall·Spring 섹션을 각각 샘플 검증해 DST 오류를 잡는다.
6. **좌석 의미:** `availableSeats > 0`만 보고 `seat_status=open`을 결정하지 않는다. 학교 공식 안내에 따르면 **class status가 Open인지, Wait list인지** 등이 실제 등록 가능성에 영향을 준다. reserved seats, section restrictions, waitlist를 별도 확인한다. 정보 불완전/오래됨 → `unknown`; `full`은 현재 신뢰 가능한 상태에서만 정한다. `exclude_full_sections`는 **학교 등록 자격을 보장하는 필터가 아니다.**
7. **좌석 신선도:** Full-stack DB에 원본 출처, `fetched_at`, 마지막 동기화 결과를 기록하되 **v1 최적화 API의 새 필드로 추가하지 않는다.** 최신성을 만족하지 못하면 upstream에서 `seat_status=unknown`으로 전환한다. 캐시 TTL은 호출 제한과 학교 허용 정책이 확인된 뒤 팀이 결정한다.
8. **온라인/미정 수업:** `meetings: []`가 정확히 **비동기(정해진 동기 수업시간 없음)**일 때만 사용한다. `TBA`, 시간 파싱 실패, 정보 누락을 비동기로 둔갑시키면 충돌 탐지 오류가 난다. 미정/TBA는 upstream에서 별도 분류하고 보수적으로 처리한다.
9. **도보 데이터:** 건물명 문자열의 별칭을 통합하고 (`building_id` 기준), 방향성·누락·이동수단을 검증한다. 도보시간 미확인은 0으로 채우지 않는다. Full-stack만 지도/거리 데이터 공급자를 호출한다.
10. **성적 통계 단위:** MadEnroll의 `aPercent`는 **0~100**이며 A **단독** 비율이다. 현재 엔진의 A/AB 비율과 혼동하지 말고 필요한 경우 `aCount + abCount`를 `letterGradeCount` 등 유효 분모로 나누어 **0~1**로 정규화한다. 분모는 고유 학생 수가 아닌 **성적 기록 수**이며, 성적 통계는 난이도나 기대 성적을 보장하지 않는다. `null`, 표본 수, 원천/학기는 함께 관리한다.
11. **수강 이력과 DARS:** `already_completed`가 사용자의 직접 입력·Transcript PDF 파싱·학교 검증 기록 중 어디에서 왔는지 **Full-stack이 출처/확인 상태를 관리**한다. 파일 파싱 결과는 사용자 확인 전 **공식 검증 완료**로 표시하지 않는다. `requirement_fit`은 복수전공·편입 학점·catalog year·DARS 예외를 완벽히 해석한 공식 결과가 아니다.
12. **데이터 수집 장애 격리:** UW/Madgrades/DARS 관련 호출은 **옵티마이저 HTTP 요청 과정에서 호출하지 않는다.** 수집기는 재시도/백오프·부분 실패 기록·캐시 스냅샷을 관리한다. 입력 유효성·기본 필드가 확보된 경우에만 최적화를 실행한다.

### 13.3 배포 전 필수 Integration Tests (Full-stack/Data 팀과 공동 소유)

이 표는 기존 `T01~T18` **엔진 단위 테스트에 추가되는 통합 테스트**다. 엔진의 v1 JSON 계약은 바꾸지 않는다.

| ID | 실제 데이터 검증 | 실패 시 정책 |
|---|---|---|
| I01 | 학기 조회와 `2027SP ↔ UW term code` 매핑 일치, 학기별 데이터 혼합 없음 | 해당 학기 생성 차단 |
| I02 | UW 공식 화면의 수업 3~5개와 분반 묶음(LEC/DIS/LAB)이 일치 | 미검증 bundle 제외; 원본 확인 |
| I03 | 실제 강의의 요일/시간(가을·봄 포함)과 현지 분 변환 일치 | 잘못 정규화된 meetings 격리 |
| I04 | Cross-list(e.g. COMP SCI/ECE 354) 중복 과목과 내부 ID가 하나로 연결 | 중복 후보 제거 및 매핑 수정 |
| I05 | `Open / Wait list / Closed`, reserved seats, 좌석 조회 시각 구별 | 상태 불명 → `unknown` |
| I06 | 부분학기·다른 기간·TBA·비동기 수업 구분 | 정밀 확인 전 `ready` 근거로 쓰지 않음 |
| I07 | MadEnroll `aPercent`(0–100)와 A/AB(0–1) 계산 구분, `null`·표본 수 처리 | 성적 점수 제외/중립 대체 |
| I08 | 수강 이력 PDF 파싱 결과와 사용자가 확인한 과목 코드 일치 | 잘못 인식된 완료 과목 사용 금지 |
| I09 | DARS 미제공·구식 문서·다른 catalog year에 대해 `requirement_fit`이 검증 결과처럼 쓰이지 않음 | 요건 점수 보류/경고 |
| I10 | 데이터 공급자 429/5xx/타임아웃 상황에서 엔진이 외부 호출하지 않고, 손상된 JSON 대신 안전한 오류/스냅샷 정책 사용 | Full-stack이 장애 처리, 옵티마이저 계약 유지 |

### 13.4 미해결 결정사항 (팀이 합의하기 전까지 **API v1 변경 금지**)

- [ ] 학교 공개 검색 경로의 **자동 수집/대량 보관/제3자 배포 허용 조건** 및 rate limit 확인.
- [ ] 학기별 실제 `enrollmentPackages` JSON 샘플을 확보해 번들·좌석·미팅 필드의 정규화 규칙 고정.
- [ ] **정원 상태 갱신 기준**과 stale일 때 `seat_status=unknown`으로 떨어뜨리는 정책 결정.
- [ ] 부정확한 날짜 정보가 포함된 수업을 v1 생성기에서 **제외/검토**하는 사용자 경험 합의.
- [ ] 학생별 Enroll·History·DARS 자동 연동은 공식 접근 승인 전까지 **미지원**으로 표시하고, 수동 과목 선택 또는 사용자가 직접 제공한 PDF를 이용.
- [ ] 날짜 범위, session dates, TBA 상태, 예약/대기열의 상세 모델은 **v2 계약 개정 후보**로 별도 이슈화.

**이 부록이 바꾸지 않는 것:** `GET /health`, `POST /v1/schedules/generate`, Pydantic 타입·enum, `request_id`, JSON fixture, 점수 공식, 기존 `T01~T18` 기대값. 기존 fixture의 0/12/36분 결과는 그대로 유지해야 한다.
