# @remix-hub/e2e — browser smoke

A single, honest end-to-end check that drives the **real** app in a **real**
Chromium: it boots the single-service server (API serving the built web) and
walks the core journey a user actually takes.

## What it proves

1. **Auth gate** renders on a cold load.
2. **Login** (demo user 민지) lands you in the community shell.
3. **Community chat** — a typed message round-trips and appears in the channel.
4. **AI generation** — a prompt submits, shows the `생성 중…` spinner, then
   resolves to a `generated` card with the AI-provenance watermark. This
   exercises the full async path: `submit → Plugin Gateway → WS creation.updated`.

Screenshots for every step land in `e2e/artifacts/` (git-ignored).

## Run it

From the repo root (builds everything same-origin, boots the server, runs):

```bash
pnpm test:e2e
```

Or against an already-running server:

```bash
BASE_URL=https://your-deploy.example pnpm --filter @remix-hub/e2e smoke
```

## Design notes

- **CI-tolerant.** If Chromium or a production build is missing, the runner
  prints `SKIP` and exits `0` — it never turns CI red for an environment gap.
  A genuine flow failure exits `1` and writes `99-failure.png`.
- **No browser download.** Uses `playwright-core` + a Chromium discovered from
  `PLAYWRIGHT_BROWSERS_PATH` (or `PLAYWRIGHT_CHROMIUM`). Set
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` during install.
- **Self-booting.** Without `BASE_URL`, it starts `apps/api/dist/server.js` with
  `USE_PGLITE=1` on a free port and serves `apps/web/dist` (built with
  `VITE_API_BASE=""` for same-origin).

## Env knobs

| Var                   | Default              | Purpose                              |
| --------------------- | -------------------- | ------------------------------------ |
| `BASE_URL`            | *(auto-boot)*        | Target an external running server.   |
| `PLAYWRIGHT_CHROMIUM` | auto-discover        | Explicit Chromium binary path.       |
| `PORT`                | `4100`               | Port for the auto-booted server.     |
| `HEADFUL=1`           | headless             | Run headed for local debugging.      |
