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

New Project → Deploy from Repo → Railway가 Dockerfile 자동 감지 → 변수 `JWT_SECRET` 추가 →
생성된 도메인으로 접속.

---

## 데이터 영속화 (선택)

위 어느 옵션이든 Postgres를 만들고 환경변수 `DATABASE_URL`을 설정하면 자동으로 영속
저장소(Drizzle)로 전환됩니다. 미설정 시 인메모리(시드 데이터, 재시작 시 초기화).

## 환경변수 요약

| 변수 | 용도 | 기본값 |
| --- | --- | --- |
| `PORT` | 서버 포트 | 8080(이미지) / 4000(로컬) |
| `JWT_SECRET` | 토큰 서명 키 (운영 필수) | dev 기본값 |
| `DATABASE_URL` | Postgres 연결 시 영속화 | 없음(인메모리) |
| `NVIDIA_API_KEY` | NIM 실제 생성 연동 | 없음(스텁 failover) |
| `WEB_DIST` | 웹 빌드 경로 override | `apps/web/dist` |
