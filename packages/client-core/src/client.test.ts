import { describe, expect, it, vi } from "vitest";
import { createApi } from "./api.js";
import { channelWsUrl } from "./realtime.js";
import { MemoryStorage, Session } from "./session.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("Session", () => {
  it("persists and restores token + user via storage", async () => {
    const storage = new MemoryStorage();
    const s1 = new Session(storage);
    s1.set({ token: "t1", user: { user_id: "u1", role: "CREATOR", kyc_status: "none", age_verified: false } });

    const s2 = new Session(storage);
    await s2.init();
    expect(s2.token).toBe("t1");
    expect(s2.user?.user_id).toBe("u1");
  });

  it("notifies subscribers and clears", () => {
    const s = new Session();
    let hits = 0;
    s.subscribe(() => hits++);
    s.set({ token: "t", user: { user_id: "u", role: "CREATOR", kyc_status: "none", age_verified: false } });
    s.clear();
    expect(hits).toBe(2);
    expect(s.token).toBeNull();
  });
});

describe("createApi", () => {
  it("attaches the session bearer token to requests", async () => {
    const session = new Session();
    session.set({ token: "abc", user: { user_id: "u", role: "CREATOR", kyc_status: "none", age_verified: false } });
    const fetchImpl = vi.fn(async () => jsonResponse({ spaces: [] }));
    const api = createApi({ session, baseUrl: "http://x", fetchImpl: fetchImpl as unknown as typeof fetch });

    await api.listSpaces();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://x/spaces");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer abc" });
  });

  it("login stores the session; errors surface as ApiError", async () => {
    const session = new Session();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "tok", user: { user_id: "u", role: "OWNER", kyc_status: "verified", age_verified: true } }))
      .mockResolvedValueOnce(jsonResponse({ error: "creation_not_found" }, false, 404));
    const api = createApi({ session, baseUrl: "http://x", fetchImpl: fetchImpl as unknown as typeof fetch });

    await api.login("a@b.c", "pw");
    expect(session.token).toBe("tok");

    await expect(api.getSpace("missing")).rejects.toMatchObject({ status: 404, message: "creation_not_found" });
  });
});

describe("channelWsUrl", () => {
  it("derives ws:// from an absolute http base", () => {
    expect(channelWsUrl({ baseUrl: "http://h:4000", channelId: "c1", token: "t" })).toBe(
      "ws://h:4000/ws/channels/c1?token=t",
    );
  });
  it("uses origin for a relative base (web)", () => {
    expect(
      channelWsUrl({ channelId: "c1", token: "t", origin: { protocol: "https:", host: "app.dev" } }),
    ).toBe("wss://app.dev/api/ws/channels/c1?token=t");
  });
});
