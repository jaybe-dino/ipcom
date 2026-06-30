import { describe, expect, it } from "vitest";
import { nimConfigFromEnv } from "./nim.js";
import { PluginGateway } from "./gateway.js";

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
