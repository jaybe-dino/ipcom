import { describe, expect, it } from "vitest";
import { nimConfigFromEnv } from "./nim.js";
import { PluginGateway } from "./gateway.js";
import type { PluginCapability, RemixPlugin } from "./types.js";

/** A trivial always-succeeds adapter for ordering tests. */
function fakePlugin(id: string, capabilities: PluginCapability[]): RemixPlugin {
  return {
    id,
    capabilities,
    async submit() {
      return { job_id: `${id}_job`, plugin_id: id, status: "succeeded" };
    },
    async poll() {
      return { status: "succeeded", progress: 1, output: `asset://${id}/out` };
    },
    provenance(output, req) {
      return { source_assets: [], model_info: { plugin_id: id }, prompt: req.prompt };
    },
  };
}

describe("PluginGateway", () => {
  it("falls back to the stub adapter when no vendor is configured", async () => {
    const gw = new PluginGateway([]);
    const out = await gw.generate({
      prompt: "neon city",
      source_assets: [],
      ip_id: "ip_1",
      action: "image",
    });
    expect(out.plugin_id).toBe("stub.local");
    expect(out.output).toMatch(/^asset:\/\//);
    expect(out.provenance.prompt).toBe("neon city");
  });

  it("handles every creative action via capability routing", async () => {
    const gw = new PluginGateway([]);
    for (const action of ["image", "video_recast", "music", "voice", "characterize"] as const) {
      const out = await gw.generate({ prompt: "x", source_assets: [], ip_id: "ip_1", action });
      expect(out.output).toBeTruthy();
    }
  });

  it("prefers the user-selected adapter, else the first capable one", async () => {
    const gw = new PluginGateway([fakePlugin("alpha", ["image"]), fakePlugin("beta", ["image"])]);
    const base = { prompt: "x", source_assets: [], ip_id: "ip_1", action: "image" as const };

    // Default: first capable adapter (alpha).
    expect((await gw.generate(base)).plugin_id).toBe("alpha");
    // Explicit preference wins.
    expect((await gw.generate({ ...base, preferred_plugin_id: "beta" })).plugin_id).toBe("beta");
    // Unknown/incapable preference falls back to capability routing.
    expect((await gw.generate({ ...base, preferred_plugin_id: "ghost" })).plugin_id).toBe("alpha");
  });
});

describe("nimConfigFromEnv", () => {
  it("returns null without an API key", () => {
    expect(nimConfigFromEnv({})).toBeNull();
  });

  it("enables image by default (SDXL) when only the key is set", () => {
    const cfg = nimConfigFromEnv({ NVIDIA_API_KEY: "k" });
    expect(cfg?.baseUrl).toBe("https://ai.api.nvidia.com/v1");
    expect(cfg?.models.image?.model).toBe("stabilityai/stable-diffusion-xl");
    expect(cfg?.models.video).toBeUndefined();
  });

  it("enables extra capabilities when their model env is set", () => {
    const cfg = nimConfigFromEnv({ NVIDIA_API_KEY: "k", NIM_VIDEO_MODEL: "vid-1", NIM_MUSIC_MODEL: "mus-1" });
    expect(cfg?.models.video?.model).toBe("vid-1");
    expect(cfg?.models.music?.model).toBe("mus-1");
  });
});
