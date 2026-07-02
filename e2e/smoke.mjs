// REMIX HUB — browser E2E smoke.
//
// Boots the single-service app (API serving the built web) unless BASE_URL is
// given, then drives a real Chromium through the core user journey:
//   1. Auth gate renders
//   2. Demo login (민지) → community shell
//   3. Open 커뮤니티, send a chat message → it appears
//   4. Switch to AI 생성, submit a prompt → creation resolves (spinner → card)
//
// Design goals: honest and CI-tolerant. If Chromium or a build is unavailable
// it prints SKIP and exits 0 (never a false red); a genuine flow failure exits
// 1 with a screenshot. Screenshots for every major state land in ./artifacts.
//
// Env knobs:
//   BASE_URL            target an already-running server (skips auto-boot)
//   PLAYWRIGHT_CHROMIUM path to a chromium binary (else auto-discovered)
//   PORT                port for the auto-booted server (default 4100)
//   HEADFUL=1           run headed (local debugging)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ARTIFACTS = join(HERE, "artifacts");
const API_DIST = join(ROOT, "apps/api/dist/server.js");
const WEB_DIST = join(ROOT, "apps/web/dist");

function skip(msg) {
  console.log(`\n⏭️  E2E SKIP: ${msg}\n`);
  process.exit(0);
}
function fail(msg) {
  console.error(`\n❌ E2E FAIL: ${msg}\n`);
  process.exitCode = 1;
}

/** Locate a Chromium executable: explicit env → known browser dirs → null. */
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) {
    return process.env.PLAYWRIGHT_CHROMIUM;
  }
  const home = process.env.HOME || "";
  const bases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    "/opt/pw-browsers",
    home && join(home, ".cache/ms-playwright"), // default Playwright install dir
  ].filter(Boolean);
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base)) {
      if (!dir.startsWith("chromium-")) continue;
      const bin = join(base, dir, "chrome-linux", "chrome");
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

async function freePort(preferred) {
  return await new Promise((res) => {
    const srv = createServer();
    srv.listen(preferred, () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
    srv.on("error", () => res(preferred)); // fall back; server will surface a real error
  });
}

async function waitForHealth(base, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });

  // 1) Resolve the browser. No browser → skip (e.g. CI without Playwright cache).
  const executablePath = findChromium();
  if (!executablePath) skip("no Chromium found (set PLAYWRIGHT_CHROMIUM or install Playwright browsers)");
  console.log(`🧭 Chromium: ${executablePath}`);

  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    skip("playwright-core not installed (run pnpm install)");
  }

  // 2) Resolve the target. Either an external BASE_URL or a server we boot.
  let base = process.env.BASE_URL;
  let child = null;
  if (!base) {
    if (!existsSync(API_DIST)) skip(`API not built (${API_DIST} missing) — run pnpm --filter @remix-hub/api build`);
    if (!existsSync(join(WEB_DIST, "index.html"))) {
      skip(`web not built (${WEB_DIST}/index.html missing) — run VITE_API_BASE="" pnpm --filter @remix-hub/web build`);
    }
    const port = await freePort(Number(process.env.PORT) || 4100);
    base = `http://127.0.0.1:${port}`;
    console.log(`🚀 booting single-service API on ${base}`);
    child = spawn(process.execPath, [API_DIST], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), USE_PGLITE: "1", RUN_SERVER: "1", WEB_DIST },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", (code) => {
      if (code && code !== 0 && process.exitCode == null) fail(`server exited early (code ${code})`);
    });
  } else {
    console.log(`🔗 using external BASE_URL: ${base}`);
  }

  const stop = () => {
    if (child && !child.killed) child.kill("SIGTERM");
  };

  try {
    if (!(await waitForHealth(base))) skip(`server not reachable at ${base}`);
    console.log("💚 server healthy");

    const browser = await chromium.launch({ executablePath, headless: !process.env.HEADFUL });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const shot = (name) => page.screenshot({ path: join(ARTIFACTS, `${name}.png`), fullPage: false });

    try {
      // Step 1 — auth gate renders.
      await page.goto(base, { waitUntil: "networkidle" });
      await page.getByText("REMIX HUB", { exact: false }).first().waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "민지" }).waitFor({ timeout: 10000 });
      await shot("01-auth");
      console.log("✓ auth gate rendered");

      // Step 2 — demo login → community shell (topnav appears).
      await page.getByRole("button", { name: "민지" }).click();
      await page.getByRole("button", { name: /커뮤니티/ }).waitFor({ timeout: 10000 });
      await shot("02-home");
      console.log("✓ logged in (community shell)");

      // Step 3 — open community, send a chat message, see it echoed.
      await page.getByRole("button", { name: /커뮤니티/ }).click();
      const composer = page.locator(".composer");
      await composer.waitFor({ timeout: 10000 });
      // Ensure the 채팅 tab is active, then type into its input.
      await composer.getByRole("button", { name: /채팅/ }).click();
      const marker = `e2e smoke ${Date.now().toString(36)}`;
      const chatInput = composer.locator(".chatinput input");
      await chatInput.fill(marker);
      await composer.getByRole("button", { name: "보내기" }).click();
      await page.getByText(marker, { exact: false }).waitFor({ timeout: 10000 });
      await shot("03-chat");
      console.log(`✓ chat message delivered ("${marker}")`);

      // Step 4 — AI generation: submit a prompt, watch it resolve.
      await composer.getByRole("button", { name: /AI 생성/ }).click();
      const promptInput = composer.locator(".inputrow input");
      await promptInput.waitFor({ timeout: 10000 });
      await promptInput.fill("아티스트 G, neon skyline, cinematic — e2e smoke");
      await composer.locator(".inputrow button.gen").click();
      // The submit ack ("생성 완료" banner) fires immediately; the creation card
      // starts in a "생성 중…" (.gen-spin) state and resolves asynchronously via
      // the gateway → WS creation.updated round-trip. Prove the FULL round-trip:
      // a spinner appears, then a resolved card (.wm AI label or .msg-img) shows.
      await page.locator(".gen-spin").first().waitFor({ timeout: 10000 }).catch(() => null);
      await page.screenshot({ path: join(ARTIFACTS, "04-generating.png") });
      await page.locator(".wm, .msg-img").first().waitFor({ timeout: 20000 });
      await shot("05-generation-done");
      console.log("✓ AI generation resolved (submit → gateway → WS update)");

      console.log("\n✅ E2E PASS — auth → community chat → AI generation\n");
    } catch (e) {
      await shot("99-failure").catch(() => {});
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      await browser.close();
    }
  } finally {
    stop();
  }
}

main().catch((e) => {
  fail(e instanceof Error ? e.stack || e.message : String(e));
});
