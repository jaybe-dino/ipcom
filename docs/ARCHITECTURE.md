# REMIX HUB — 아키텍처

PRD(첨부 상세 기획안)를 코드로 옮긴 현재 구현 상태와, 앱/웹/데스크탑 확장 경로를 정리합니다.

## 1. 레이어 & 코드 재사용 전략

```
            ┌─────────────────────────────────────────────┐
            │   @remix-hub/core  (플랫폼 비종속 도메인)        │
            │   types · consent · moderation · rights · ledger │
            └───────────────┬───────────────┬──────────────┘
                            │               │
              ┌─────────────┘               └──────────────┐
              ▼                                             ▼
   apps/api (Fastify, 서버)                    apps/web (React, 웹)
   - Store(in-memory) → DB                     - api.ts (REST 클라이언트)
   - RemixService (G1~G3 오케스트레이션)         - 5개 화면(목업 → 실서비스)
   - PluginGateway (NIM/스텁)                   - 게이트 fee 프리뷰는 core 재사용
              │
              ▼ (향후)
   apps/mobile (React Native)   apps/desktop (Tauri/Electron)
   → core + api.ts 재사용, UI 셸만 플랫폼별 구현
```

핵심: **모든 권리·정산 로직은 `@remix-hub/core`에 있고 서버·클라이언트가 공유**합니다. 예를 들어
웹 게이트 화면의 분배 미리보기는 서버와 동일한 `exportDecision()`/`distribute()`를 호출합니다 →
클라이언트가 늘어나도 규칙이 한 곳에 유지됩니다.

## 2. 서비스 단위(PRD §2.1) → 현재 매핑

| PRD 서비스 | 현재 구현 | 비고 |
| --- | --- | --- |
| Community Service | 스페이스/채널 생성·가입/탈퇴·멤버십 + 실시간 채팅(WebSocket) | ✅ 사용자 생성 멀티 커뮤니티 |
| Identity & Access | JWT + scrypt + RBAC (`src/auth`) | ✅ register/login, 역할 기반 권한 |
| Plugin Gateway | `apps/api/src/plugins/*` | NIM 어댑터 + 스텁 failover |
| Rights Engine | `@remix-hub/core/rights` (G1/G2/G3) | 완료 (단위 테스트) |
| Moderation | `@remix-hub/core/moderation` | 키워드 스텁 → 실모델 드롭인 |
| License Ledger | `@remix-hub/core/ledger` | append-only 해시 체인 + 무결성 검증 |
| Settlement & Billing | `RemixService.payAndSettle` + `distribute()` | PG 연동은 후속 |
| Marketplace | `MarketService` + 라우트 + 웹 화면 | ✅ 리스팅·템플릿·주문·라이선스·take rate |
| Watermark/Provenance | 라이선스 매니페스트(가시 AI 표시 + 출처 + 해시 봉인) | ✅ 반출 시 발급/검증, 픽셀 워터마크는 후속 |
| Asset Storage/CDN | `AssetStore`(메모리) + 내부/반출 스코프 분리 | ✅ 추상화 완료, S3/CDN 연동은 후속 |

## 3. 데이터 모델 & 저장소

`@remix-hub/core/types`에 PRD §3 엔티티를 1:1로 정의했습니다: `User/Role`, `IP/ConsentPolicy`,
`Space/Channel/Post`, `Creation`, `ExportRequest/License`, `LedgerEntry`.

영속화는 `Repo` 인터페이스(`apps/api/src/repo/types.ts`)로 추상화되어 있고 두 구현이 있습니다:

- **MemoryRepo** — 인메모리(개발·테스트 기본)
- **DrizzleRepo** — Drizzle ORM 기반 PostgreSQL. `DATABASE_URL`이면 node-postgres,
  `USE_PGLITE=1`이면 임베디드 Postgres(PGlite, 서버 불필요)로 동작. 런타임 `migrate()`가
  테이블을 멱등 생성하고 `seedIfEmpty()`가 데모 데이터를 시드.

원장 무결성: `LedgerEntry.timestamp`는 해시 입력의 일부라 DB에 텍스트로 원형 저장(타임존 타입의
포맷 변형으로 체인이 깨지는 것을 방지). PGlite 통합 테스트가 전체 파이프라인 후 체인 검증을 보장.

## 4. API 엔드포인트(PRD §6)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/spaces/:id/generations` | 생성 잡 제출 (G1 평가 + Plugin Gateway) |
| GET | `/generations/:id` | 생성 상태·결과 |
| POST | `/generations/:id/share` | 내부 공유 (G2) |
| POST | `/generations/:id/export` | 외부 반출 요청 (G3) |
| POST | `/exports/:id/approve` | IP 소유자 승인/반려 |
| POST | `/exports/:id/pay` | 결제·정산 트리거 + 라이선스 발급 |
| GET | `/ip/:id/consent` · PUT | Consent Matrix 조회/수정(버전 증가) |
| GET | `/ledger` | 원장 조회 + 무결성 상태 |

## 5. 플러그인 SDK & NVIDIA NIM

`RemixPlugin` 인터페이스: `submit() → poll() → provenance()`. `PluginGateway`가 capability별로
어댑터를 라우팅하고, 비동기 잡은 완료까지 폴링하며, 실패 시 스텁으로 failover합니다.

`NimPlugin`(build.nvidia.com)은 멀티 capability(image/video/music/voice/3d) 레퍼런스 구현으로,
capability별 모델을 환경변수로 지정해 활성화합니다. 동기(artifact/URL) 및 비동기(request id +
상태 폴링) 응답을 모두 표준 SDK 계약으로 정규화합니다. `fetch`는 주입 가능해 단위 테스트가
실제 NVIDIA 키 없이 요청 구성·응답 파싱·failover를 검증합니다. `GET /plugins`로 인벤토리 노출.

## 6. 개발 단계(PRD §9) 대비 현재 위치

- **P0 검증** — 데이터 모델 확정, 인터랙티브 프로토타입(목업 → 웹) ✅ (이번 단계)
- **P1 MVP** — 단일 IP 스페이스 + 이미지/영상 플러그인 + Consent Matrix + 기본 반출/정산
  - 도메인·게이트·원장·기본 반출/정산 ✅ / 실시간·인증·DB·실모더레이션 🚧
- **P2 마켓 / P3 확장** — 마켓플레이스, 다플러그인, 다IP, B2B, 블록체인 원장 (예정)

## 7. 다음 작업(우선순위)

1. 인증/권한(OAuth2 + JWT + RBAC)으로 `x-user-id` 스텁 대체
2. `Store` → 영속 DB(PostgreSQL) + 마이그레이션
3. 실시간 채널(WebSocket) — Community Service
4. NIM 어댑터 실연동 검증 + 음악/보이스/3D 어댑터 추가
5. 실제 워터마크 삽입 + 에셋 스토리지/CDN
6. `packages/ui` 추출 → 앱/데스크탑 클라이언트 셸 추가
