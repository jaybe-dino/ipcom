import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

/**
 * Live WebSocket test: a real client subscribes to a channel, a generation is
 * posted via HTTP, and the client must receive the broadcast post.created event.
 * Uses Node's built-in global WebSocket (Node 18+).
 */
describe("Realtime channel WebSocket", () => {
  let app: ReturnType<typeof buildServer>;
  let baseUrl: string;
  let wsBase: string;
  let token: string;

  beforeAll(async () => {
    app = buildServer();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "minji@remixhub.dev", password: "password" }),
    });
    token = (await res.json()).token;
  });
  afterAll(async () => {
    await app.close();
  });

  it("rejects a connection without a token", async () => {
    const closed = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${wsBase}/ws/channels/ch_image_remix`);
      ws.onclose = (e) => resolve(e.code);
      ws.onerror = () => resolve(-1);
    });
    expect(closed).not.toBe(1000);
  });

  it("broadcasts a generation post to channel subscribers", async () => {
    const url = `${wsBase}/ws/channels/ch_image_remix?token=${token}`;
    const ws = new WebSocket(url);

    const events: any[] = [];
    const gotPost = new Promise<any>((resolve) => {
      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data as string);
        events.push(data);
        if (data.type === "post.created") resolve(data);
      };
    });
    await new Promise<void>((resolve) => (ws.onopen = () => resolve()));

    // Trigger a generation in that channel via HTTP.
    await fetch(`${baseUrl}/spaces/space_artist_g/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "image", prompt: "live neon", channel_id: "ch_image_remix" }),
    });

    const evt = await gotPost;
    expect(evt.type).toBe("post.created");
    expect(evt.post.text).toBe("live neon");
    expect(evt.creation.action).toBe("image");
    expect(events[0].type).toBe("hello");
    ws.close();
  });

  it("broadcasts a chat message with author info to channel subscribers", async () => {
    const ws = new WebSocket(`${wsBase}/ws/channels/ch_chat?token=${token}`);
    const gotMsg = new Promise<any>((resolve) => {
      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data as string);
        if (data.type === "post.created") resolve(data);
      };
    });
    await new Promise<void>((resolve) => (ws.onopen = () => resolve()));

    const res = await fetch(`${baseUrl}/channels/ch_chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: "안녕하세요 👋" }),
    });
    expect(res.status).toBe(201);

    const evt = await gotMsg;
    expect(evt.post.text).toBe("안녕하세요 👋");
    expect(evt.post.creation_id).toBeNull();
    expect(evt.author.display_name).toBe("민지");
    ws.close();
  });

  it("rejects an empty chat message", async () => {
    const res = await fetch(`${baseUrl}/channels/ch_chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("supports replies and toggling emoji reactions with live broadcast", async () => {
    const json = (r: Response) => r.json();
    const h = { "content-type": "application/json", authorization: `Bearer ${token}` };

    // A base message, then a reply to it.
    const base = await fetch(`${baseUrl}/channels/ch_chat/messages`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ text: "부모 메시지" }),
    }).then(json);
    const reply = await fetch(`${baseUrl}/channels/ch_chat/messages`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ text: "답글이에요", reply_to: base.post.post_id }),
    }).then(json);
    expect(reply.post.reply_to).toBe(base.post.post_id);

    // React (added), and a live subscriber sees reaction.updated.
    const ws = new WebSocket(`${wsBase}/ws/channels/ch_chat?token=${token}`);
    const gotReaction = new Promise<any>((resolve) => {
      ws.onmessage = (ev) => {
        const d = JSON.parse(ev.data as string);
        if (d.type === "reaction.updated") resolve(d);
      };
    });
    await new Promise<void>((r) => (ws.onopen = () => r()));

    const r1 = await fetch(`${baseUrl}/posts/${base.post.post_id}/reactions`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ emoji: "🔥" }),
    }).then(json);
    expect(r1.added).toBe(true);
    const evt = await gotReaction;
    expect(evt.emoji).toBe("🔥");
    expect(evt.added).toBe(true);
    ws.close();

    // Reactions show up (with mine=true) in the channel fetch.
    const posts = await fetch(`${baseUrl}/channels/ch_chat/posts`, { headers: h }).then(json);
    expect(posts.reactions[base.post.post_id]).toEqual([{ emoji: "🔥", count: 1, mine: true }]);

    // Toggling again removes it.
    const r2 = await fetch(`${baseUrl}/posts/${base.post.post_id}/reactions`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ emoji: "🔥" }),
    }).then(json);
    expect(r2.added).toBe(false);
  });
});
