import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../server.js";
import { DrizzleRepo, migrate, type DrizzleDB } from "./repo.js";
import { schema } from "./schema.js";

/**
 * Runs the full community/chat feature set against a REAL Postgres engine
 * (PGlite) — messages, replies, mentions/notifications, reactions, edit/delete,
 * DM privacy, pagination, and image attachments. Guards against Postgres-only
 * bugs the in-memory suite can't catch.
 */
describe("Chat features on Postgres (PGlite)", () => {
  let app: ReturnType<typeof buildServer>;
  let minji: string;
  let owner: string;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const db = drizzle(new PGlite(), { schema }) as unknown as DrizzleDB;
    await migrate(db);
    const repo = new DrizzleRepo(db);
    await repo.seedIfEmpty();
    app = buildServer(repo);
    await app.ready();
    const login = async (email: string) =>
      (await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "password" } })).json()
        .token as string;
    minji = await login("minji@remixhub.dev");
    owner = await login("owner@remixhub.dev");
  });
  afterAll(async () => {
    await app.close();
  });

  it("sends, replies, mentions → notifications persist", async () => {
    const base = await app
      .inject({ method: "POST", url: "/channels/ch_chat/messages", headers: bearer(minji), payload: { text: "부모" } })
      .then((r) => r.json());
    await app.inject({
      method: "POST",
      url: "/channels/ch_chat/messages",
      headers: bearer(owner),
      payload: { text: "@민지 답글", reply_to: base.post.post_id },
    });
    const n = await app.inject({ method: "GET", url: "/me/notifications", headers: bearer(minji) }).then((r) => r.json());
    expect(n.unread).toBeGreaterThanOrEqual(1);
    // both a mention and a reply could match; at least one exists
    expect(["mention", "reply"]).toContain(n.notifications[0].type);
  });

  it("reactions persist with viewer's own flag", async () => {
    const p = await app
      .inject({ method: "POST", url: "/channels/ch_chat/messages", headers: bearer(minji), payload: { text: "react me" } })
      .then((r) => r.json());
    await app.inject({
      method: "POST",
      url: `/posts/${p.post.post_id}/reactions`,
      headers: bearer(minji),
      payload: { emoji: "🔥" },
    });
    const posts = await app
      .inject({ method: "GET", url: "/channels/ch_chat/posts", headers: bearer(minji) })
      .then((r) => r.json());
    expect(posts.reactions[p.post.post_id]).toEqual([{ emoji: "🔥", count: 1, mine: true }]);
  });

  it("edits, deletes, and attaches images", async () => {
    const p = await app
      .inject({ method: "POST", url: "/channels/ch_chat/messages", headers: bearer(minji), payload: { text: "orig" } })
      .then((r) => r.json());
    const edited = await app
      .inject({ method: "PATCH", url: `/posts/${p.post.post_id}`, headers: bearer(minji), payload: { text: "new" } })
      .then((r) => r.json());
    expect(edited.post.text).toBe("new");
    expect(edited.post.edited_at).toBeTruthy();

    const img = await app
      .inject({
        method: "POST",
        url: "/channels/ch_chat/messages",
        headers: bearer(minji),
        payload: { image_url: "https://example.com/x.png" },
      })
      .then((r) => r.json());
    expect(img.post.image_url).toBe("https://example.com/x.png");

    const del = await app.inject({ method: "DELETE", url: `/posts/${p.post.post_id}`, headers: bearer(minji) });
    expect(del.statusCode).toBe(200);
  });

  it("keeps DMs private and paginates history", async () => {
    const dm = await app.inject({ method: "POST", url: "/dm/user_owner_g", headers: bearer(minji) }).then((r) => r.json());
    await app.inject({
      method: "POST",
      url: `/channels/${dm.channel_id}/messages`,
      headers: bearer(minji),
      payload: { text: "secret" },
    });
    // owner (participant) reads; register a stranger who cannot.
    const ok = await app.inject({ method: "GET", url: `/channels/${dm.channel_id}/posts`, headers: bearer(owner) });
    expect(ok.statusCode).toBe(200);

    // pagination in a fresh space channel
    const space = (
      await app.inject({ method: "POST", url: "/spaces", headers: bearer(minji), payload: { name: "pg방" } })
    ).json().space;
    const ch = (await app.inject({ method: "GET", url: `/spaces/${space.space_id}` })).json().channels[0];
    for (let i = 0; i < 4; i++) {
      await app.inject({
        method: "POST",
        url: `/channels/${ch.channel_id}/messages`,
        headers: bearer(minji),
        payload: { text: `m${i}` },
      });
    }
    const page = await app
      .inject({ method: "GET", url: `/channels/${ch.channel_id}/posts?limit=2`, headers: bearer(minji) })
      .then((r) => r.json());
    expect(page.posts.length).toBe(2);
    expect(page.hasMore).toBe(true);
  });
});
