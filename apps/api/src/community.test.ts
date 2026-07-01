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
