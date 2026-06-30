import { describe, expect, it, vi } from "vitest";
import { PluginGateway } from "./gateway.js";
import { NimPlugin, type NimConfig } from "./nim.js";
import type { GenRequest } from "./types.js";

const cfg = (models: NimConfig["models"]): NimConfig => ({
  apiKey: "test-key",
  baseUrl: "https://nim.test/v1",
  statusPath: "/status/{id}",
  models,
});

const reqFor = (action: GenRequest["action"]): GenRequest => ({
  prompt: "neon city",
  source_assets: [],
  ip_id: "ip_1",
  action,
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("NimPlugin", () => {
  it("sends an authorized request and parses a synchronous image artifact", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ artifacts: [{ base64: "QUJDREVGR0hJSktMTU5PUA==" }] }));
    const nim = new NimPlugin(cfg({ image: { model: "sdxl" } }), fetchFn as unknown as typeof fetch);

    const job = await nim.submit(reqFor("image"));
    const result = await nim.poll(job);

    expect(result.status).toBe("succeeded");
    expect(result.output).toMatch(/^nim-asset:\/\/sdxl\//);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://nim.test/v1/genai/sdxl");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("handles an async job: PENDING then succeeded via poll", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "PENDING", id: "job-9" }))
      .mockResolvedValueOnce(jsonResponse({ url: "https://cdn.test/out.mp4" }));
    const nim = new NimPlugin(cfg({ video: { model: "cosmos" } }), fetchFn as unknown as typeof fetch);

    const job = await nim.submit(reqFor("video_recast"));
    expect(job.status).toBe("running"); // submit returned a pending async job
    const result = await nim.poll(job); // poll() resolves the status URL
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("https://cdn.test/out.mp4");
    // status poll hit the configured status path
    expect(fetchFn.mock.calls[1]![0]).toBe("https://nim.test/v1/status/job-9");
  });

  it("fails the job (then gateway fails over to stub) on a non-OK response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "bad" }, false, 500));
    const nim = new NimPlugin(cfg({ image: { model: "sdxl" } }), fetchFn as unknown as typeof fetch);
    const gw = new PluginGateway([nim], { sleep: async () => {} });

    const out = await gw.generate(reqFor("image"));
    expect(out.plugin_id).toBe("stub.local"); // failover
  });

  it("only advertises capabilities for configured models", () => {
    const nim = new NimPlugin(cfg({ image: { model: "sdxl" }, music: { model: "m" } }));
    expect(nim.capabilities.sort()).toEqual(["image", "music"]);
  });
});
