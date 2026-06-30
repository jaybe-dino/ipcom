# REMIX HUB — Mobile (Expo / React Native)

모바일 앱은 웹/데스크탑과 **동일한 도메인·클라이언트 로직**(`@remix-hub/core`, `@remix-hub/client-core`)을
재사용합니다. 화면(View/Text 등 네이티브 컴포넌트)만 플랫폼 전용이고, API 호출·세션·실시간 구독은
공유 패키지 그대로입니다.

> 이 앱은 모노레포 기본 설치 그래프에서 제외되어 있습니다(React Native 의존성이 무겁기 때문).
> 사용할 때만 아래처럼 부트스트랩하세요.

## 실행

```bash
# 1) 워크스페이스에 mobile 포함 (한 번만)
#    pnpm-workspace.yaml의 packages에 "apps/mobile" 추가 후
pnpm install

# 2) API 서버 실행 (별도 터미널)
pnpm --filter @remix-hub/api dev

# 3) API 주소 지정 후 Expo 실행
#    - Android 에뮬레이터: http://10.0.2.2:4000 (기본값)
#    - iOS 시뮬레이터:     http://localhost:4000
#    - 실기기:             http://<PC의 LAN IP>:4000
EXPO_PUBLIC_API_BASE=http://10.0.2.2:4000 pnpm --filter @remix-hub/mobile start
```

그다음 Expo Go 앱(또는 시뮬레이터)에서 QR을 스캔하면 됩니다.

## 구성

- `src/client.ts` — AsyncStorage 기반 Session + `createApi`(절대 baseUrl). 공유 패키지를 그대로 사용
- `App.tsx` — 데모 로그인 + 스페이스 목록(웹과 같은 `api.listSpaces()`/`Session`)
- 화면을 추가할 때도 데이터·권리·정산 로직은 `@remix-hub/client-core`/`@remix-hub/core`에서 가져옵니다
