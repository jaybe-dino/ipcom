# REMIX HUB

**IP × AI 2차창작 커뮤니티 플랫폼** — _"안에서는 마음껏, 밖으로는 허락받고"_

IP 소유자가 허용한 "놀이터" 안에서 팬·크리에이터가 AI 플러그인으로 자유롭게 2차창작을 하고,
그 결과물이 **외부로 나갈 때만** 권리·정산이 작동하는 양면 마켓플레이스형 창작 커뮤니티.

이 저장소는 기획서·PRD(첨부 문서)를 바탕으로 한 **서비스 개발 모노레포**입니다. 웹을 먼저
구현하되, 도메인 로직을 `@remix-hub/core`로 분리해 **앱(React Native) · 데스크탑(Tauri/Electron)**
으로 코드 재사용을 극대화하도록 설계했습니다.

---

## 모노레포 구조

```
remix-hub/
├── packages/
│   ├── core/          @remix-hub/core — 플랫폼 비종속 도메인 (모든 클라이언트·서버 공용)
│   │   ├── types/       User, IP/ConsentPolicy, Space/Channel/Post, Creation, Export/License, Ledger
│   │   ├── consent/     Consent Matrix (허용 행위·금지선·반출 정책·분배율)
│   │   ├── moderation/  Hard Limit 사전 검사
│   │   ├── rights/      Rights Engine — G1/G2/G3 게이트 + 가격·분배 계산
│   │   └── ledger/      License Ledger (append-only 해시 체인, 의존성 0)
│   └── client-core/   @remix-hub/client-core — 헤드리스 클라이언트 (web·desktop·mobile 공용)
│       ├── api          REST 클라이언트 (fetch 주입 가능)
│       ├── session      JWT 세션 + 교체 가능한 저장소(localStorage/AsyncStorage/메모리)
│       └── realtime     채널 WebSocket 구독
├── apps/
│   ├── api/           @remix-hub/api — Fastify 백엔드 (서비스 + Plugin Gateway + 실시간)
│   │   └── plugins/     REMIX Plugin SDK + NVIDIA NIM 어댑터 + 스텁(failover)
│   ├── web/           @remix-hub/web — React + Vite 웹 (client-core 소비)
│   ├── desktop/       @remix-hub/desktop — Tauri 셸 (웹 앱 재사용) *기본 설치 제외
│   └── mobile/        @remix-hub/mobile — Expo/React Native (client-core 소비) *기본 설치 제외
└── docs/ARCHITECTURE.md
```

**멀티플랫폼 코드 재사용**: 도메인 규칙은 `@remix-hub/core`, 클라이언트 로직(API·세션·실시간)은
`@remix-hub/client-core`에 모여 있습니다. 웹은 두 패키지를 직접 소비하고, **데스크탑(Tauri)** 은
웹 앱을 그대로 웹뷰로 감싸며, **모바일(Expo/RN)** 은 동일한 `client-core`에 네이티브 화면만 붙입니다.
desktop/mobile은 네이티브 툴체인이 무거워 기본 설치 그래프에서 제외 — 각 앱 README로 부트스트랩.

핵심 설계 원칙(PRD §1.2)을 코드 구조에 그대로 반영했습니다.

- **Compliance by Design** — 권리·금지선·AI 표시를 생성 파이프라인에 내장 (사후 검열 X)
- **Trigger on Distribution** — 과금·승인은 생성이 아니라 **외부 반출(G3)** 시점에만 발동
- **Plugin-agnostic** — 생성 엔진은 교체 가능한 어댑터(REMIX Plugin SDK)로 추상화
- **Immutable Provenance** — 모든 생성·반출은 해시 체인 원장에 기록
- **Owner-controlled** — IP 소유자가 허용 범위·정책·분배율의 단일 진실 공급원(SoT)

---

## 빠른 시작

```bash
pnpm install

# 1) 코어 빌드 (다른 패키지가 의존)
pnpm --filter @remix-hub/core build

# 2) 백엔드 API 실행 (http://localhost:4000)
pnpm --filter @remix-hub/api dev

# 3) 웹 클라이언트 실행 (http://localhost:5173, /api → :4000 프록시)
pnpm --filter @remix-hub/web dev
```

전체 검증:

```bash
pnpm test        # 코어 + API 단위/통합 테스트
pnpm typecheck   # 전체 타입 검사
pnpm build       # 전체 빌드
```

### 인증 (JWT + RBAC)

- `POST /auth/register`, `POST /auth/login` → `{ token, user }` (JWT, 12h)
- 보호된 변경 라우트는 `Authorization: Bearer <token>` 필요, 소유자 전용 작업은 `OWNER` 역할 RBAC
- 비밀번호는 scrypt 해시(Node 내장, 외부 의존성 0), 시크릿은 `JWT_SECRET` 환경변수
- **데모 계정** (개발 시드): `minji@remixhub.dev`(크리에이터) / `owner@remixhub.dev`(IP 소유자), 둘 다 비밀번호 `password`. 웹 상단 바에서 원클릭 로그인.

### 저장소 엔진 (Repo)

비즈니스 로직은 `Repo` 인터페이스에만 의존하며, 환경변수로 엔진을 교체합니다(코드 변경 0):

| 우선순위 | 조건 | 엔진 |
| --- | --- | --- |
| 1 | `DATABASE_URL` 설정 | PostgreSQL (node-postgres + Drizzle, 운영) |
| 2 | `USE_PGLITE=1` | PGlite 임베디드 Postgres (실제 SQL, 서버 불필요) |
| 3 | (기본) | 인메모리 (개발·테스트) |

- 스키마는 Drizzle ORM(`src/repo/drizzle/schema.ts`), 런타임 `migrate()`가 테이블을 멱등 생성하고 데모 데이터를 시드합니다.
- 라이선스 원장은 해시 무결성을 위해 timestamp를 텍스트로 원형 저장 → DB를 거쳐도 체인 검증 통과(PGlite 통합 테스트로 보장).
- 마이그레이션 파일 생성: `pnpm --filter @remix-hub/api db:generate` (drizzle-kit).

### 실시간 채널 (WebSocket)

- `GET /ws/channels/:id?token=<jwt>` — 채널 단위 실시간 구독(브라우저 WS 제약상 토큰은 쿼리 파라미터)
- 채널에서 생성(`channel_id` 포함)하면 서버가 Post를 만들고 구독자에게 `post.created` 이벤트를 브로드캐스트
- 인메모리 EventBus(단일 노드). 다중 노드 확장 시 동일 인터페이스로 Redis pub/sub 교체
- 웹: 활성 채널에 자동 구독 → 다른 사용자의 생성물이 피드에 실시간 등장(생성물 ID로 중복 제거)

---

## 3단계 권리 게이트 (Rights Engine)

| 게이트 | 위치 | 규칙 | 수수료 | 코드 |
| --- | --- | --- | --- | --- |
| **G1 생성** | 스페이스 내부 | Consent 허용 + 모더레이션 통과 | 없음 | `canGenerate()` |
| **G2 내부공유** | 스페이스 내부 | 멤버 간 공유·리믹스 자유 | 없음 | `canShareInternally()` |
| **G3 외부반출** | 커뮤니티 경계 | 용도별 auto/review/deny + fee | 용도별 | `exportDecision()` |

데이터 흐름(PRD §2.2):

```
프롬프트/소스 → [Plugin Gateway] → [Moderation 사전검사] → [G1 권리평가]
   → [생성 엔진(NIM/스텁)] → [Watermark + Ledger(create)]
   → [G2 내부공유 무료]
   → [G3 외부반출 요청 → 정책평가 + fee 산정]
   → [승인 → 라이선스 발급 + 가시적 AI 표시 → Ledger(settle) → 분배·정산]
```

---

## AI 연동 — NVIDIA NIM (build.nvidia.com)

생성 엔진은 **REMIX Plugin SDK**(`apps/api/src/plugins/types.ts`)로 추상화되어 있고, 첫 레퍼런스
어댑터로 **NVIDIA NIM**(<https://build.nvidia.com/>)을 연동했습니다.

- **멀티 capability**: image / video / music / voice / 3d. capability별 모델을 환경변수로 지정하면
  활성화됩니다(`NIM_IMAGE_MODEL`은 SDXL 기본값, 나머지는 opt-in).
- **동기 + 비동기** 모두 지원: 모델이 artifact/URL을 즉시 주면 완료, request id + 상태를 주면
  게이트웨이가 `NIM_STATUS_PATH`로 폴링해 완료까지 추적.
- `NVIDIA_API_KEY`가 없거나 호출이 실패하면 로컬 **스텁 어댑터로 failover**(PRD §5.2 멀티 벤더).
- 설정은 모두 환경변수로 분리 (`.env.example`) — 코드에 시크릿 없음. `GET /plugins`로 현재
  어댑터·capability 인벤토리 확인.
- 어떤 어댑터로 만들었든 동일한 모더레이션·워터마크·원장 파이프라인을 통과합니다(plugin-agnostic).

> ⚠️ 본 저장소의 수치·정책·법적 정리는 기획 단계 예시이며, 사업화 전 IP·엔터·AI 전문 변호사 검토가
> 필요합니다(PRD §7).
