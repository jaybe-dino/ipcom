import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

/** Users create spaces/channels, others join, membership drives access. */
describe("Community structure", () => {
  let app: ReturnType<typeof buildServer>;
  let minji: string;
  let owner: string;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = buildServer();
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

  it("creates a space with default channels and enrolls the creator", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/spaces",
      headers: bearer(minji),
      payload: { name: "인디 음악 팬클럽" },
    });
    expect(res.statusCode).toBe(201);
    const space = res.json().space;
    expect(space.member_count).toBe(1);

    const detail = await app.inject({ method: "GET", url: `/spaces/${space.space_id}` });
    expect(detail.json().channels.length).toBe(3); // 공지 / 자유수다 / 창작

    const mine = await app.inject({ method: "GET", url: "/me/spaces", headers: bearer(minji) });
    expect(mine.json().spaces.some((s: { space_id: string }) => s.space_id === space.space_id)).toBe(true);
  });

  it("lets another user join and blocks non-members from creating channels", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/spaces",
      headers: bearer(minji),
      payload: { name: "네온 아트" },
    });
    const spaceId = created.json().space.space_id;

    // Owner is not a member yet → cannot create a channel.
    const denied = await app.inject({
      method: "POST",
      url: `/spaces/${spaceId}/channels`,
      headers: bearer(owner),
      payload: { name: "잡담" },
    });
    expect(denied.statusCode).toBe(403);

    // Join, then it works and member_count grows.
    const joined = await app.inject({ method: "POST", url: `/spaces/${spaceId}/join`, headers: bearer(owner) });
    expect(joined.json().space.member_count).toBe(2);

    const ok = await app.inject({
      method: "POST",
      url: `/spaces/${spaceId}/channels`,
      headers: bearer(owner),
      payload: { name: "잡담", type: "community" },
    });
    expect(ok.statusCode).toBe(201);

    const members = await app.inject({ method: "GET", url: `/spaces/${spaceId}/members` });
    expect(members.json().members.length).toBe(2);
  });

  it("opens a private DM and blocks non-participants", async () => {
    const opened = await app.inject({
      method: "POST",
      url: "/dm/user_owner_g",
      headers: bearer(minji),
    });
    expect(opened.statusCode).toBe(201);
    const channelId = opened.json().channel_id;
    expect(opened.json().peer.user_id).toBe("user_owner_g");

    // minji posts a DM message.
    const sent = await app.inject({
      method: "POST",
      url: `/channels/${channelId}/messages`,
      headers: bearer(minji),
      payload: { text: "안녕 오너님, DM이에요" },
    });
    expect(sent.statusCode).toBe(201);

    // owner (participant) can read it.
    const ownerView = await app.inject({
      method: "GET",
      url: `/channels/${channelId}/posts`,
      headers: bearer(owner),
    });
    expect(ownerView.statusCode).toBe(200);
    expect(ownerView.json().posts.length).toBe(1);

    // Both see it in their DM list.
    const minjiDms = await app.inject({ method: "GET", url: "/me/dms", headers: bearer(minji) });
    expect(minjiDms.json().dms.some((d: { channel_id: string }) => d.channel_id === channelId)).toBe(true);

    // A third party (fresh user) is blocked from reading.
    const stranger = (
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "stranger@x.com", password: "pw", display_name: "낯선이" },
      })
    ).json().token as string;
    const blocked = await app.inject({
      method: "GET",
      url: `/channels/${channelId}/posts`,
      headers: bearer(stranger),
    });
    expect(blocked.statusCode).toBe(403);
  });

  it("paginates channel history with limit + before cursor", async () => {
    const space = (
      await app.inject({ method: "POST", url: "/spaces", headers: bearer(minji), payload: { name: "페이지방" } })
    ).json().space;
    const ch = (await app.inject({ method: "GET", url: `/spaces/${space.space_id}` })).json().channels[0];

    for (let i = 1; i <= 5; i++) {
      await app.inject({
        method: "POST",
        url: `/channels/${ch.channel_id}/messages`,
        headers: bearer(minji),
        payload: { text: `메시지 ${i}` },
      });
    }

    const page1 = (
      await app.inject({ method: "GET", url: `/channels/${ch.channel_id}/posts?limit=2` })
    ).json();
    expect(page1.posts.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    // Ascending: last two are 메시지 4, 5.
    expect(page1.posts[1].text).toBe("메시지 5");

    const older = (
      await app.inject({
        method: "GET",
        url: `/channels/${ch.channel_id}/posts?limit=2&before=${encodeURIComponent(page1.posts[0].created_at)}`,
      })
    ).json();
    expect(older.posts.length).toBe(2);
    expect(older.posts.every((p: { created_at: string }) => p.created_at < page1.posts[0].created_at)).toBe(true);
  });

  it("removes membership on leave", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/spaces",
      headers: bearer(minji),
      payload: { name: "떠날 방" },
    });
    const spaceId = created.json().space.space_id;
    await app.inject({ method: "POST", url: `/spaces/${spaceId}/join`, headers: bearer(owner) });
    await app.inject({ method: "POST", url: `/spaces/${spaceId}/leave`, headers: bearer(owner) });
    const members = await app.inject({ method: "GET", url: `/spaces/${spaceId}/members` });
    expect(members.json().members.length).toBe(1);
  });
});
