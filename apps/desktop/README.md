# REMIX HUB — Desktop (Tauri)

데스크탑 앱은 **웹 클라이언트(`apps/web`)를 그대로 재사용**합니다. Tauri의 시스템 웹뷰가
React 앱을 렌더링하므로 플랫폼 전용 UI 코드가 없습니다 — 동일한 화면·로직·`@remix-hub/client-core`를
공유합니다.

## 사전 요구사항

- Rust 툴체인 (https://rustup.rs)
- 플랫폼 의존성 (https://tauri.app/start/prerequisites/)
- Node 20+, pnpm

> 이 앱은 모노레포 기본 설치 그래프에서 제외되어 있습니다(네이티브 툴체인이 무겁기 때문).
> 사용할 때만 아래처럼 부트스트랩하세요.

## 실행

```bash
# 1) 워크스페이스에 desktop을 포함 (한 번만)
#    pnpm-workspace.yaml의 packages에 "apps/desktop" 추가

# 2) 의존성 설치
pnpm install

# 3) API 서버 실행 (별도 터미널)
pnpm --filter @remix-hub/api dev

# 4) 데스크탑 개발 모드 (Vite dev 서버 자동 기동 + 웹뷰)
pnpm --filter @remix-hub/desktop dev

# 5) 배포 번들 빌드
pnpm --filter @remix-hub/desktop build
```

## 구성

- `src-tauri/tauri.conf.json` — 개발 시 `http://localhost:5173`(Vite), 배포 시 `apps/web/dist`를 로드
- `src-tauri/src/main.rs` — 최소 진입점(웹뷰만 띄움)
- 프로덕션 API 주소는 웹 빌드의 `VITE_API_BASE`로 절대 URL을 지정하세요
  (예: `VITE_API_BASE=https://api.remixhub.example`).

## 아이콘

`src-tauri/icons/icon.png`(및 플랫폼별 아이콘)를 추가하세요. `pnpm tauri icon <path>`로 생성할 수 있습니다.
