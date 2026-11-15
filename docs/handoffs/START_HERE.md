# DIGREE — Team Development Handoff (v1.0)

두 사람이 서로 다른 AI 코딩 도구를 사용하더라도 나중에 API로 연결할 수 있도록 만든 공유 패키지입니다.

## 누가 무엇을 읽을까?

| 담당 | 먼저 읽을 파일 | 추가로 AI에 제공할 파일 |
|---|---|---|
| 풀스택 | `DIGREE_Fullstack_Handoff.md` / `.pdf` | API YAML + request/expected JSON |
| 알고리즘 | `DIGREE_Algorithm_Handoff.md` / `.pdf` | API YAML + request/expected JSON |

## 반드시 같이 사용하는 파일

- `DIGREE_API_CONTRACT_v1.yaml`: OpenAPI 3.0.3. **두 담당자의 단일 API 원본 규격.**
- `DIGREE_fixture_request.json`: 가상의 course/section/constraints를 포함하는 **완전하고 유효한** HTTP 요청.
- `DIGREE_fixture_expected_response.json`: 위 fixture의 기대 결과. **주간 도보 0분, 12분, 36분** 순서의 3개 시간표.

## 처음부터 협업하는 순서

1. 같이 API 계약을 읽고 **필드명과 의미를 고정**한다.
2. **풀스택:** fixture response로 UI, 프로필, 수강 이력, Save 흐름을 만든다.
3. **알고리즘:** fixture request를 입력받는 `POST /v1/schedules/generate`를 구현해 동일한 결과가 나오게 한다.
4. 통합: UI의 mock을 **실제 HTTP API 응답**으로 교체한다.
5. 이후 공개 과목 데이터, 실제 section, Madgrades, 도보 매트릭스를 **풀스택의 adapter**로 연결한다.

**API 계약 변경은 두 사람 합의 전에는 금지.** AI 코딩 도구가 임의로 JSON 스키마를 바꾸면 다시 맞춰야 하므로 변경은 `v1.1` 등으로 버전 관리한다.

## 폴더 제안

```text
digree/
  apps/web/              # 풀스택 담당
  apps/optimizer/        # 알고리즘 담당
  contracts/openapi.yaml # 이 패키지의 YAML을 복사
  fixtures/request.json  # 이 패키지의 request JSON을 복사
  fixtures/expected.json # 이 패키지의 expected JSON을 복사
```

**주의:** 이 패키지는 개발 계획서와 **테스트 규격**이며, 완성된 앱이나 실제 최적화 코드 자체는 포함하지 않습니다. UW–Madison 개인 학적/수강등록의 자동 연동을 전제하지 않습니다. MVP는 학생이 직접 수강 이력을 입력하고, 공식 등록 여부는 미검증으로 표시합니다.
