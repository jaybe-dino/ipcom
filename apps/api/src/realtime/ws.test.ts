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
});
