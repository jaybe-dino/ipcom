import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../server.js";
import { DrizzleRepo, migrate, type DrizzleDB } from "./repo.js";
import { schema } from "./schema.js";

/**
 * Runs the full generation → export → settle pipeline against a real Postgres
 * engine (PGlite, embedded) to prove the Drizzle persistence layer + ledger
 * hash chain work end to end, not just the in-memory repo.
 */
describe("DrizzleRepo (PGlite) — persistence + pipeline", () => {
  let app: ReturnType<typeof buildServer>;
  let repo: DrizzleRepo;
  let creatorToken: string;
  let ownerToken: string;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const db = drizzle(new PGlite(), { schema }) as unknown as DrizzleDB;
    await migrate(db);
    repo = new DrizzleRepo(db);
    await repo.seedIfEmpty();
    app = buildServer(repo);
    await app.ready();

    const login = async (email: string) =>
      (
        await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "password" } })
      ).json().token as string;
    creatorToken = await login("minji@remixhub.dev");
    ownerToken = await login("owner@remixhub.dev");
  });
  afterAll(async () => {
    await app.close();
  });

  it("persists seeded data", async () => {
    expect((await repo.listSpaces()).length).toBe(1);
    expect((await repo.getIp("ip_artist_g"))?.name).toBe("아티스트 G");
  });

  it("blocks hard-limit generation and records the refusal in the DB ledger", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      headers: bearer(creatorToken),
      payload: { action: "image", prompt: "성적 nsfw" },
    });
    expect(res.statusCode).toBe(403);
    const entries = await repo.listLedger();
    expect(entries.some((e) => e.payload.result === "denied")).toBe(true);
  });

  it("runs generate → export → approve → pay and keeps ledger integrity", async () => {
    const gen = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      headers: bearer(creatorToken),
      payload: { action: "image", prompt: "neon rain" },
    });
    const creationId = gen.json().creation.creation_id;
    // Reloaded from Postgres, not memory.
    expect((await repo.getCreation(creationId))?.status).toBe("generated");

    const exp = await app.inject({
      method: "POST",
      url: `/generations/${creationId}/export`,
      headers: bearer(creatorToken),
      payload: { use_type: "sale", sale_price: 100_000 },
    });
    const exportId = exp.json().export.export_id;

    await app.inject({
      method: "POST",
      url: `/exports/${exportId}/approve`,
      headers: bearer(ownerToken),
      payload: { approve: true },
    });
    const pay = await app.inject({
      method: "POST",
      url: `/exports/${exportId}/pay`,
      headers: bearer(creatorToken),
    });
    expect(pay.json().distribution).toEqual({ owner: 40_000, creator: 40_000, platform: 20_000 });
    expect(await repo.verifyLedger()).toBe(-1);
  });
});
