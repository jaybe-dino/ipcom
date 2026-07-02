import { describe, expect, it, vi } from "vitest";
import { NoopNotifier, WebhookNotifier, notifierFromEnv } from "./notifier.js";

describe("WebhookNotifier", () => {
  it("POSTs a JSON envelope with a bearer token", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const n = new WebhookNotifier("https://hook.test/notify", "secret", fetchFn as unknown as typeof fetch);
    await n.send({ kind: "settlement", to: "u_1", title: "정산", body: "완료" });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://hook.test/notify");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret" });
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload).toMatchObject({ source: "remix-hub", kind: "settlement", to: "u_1" });
    expect(payload.sent_at).toBeTruthy();
  });

  it("never throws when delivery fails (fail-safe)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const n = new WebhookNotifier("https://hook.test", undefined, fetchFn as unknown as typeof fetch);
    await expect(n.send({ kind: "dm", to: "u", title: "t", body: "b" })).resolves.toBeUndefined();
  });
});

describe("notifierFromEnv", () => {
  it("defaults to noop, uses webhook when URL is set", () => {
    expect(notifierFromEnv({}).id).toBe("noop");
    expect(notifierFromEnv({ NOTIFY_WEBHOOK_URL: "https://x" }).id).toBe("webhook");
    expect(new NoopNotifier().id).toBe("noop");
  });
});
