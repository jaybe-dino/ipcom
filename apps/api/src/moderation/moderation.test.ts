import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { HttpModerator, KeywordModerator } from "./moderator.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("HttpModerator", () => {
  it("maps model scores through the core Hard Limit screen", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ scores: { sexual: 0.95 } }));
    const mod = new HttpModerator({ url: "https://mod.test" }, new KeywordModerator(), fetchFn as unknown as typeof fetch);
    const res = await mod.screen({ prompt: "harmless text" });
    expect(res.passed).toBe(false); // model score trips the threshold
    expect(res.flagged).toContain("sexual");
  });

  it("falls back to the keyword screen on error (fail-safe)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "down" }, false, 500));
    const mod = new HttpModerator({ url: "https://mod.test" }, new KeywordModerator(), fetchFn as unknown as typeof fetch);
    // Keyword net still catches an explicit term.
    const res = await mod.screen({ prompt: "성적 deepfake" });
    expect(res.passed).toBe(false);
  });
});

describe("Report queue", () => {
  let app: ReturnType<typeof buildServer>;
  let creator: string;
  let owner: string;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    const login = async (email: string) =>
      (await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "password" } })).json()
        .token as string;
    creator = await login("minji@remixhub.dev");
    owner = await login("owner@remixhub.dev");
  });
  afterAll(async () => {
    await app.close();
  });

  it("files a report, lists it for moderators, and resolves it", async () => {
    const filed = await app.inject({
      method: "POST",
      url: "/reports",
      headers: bearer(creator),
      payload: { target_type: "post", target_id: "post_1", reason: "스팸" },
    });
    expect(filed.statusCode).toBe(201);
    const reportId = filed.json().report.report_id;

    const open = await app.inject({ method: "GET", url: "/admin/reports?status=open", headers: bearer(owner) });
    expect(open.json().reports.some((r: { report_id: string }) => r.report_id === reportId)).toBe(true);

    const resolved = await app.inject({
      method: "POST",
      url: `/admin/reports/${reportId}/resolve`,
      headers: bearer(owner),
      payload: { action: "actioned", note: "삭제 처리" },
    });
    expect(resolved.json().report.status).toBe("actioned");
  });

  it("blocks non-moderators from the report queue (RBAC)", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/reports", headers: bearer(creator) });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an empty report reason", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/reports",
      headers: bearer(creator),
      payload: { target_type: "post", target_id: "post_1", reason: "  " },
    });
    expect(res.statusCode).toBe(400);
  });
});
