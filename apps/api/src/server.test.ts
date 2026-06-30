import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("REMIX HUB API — auth + generation → export → settle pipeline", () => {
  let app: ReturnType<typeof buildServer>;
  let creatorToken: string;
  let ownerToken: string;

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    const login = async (email: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: "password" },
      });
      expect(res.statusCode).toBe(200);
      return res.json().token as string;
    };
    creatorToken = await login("minji@remixhub.dev");
    ownerToken = await login("owner@remixhub.dev");
  });
  afterAll(async () => {
    await app.close();
  });

  it("rejects login with a bad password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "minji@remixhub.dev", password: "nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("requires a token to generate (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      payload: { action: "image", prompt: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a creator from approving an export (RBAC 403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/exports/whatever/approve",
      headers: bearer(creatorToken),
      payload: { approve: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lists the seeded space (public)", async () => {
    const res = await app.inject({ method: "GET", url: "/spaces" });
    expect(res.statusCode).toBe(200);
    expect(res.json().spaces).toHaveLength(1);
  });

  it("blocks a hard-limit generation at G1", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      headers: bearer(creatorToken),
      payload: { action: "image", prompt: "성적 nsfw deepfake" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("hard_limit");
  });

  it("blocks a disabled action (voice OFF) at G1", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      headers: bearer(creatorToken),
      payload: { action: "voice", prompt: "calm narration" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_allowed");
  });

  it("runs the full happy path: generate → export(commercial) → approve → pay", async () => {
    const gen = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      headers: bearer(creatorToken),
      payload: { action: "image", prompt: "아티스트 G, neon rain street, cinematic" },
    });
    expect(gen.statusCode).toBe(201);
    const creationId = gen.json().creation.creation_id;

    const exp = await app.inject({
      method: "POST",
      url: `/generations/${creationId}/export`,
      headers: bearer(creatorToken),
      payload: { use_type: "commercial" },
    });
    expect(exp.statusCode).toBe(201);
    const exportObj = exp.json().export;
    expect(exportObj.approval).toBe("pending");
    expect(exportObj.fee_amount).toBe(500_000);

    const approve = await app.inject({
      method: "POST",
      url: `/exports/${exportObj.export_id}/approve`,
      headers: bearer(ownerToken),
      payload: { approve: true },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().export.approval).toBe("approved");

    const pay = await app.inject({
      method: "POST",
      url: `/exports/${exportObj.export_id}/pay`,
      headers: bearer(ownerToken),
    });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().distribution).toEqual({ owner: 300_000, creator: 125_000, platform: 75_000 });
  });

  it("keeps the ledger integrity intact after the pipeline", async () => {
    const res = await app.inject({ method: "GET", url: "/ledger" });
    expect(res.json().integrity_ok).toBe(true);
  });

  it("issues a sealed license manifest with a visible AI label on settlement", async () => {
    const gen = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      headers: bearer(creatorToken),
      payload: { action: "image", prompt: "license check" },
    });
    const creationId = gen.json().creation.creation_id;
    const exp = await app.inject({
      method: "POST",
      url: `/generations/${creationId}/export`,
      headers: bearer(creatorToken),
      payload: { use_type: "personal" }, // auto-approved
    });
    const exportId = exp.json().export.export_id;
    await app.inject({ method: "POST", url: `/exports/${exportId}/pay`, headers: bearer(creatorToken) });

    const lic = await app.inject({ method: "GET", url: `/exports/${exportId}/license` });
    expect(lic.statusCode).toBe(200);
    const manifest = lic.json().license;
    expect(manifest.ai_label.visible).toBe(true);
    expect(manifest.manifest_hash).toHaveLength(64);
    expect(manifest.settlement.distribution.platform).toBeGreaterThan(0);
  });
});
