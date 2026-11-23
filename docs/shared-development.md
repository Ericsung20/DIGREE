# 두 명이 함께 DIGREE 실행하기

현재 온라인 `DIGREE` 프로젝트는 두 사람의 공동 개발 DB다. 앱과 알고리즘은 각자 컴퓨터에서 실행하고, 과목·계정·친구·시간표 데이터만 같은 Supabase를 사용한다. 이 구성에는 Docker가 필요 없다. 별도 운영 DB는 정식 서비스 공개 전에 분리한다.

## 친구 컴퓨터에서 처음 한 번

Git, Node.js 24, Python 3.12 이상을 설치한다. 기존 알고리즘 작업 폴더를 덮어쓰지 않도록 새 폴더에 받는다.

```powershell
git clone --branch db_fix https://github.com/Ericsung20/DIGREE.git DIGREE-dev
cd DIGREE-dev/apps/web
npm ci
Copy-Item .env.shared.example .env.local
```

`.env.local`의 `NEXT_PUBLIC_SUPABASE_ANON_KEY`에 같은 DIGREE 프로젝트의 **공개 anon 또는 publishable 키**를 넣는다. URL은 예시에 이미 들어 있다. 키는 Supabase 프로젝트의 Connect/API Keys에서 확인하거나 팀원이 현재 쓰는 공개 클라이언트 항목을 전달받는다. service_role/secret 키나 다른 사용자의 비밀번호는 공유하지 않는다. `.env.local`은 Git에 올라가지 않는다.

Windows에서는 저장소 루트에서 아래 도우미도 사용할 수 있다. 기존 환경 파일이 있으면 보존하며, 의도적으로 바꾸려면 `-ReplaceExisting`을 추가한다.

```powershell
powershell -File scripts/use-shared-env.ps1 -PublicKey "공개_클라이언트_키"
```

## 매번 실행

터미널 A, 저장소 루트에서 Python optimizer를 실행한다. 가상환경 생성과 설치는 처음 또는 의존성 변경 때만 필요하다.

```powershell
cd apps/optimizer
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
$env:DIGREE_DISTINCT_COURSE_SETS='1'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

macOS/Linux에서는 `python3 -m venv .venv`, `.venv/bin/python -m pip install -e .`, `DIGREE_DISTINCT_COURSE_SETS=1 .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`을 사용한다. 이 옵션은 추천마다 다른 과목 구성을 보여준다. 기존 fixture와 정확히 비교하는 smoke test를 할 때는 별도 서버에서 `0`을 사용한다.

터미널 B, 저장소 루트에서 웹을 실행한다.

```powershell
cd apps/web
npm run dev
```

브라우저에서 `http://localhost:3000`을 연다. `localhost`는 각자 자신의 컴퓨터다. 자기 UW 이메일 계정으로 로그인한다. 서로 친구 요청·수락을 하면 같은 DB에 저장된 시간표를 확인할 수 있다. 친구 수락은 시간표 공유를 허용하며 개인 성적·편입 기록·학적 프로필을 공개하지 않는다.

## 알고리즘을 수정할 때

친구는 `apps/optimizer` 코드를 수정하고 optimizer를 재시작한다. 자기 웹 앱에서 DIG를 실행하면 자기 컴퓨터의 알고리즘을 호출한다. `OPTIMIZER_URL`은 서버에서만 사용된다. 알고리즘에 보내는 기존 OpenAPI 요청 형식과 과목 ID는 유지했다.

수정 사항은 각자 기능 브랜치에 커밋하고 리뷰 후 합친다. 아직 커밋하지 않은 작업이 있으면 강제 pull/reset으로 덮어쓰지 않는다. DB 구조 변경은 `supabase/migrations`의 새 파일로 관리하고 먼저 로컬 격리 DB에서 검증한다. `db_fix`의 기존 적용 파일은 다시 수정하지 않는다.

## 편입 학점과 교차개설

- Profile → Transfer credit에서 인정된 UW 과목을 검색해 선택하고 인정 학점만 입력해 저장한다. 학교·학기·메모는 Optional details에 있으며, 학교·학기 선택은 다음 과목 입력에도 유지된다. 학기를 지정하지 않으면 현재 학기로 저장한다. 기존 원래 과목 정보는 편집 시에도 보존된다.
- 대응 과목이 지정되면 선수조건 이수 근거로 사용한다. 최소 성적 조건은 인정 학점만으로 확인할 수 없으므로 검토 대상으로 남는다.
- 일반 인정 학점은 총학점 추정에 포함된다. UW GPA·재학 중 수업·채팅 자격·residency에는 포함되지 않는다.
- `CS 240`, `COMP SCI 240`, `MATH 240`은 기존 별칭 자료에서 같은 ID로 검색된다. 표시는 `CS/MATH 240`이며, 같은 과목을 두 번 저장하거나 학점을 중복 계산하지 않는다.
- 같은 처리는 현재 수집된 공동 개설 과목 791개 전체에 적용된다. 예를 들어 `CS/E C E 252`, `A A E/ENVIR ST 244`도 각 별칭이 하나의 과목 ID로 연결된다.

## 졸업 요건 확인

Profile → Requirements는 선택한 주전공·추가 전공·부전공·certificate의 catalog year에 맞는 공개 요건을 읽는다. 과목뿐 아니라 GPA, residency, 학점 제한, 승인 조건과 각주도 펼쳐서 볼 수 있다. 현재 저장된 UW Guide 원본을 다시 추출해 보완했으며, 대학 웹사이트를 새로 수집한 것은 아니다. 확인된 과목 수는 전체 요건 충족을 의미하지 않으며, 별도 조건이 있으면 펼친 내용에 검토 안내가 나온다.

전공명은 구역마다 한 번 표시하고 각 카드는 마지막 단계의 짧은 제목을 사용한다. 처음에는 모두 접혀 있으며 필요한 조건만 펼쳐 본다. 편입 학점은 UW 과목 ID로 졸업 요건과 선수조건에 연결되며, 최소 성적·residency 등 별도 조건은 자동 충족시키지 않는다.

알려진 과목 요건은 `3 of 5 · 2 now`처럼 이수/필요 수와 현재 이수 중인 수를 표시한다. 추가 조건이 있어도 이 숫자를 숨기지 않는다. 과목 수만으로 판정할 수 없는 일반교육·대학 요건은 조건 수와 원문을 보여준다. `Done`은 앱에서 모든 지원 조건을 확인한 경우에만 표시한다.

## DIG 계획 저장

Save Plan에 성공하면 저장한 학기의 Plans 화면으로 바로 이동한다. 학기를 미래 학기로 바꾸면 Plans가 기본으로 선택되고, 현재·과거 학기는 Enrolled가 기본이다. Plans는 실제 수강 등록과 구분된다. 불러오는 중에는 로딩 상태를 표시하며 조회 실패는 오류로 안내한다. 새로고침해도 같은 학기의 활성 계획을 DB에서 다시 읽는다.

`Programming core`만 보이면 예전 `main` 앱이 실행 중인지 확인한다. `db_fix` 폴더에서 웹을 실행하고 주소와 포트도 확인한다. 요건 로딩 실패는 오류로 안내하며 전체 요건이 없는 것으로 처리하지 않는다.

## 문제가 생겼을 때

| 증상 | 확인할 것 |
|---|---|
| 화면은 보이는데 서로의 데이터가 다름 | `.env.local`의 데이터 소스가 `supabase`인지, URL이 같은 DIGREE 프로젝트인지 |
| 과목 검색이 실패함 | 로그인 상태와 공개 클라이언트 키, 네트워크 연결 |
| 추천만 실패함 | `http://127.0.0.1:8000/health`, optimizer 터미널 오류, `OPTIMIZER_URL` |
| 예시 데이터만 보임 | `DIGREE_MOCK=0`, `NEXT_PUBLIC_DIGREE_DATA=supabase` 확인 후 웹 재시작 |
| 중복 가입 안내 | 기존 계정으로 로그인하거나 비밀번호 재설정 |

## 무료 로컬 회귀 검사

Docker Desktop을 켠 뒤 저장소 루트에서 실행한다.

```powershell
powershell -File scripts/dev-db.ps1 start
powershell -File scripts/dev-db.ps1 test
powershell -File scripts/check-dev.ps1
```

이 DB는 `http://127.0.0.1:55321`, Studio는 `http://127.0.0.1:55323`이다. 클라우드 데이터를 복사하지 않고 합성 seed와 일회용 테스트 계정으로 검사한다. 필요하면 `scripts/use-dev-env.ps1 -ReplaceExisting`으로 로컬 연결로 전환하고, 다시 `use-shared-env.ps1`으로 돌아온다. 기존 환경 파일은 Git 제외 백업 파일로 보존된다.
