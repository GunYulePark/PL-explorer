# 손익 Explorer MVP

품목·브랜드·고객구분·사업장·기간을 선택해 손익을 보는 Supabase 기반 테스트 사이트입니다. Power BI와 Power Apps는 사용하지 않습니다.

## 포함 기능

- 한국어 손익 조회 화면과 CSV 다운로드
- U-BIST형 분석 설계 화면: 항목 팔레트, 행·열 구성, 행/열 교환, 선택 항목 정렬
- 기본 분석 설정 3종과 사용자별 분석 설정 저장
- 로그인 없이 체험 가능한 RAW 업로드와 RLS 기반 관리자 운영 권한
- Supabase Storage의 `raw-data` 버킷에 원본 XLSX/CSV 보관
- GitHub Actions Python 적재기의 RAW 검증, 넓은 형태(wide) RAW를 계정별 long-format으로 정규화
- 매출총이익 및 영업이익 정합성 검증 결과를 `import_batches`에 기록

## 빠른 시작

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Supabase 값을 아직 넣지 않아도 화면 구조는 열리지만, 소스 RAW의 품목·금액·집계값은 브라우저나 GitHub Pages에 포함하지 않습니다. 실제 손익 조회와 RAW 저장은 Supabase를 연결한 후에만 작동합니다.

## Supabase 설정

1. Supabase에서 새 프로젝트를 만들고 `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 입력합니다.
2. SQL Editor에서 `supabase/migrations/0001_pnl_schema.sql`을 실행합니다.
3. SQL Editor에서 `supabase/migrations/0002_analysis_presets.sql`을 실행합니다.
4. SQL Editor에서 `supabase/seed.sql`을 실행합니다.
5. 공개 체험 업로드는 별도 로그인 없이 사용할 수 있습니다. 운영 관리자 권한이 필요할 때만 Auth 사용자를 만든 뒤 SQL Editor에서 아래처럼 지정합니다.

```sql
update public.profiles
set role = 'admin'
where email = 'admin@company.com';
```

브라우저에는 publishable key만 둡니다. `SUPABASE_SECRET_KEY`는 Python 적재를 실행하는 안전한 환경에만 두고, 절대 `NEXT_PUBLIC_` 변수나 클라이언트 코드에 넣지 않습니다.

### 대용량 자동 적재 워커

Edge Function은 큰 XLSX 처리 시 메모리/CPU 한도에 걸릴 수 있으므로, `0005_github_actions_raw_ingest.sql`은 Edge 트리거를 끄고 GitHub Actions의 Python 워커를 사용합니다. 브라우저는 원본 파일을 Storage에 저장하고 배치만 만들며, 원본 다운로드와 `pl_facts` 쓰기는 워커만 수행합니다.

GitHub 저장소 **Settings → Secrets and variables → Actions**에서 아래 두 Repository secret을 추가합니다. 이들은 `ingest-raw.yml` 워크플로에서만 쓰이며 GitHub Pages 빌드에는 전달되지 않습니다.

- `SUPABASE_URL`: `https://zyagwjbntxtihppagtkk.supabase.co`
- `SUPABASE_SECRET_KEY`: 이 적재 전용으로 새로 만든 Supabase `sb_secret_...` 키

`SUPABASE_SECRET_KEY`는 업로드 파일을 읽고 DB에 쓰는 서버 권한이므로 `NEXT_PUBLIC_` 변수, 저장소 파일, 채팅에 넣으면 안 됩니다. 전용 키는 이름을 `pnl-ingest-worker`처럼 구분해 두고, 필요 없어지면 Supabase **Settings → API Keys**에서 폐기/교체합니다.

기존 `PNL_INGEST_WEBHOOK_TOKEN` Vault/Edge Function secret은 이 워커 경로에서는 더 이상 사용하지 않습니다. GitHub 워커가 한 번 정상 완료된 뒤 Vault와 Edge Function Secrets에서 제거해도 됩니다.

## RAW 업로드 및 적재

1. 화면의 **RAW 업로드**에서 XLSX 또는 CSV 원본을 선택합니다. 로그인 없이 체험할 수 있고, 파일명(확장자 제외)이 데이터베이스 이름으로 기록됩니다.
2. 공개 체험 업로드는 `raw-data/raw/public` 경로에 저장되며, 파일당 20MB까지 허용됩니다. 업로드·업로드 응답에만 허용되고 기존 RAW 파일의 목록·다운로드는 공개하지 않습니다.
3. `Ingest uploaded RAW files` GitHub Actions가 5분마다 `uploaded` 배치를 받아 원본을 비공개로 내려받아 검증·적재합니다. 수동 실행도 Actions 탭에서 가능합니다.

로컬에서 수동 처리하려면 아래처럼 실행합니다.

```powershell
python scripts/ingest_raw.py `
  --file "C:\Users\CKD\Downloads\RAWDATA_MOCK_SAMPLE.xlsx" `
  --batch-id "import_batches UUID" `
  --write
```

먼저 실제 적재 없이 검증 결과만 볼 수 있습니다.

```powershell
python scripts/ingest_raw.py `
  --file "C:\Users\CKD\Downloads\RAWDATA_MOCK_SAMPLE.xlsx" `
  --report outputs\raw-validation.json
```

## 데이터 모델 원칙

- `pl_facts`는 `기간 + 조회 차원 + account_code + amount` 형식입니다.
- 합계 계정과 세부 계정을 모두 적재하지만, 기본 손익표는 `sales`, `cogs`, `gross_profit`, `sga`, `rnd`, `operating_profit` 계정만 각각 조회합니다. 상위/하위 계정을 한 SQL 합계에 섞지 않으므로 이중 집계가 나지 않습니다.
- Python 적재기는 세부 비용 열을 자동으로 계정 맵에 추가하며, 원본 열 순서를 고유 키로 사용합니다. 중복된 `내역` 열은 위치에 따라 자재유형명·제품계층명·고객그룹명·사업장명으로 정규화합니다.
- 원본의 첫 번째 열에서 연도를 자동 인식합니다. 분기 값이 없는 원본은 분기 없이 적재하며, 필요한 경우에만 Python 적재기의 선택 옵션 `--year`, `--quarter`로 보완할 수 있습니다.

## 분석 설정

- 기본 설정은 `기본 손익표`, `품목별 분기 손익`, `사업장별 수익성`입니다.
- 화면 좌측 항목을 선택하면 활성화된 행 또는 열에 추가됩니다. `행/열 바꾸기`로 두 축을 즉시 교환할 수 있습니다.
- 우측 패널에서 행·열 항목의 순서를 바꾸거나 삭제할 수 있습니다.
- 행·열 칩을 끌어놓아 같은 축 안에서 순서를 바꾸거나 행과 열 사이를 이동할 수 있습니다.
- 화면은 색상으로 구분한 세 가지 기본 프리셋을 우선 제공하며, 프리셋을 선택한 뒤 필요한 필터·행·열만 조정합니다.

## GitHub Pages 배포

`main` 브랜치에 push하면 GitHub Actions가 정적 사이트를 만들어 GitHub Pages에 배포합니다.

1. GitHub 저장소 **Settings → Pages**에서 Source를 **GitHub Actions**로 선택합니다.
2. 저장소 **Settings → Secrets and variables → Actions**에 아래 Repository secrets 두 개를 추가합니다.
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key (`sb_publishable_...`)
3. Actions의 `Deploy GitHub Pages` 실행이 끝나면 `https://gunyulepark.github.io/PL-explorer/`에서 조회합니다.

두 `NEXT_PUBLIC_` 값은 브라우저 앱에 포함되는 공개 연결 정보입니다. 반대로 `SUPABASE_SECRET_KEY`는 **GitHub Pages 배포 워크플로에는 넣지 않고**, RAW 적재 전용 `Ingest uploaded RAW files` 워크플로의 Repository secret으로만 등록합니다. 기존 `NEXT_PUBLIC_SUPABASE_ANON_KEY`도 배포 호환성을 위해 읽을 수 있지만 새로 만들 필요는 없습니다.

### Supabase에서 추가로 설정할 항목

- SQL Editor에서 위의 `0001_pnl_schema.sql`, `0002_analysis_presets.sql`, `seed.sql`을 순서대로 실행합니다.
- 관리자 운영이 필요한 경우에만 Auth 사용자 생성 뒤 `profiles`에서 해당 이메일의 `role`을 `admin`으로 변경합니다.

## RAW 샘플 검증 기준

- 매출총이익 = 매출액 - 매출원가
- 영업이익 = 매출총이익 - 판매비와관리비 - 연구개발비
- 필수 차원인 제품 또는 사업장 누락 행
- 업로드 배치별 검증 결과 및 처리 행 수

## 다음 확장 권장 사항

- 조회 권한을 사업장/조직 단위까지 제한하는 `profile_scopes` 테이블 추가
- `pl_accounts`의 세부계정 표시 순서와 부모 계정을 재무팀 기준으로 확정
- 워커 전용 Supabase Secret key의 정기 교체
- 대용량 데이터에서는 필터 값용 차원 테이블 또는 materialized view 추가
