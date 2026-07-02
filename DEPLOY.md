# 배포 가이드 — 실제 공개 URL로 보기

REMIX HUB는 **단일 서비스**로 배포됩니다: API 서버가 빌드된 웹 앱을 같은 도메인에서 함께
서빙하므로(컨테이너 1개 = 사이트 전체), 별도 프론트 호스팅이 필요 없습니다.

기본 저장소는 **인메모리(시드 데이터 포함)** 라 추가 인프라 없이 바로 뜹니다. 데이터 영속이
필요하면 Postgres를 붙이고 `DATABASE_URL`만 설정하면 됩니다.

---

## 옵션 A — Render (원클릭, 무료, 추천)

1. <https://render.com> 로그인 → **New → Blueprint**
2. 이 저장소(`jaybe-dino/ipcom`) 선택 → Render가 루트의 `render.yaml`을 읽습니다
3. **Apply** → Docker 이미지 빌드 후 `https://remix-hub-XXXX.onrender.com` 공개 URL 발급
4. 그 URL을 열고 우상단 **데모 로그인**으로 탐색

> 무료 플랜은 미사용 시 슬립 → 첫 접속이 느릴 수 있습니다(수십 초).

## 옵션 B — Docker (아무 서버나)

```bash
docker build -t remix-hub .
docker run -p 8080:8080 -e JWT_SECRET=$(openssl rand -hex 32) remix-hub
# http://<서버IP>:8080
```

## 옵션 C — Fly.io

```bash
fly launch --no-deploy   # 앱 이름/리전 확인 (fly.toml 사용)
fly secrets set JWT_SECRET=$(openssl rand -hex 32)
fly deploy               # https://<app>.fly.dev
```

## 옵션 D — Railway

1. <https://railway.app> → **New Project → Deploy from GitHub repo** → `jaybe-dino/ipcom` 선택
   (브랜치 `claude/service-dev-planning-e8eqsf`)
2. 루트의 `railway.json` + `Dockerfile`을 자동 인식해 빌드합니다
3. **Variables**에 `JWT_SECRET` 추가 (`openssl rand -hex 32` 값). `PORT`는 Railway가 자동 주입
   → 서버가 그대로 사용합니다
4. **Settings → Networking → Generate Domain** → `https://<app>.up.railway.app` 공개 URL
5. (영속화 원하면) Railway에서 **Postgres** 추가 → 제공되는 `DATABASE_URL`을 서비스 변수에 연결

> 어느 호스트든 동일: 이 저장소는 표준 `Dockerfile` 하나로 동작하므로 Render·Railway·Fly·Koyeb·
> Google Cloud Run·자체 서버 등 Docker를 받는 곳이면 모두 같은 방식으로 배포됩니다. 서버는
> `PORT` 환경변수를 따르고 `0.0.0.0`에 바인딩하며 `/health` 헬스체크를 제공합니다.

---

## 데이터 영속화 (실서비스는 필수)

기본은 인메모리(시드 데이터, **재배포·재시작 시 초기화**)라 실제 회원가입/채팅이 사라집니다.
실제 운영하려면 Postgres를 붙이고 `DATABASE_URL`만 설정하면 자동으로 영속 저장소(Drizzle)로
전환됩니다(코드 변경 0).

**Railway 예시**: 프로젝트에서 **New → Database → Add PostgreSQL** → 생성된 Postgres의
`DATABASE_URL`을 웹 서비스 **Variables**에 추가(또는 Reference로 연결) → 재배포. 이후 가입한
계정·채팅·주문·원장이 영구 보존됩니다.

> 코드를 푸시하면 Railway/Render는 연결된 브랜치를 **자동 재배포**합니다(별도 작업 불필요).

## 환경변수 요약

| 변수 | 용도 | 기본값 |
| --- | --- | --- |
| `PORT` | 서버 포트 | 8080(이미지) / 4000(로컬) |
| `JWT_SECRET` | 토큰 서명 키 (운영 필수) | dev 기본값 |
| `DATABASE_URL` | Postgres 연결 시 영속화 | 없음(인메모리) |
| `NVIDIA_API_KEY` | NIM 실제 생성 연동 | 없음(스텁 failover) |
| `WEB_DIST` | 웹 빌드 경로 override | `apps/web/dist` |
| `ASSET_DIR` | 라이선스·에셋 파일 영속 경로(볼륨) | 없음(인메모리) |
| `S3_BUCKET` 외 | 에셋을 S3/R2/MinIO에 저장(CDN 확장) | 없음 → `ASSET_DIR` → 메모리 |
| `STRIPE_SECRET_KEY` | 정산 시 실제 결제 | 없음(mock 자동성공) |

에셋 저장 우선순위: **S3(`S3_BUCKET`+키) → `ASSET_DIR`(볼륨) → 인메모리**. S3 어댑터는
SDK 없이 SigV4 서명만으로 AWS S3·Cloudflare R2·MinIO·GCS 호환 엔드포인트를 지원합니다
(비-AWS는 `S3_ENDPOINT` 지정). 전체 목록은 `.env.example` 참고.

## E2E 스모크

배포 전/후 핵심 여정(로그인 → 커뮤니티 채팅 → AI 생성)을 실제 브라우저로 검증:

```bash
pnpm test:e2e                                   # 앱을 띄워 자체 검증
BASE_URL=https://your-deploy pnpm --filter @remix-hub/e2e smoke   # 배포본 검증
```

Chromium이 없으면 `SKIP`(exit 0)이라 CI를 깨지 않습니다. 자세한 내용은 `e2e/README.md`.
