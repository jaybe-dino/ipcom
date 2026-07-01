import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

/** Mentions, replies, and DMs generate unread notifications for recipients. */
describe("Notifications", () => {
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

  it("notifies on @mention of a space member", async () => {
    // minji mentions 민지? no — owner mentions 민지 (display_name "민지").
    await app.inject({
      method: "POST",
      url: "/channels/ch_chat/messages",
      headers: bearer(owner),
      payload: { text: "@민지 이거 확인해줘" },
    });
    const res = await app.inject({ method: "GET", url: "/me/notifications", headers: bearer(minji) });
    const n = res.json();
    expect(n.unread).toBeGreaterThanOrEqual(1);
    expect(n.notifications[0].type).toBe("mention");
    expect(n.notifications[0].actor_id).toBe("user_owner_g");
  });

  it("notifies the parent author on reply", async () => {
    const base = await app
      .inject({
        method: "POST",
        url: "/channels/ch_chat/messages",
        headers: bearer(minji),
        payload: { text: "질문 있어요" },
      })
      .then((r) => r.json());
    await app.inject({
      method: "POST",
      url: "/channels/ch_chat/messages",
      headers: bearer(owner),
      payload: { text: "답변드려요", reply_to: base.post.post_id },
    });
    const res = await app.inject({ method: "GET", url: "/me/notifications", headers: bearer(minji) });
    expect(res.json().notifications.some((x: { type: string }) => x.type === "reply")).toBe(true);
  });

  it("notifies the peer on a DM and clears on read", async () => {
    const dm = await app
      .inject({ method: "POST", url: "/dm/user_owner_g", headers: bearer(minji) })
      .then((r) => r.json());
    await app.inject({
      method: "POST",
      url: `/channels/${dm.channel_id}/messages`,
      headers: bearer(minji),
      payload: { text: "안녕하세요 DM이에요" },
    });
    const ownerN = await app.inject({ method: "GET", url: "/me/notifications", headers: bearer(owner) });
    expect(ownerN.json().notifications.some((x: { type: string }) => x.type === "dm")).toBe(true);

    await app.inject({ method: "POST", url: "/me/notifications/read", headers: bearer(owner) });
    const after = await app.inject({ method: "GET", url: "/me/notifications/unread_count", headers: bearer(owner) });
    expect(after.json().count).toBe(0);
  });
});
