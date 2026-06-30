import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("REMIX HUB API — generation → export → settle pipeline", () => {
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists the seeded space", async () => {
    const res = await app.inject({ method: "GET", url: "/spaces" });
    expect(res.statusCode).toBe(200);
    expect(res.json().spaces).toHaveLength(1);
  });

  it("blocks a hard-limit generation at G1", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      payload: { action: "image", prompt: "성적 nsfw deepfake" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("hard_limit");
  });

  it("blocks a disabled action (voice OFF) at G1", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      payload: { action: "voice", prompt: "calm narration" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_allowed");
  });

  it("runs the full happy path: generate → export(commercial) → approve → pay", async () => {
    const gen = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      headers: { "x-user-id": "user_minji" },
      payload: { action: "image", prompt: "아티스트 G, neon rain street, cinematic" },
    });
    expect(gen.statusCode).toBe(201);
    const creationId = gen.json().creation.creation_id;

    const exp = await app.inject({
      method: "POST",
      url: `/generations/${creationId}/export`,
      headers: { "x-user-id": "user_minji" },
      payload: { use_type: "commercial" },
    });
    expect(exp.statusCode).toBe(201);
    const exportObj = exp.json().export;
    expect(exportObj.approval).toBe("pending");
    expect(exportObj.fee_amount).toBe(500_000);

    const approve = await app.inject({
      method: "POST",
      url: `/exports/${exportObj.export_id}/approve`,
      headers: { "x-user-id": "user_owner_g" },
      payload: { approve: true },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().export.approval).toBe("approved");

    const pay = await app.inject({
      method: "POST",
      url: `/exports/${exportObj.export_id}/pay`,
      headers: { "x-user-id": "user_owner_g" },
    });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().distribution).toEqual({ owner: 300_000, creator: 125_000, platform: 75_000 });
  });

  it("keeps the ledger integrity intact after the pipeline", async () => {
    const res = await app.inject({ method: "GET", url: "/ledger" });
    expect(res.json().integrity_ok).toBe(true);
  });
});
