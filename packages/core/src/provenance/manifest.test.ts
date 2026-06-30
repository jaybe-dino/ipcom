import { describe, expect, it } from "vitest";
import { buildLicenseManifest, verifyManifest, type ManifestInput } from "./manifest.js";

const input: ManifestInput = {
  export_id: "exp_1",
  creation_id: "cr_1",
  ip_id: "ip_1",
  ip_name: "Artist G",
  creator_id: "u_1",
  use_type: "commercial",
  plugin_id: "nvidia.nim",
  model: "sdxl",
  prompt: "neon city",
  fee_amount: 500_000,
  distribution: { owner: 300_000, creator: 125_000, platform: 75_000 },
  issued_at: "2026-06-30T00:00:00.000Z",
};

describe("license manifest", () => {
  it("always attaches a visible AI label", () => {
    const m = buildLicenseManifest(input);
    expect(m.ai_label.visible).toBe(true);
    expect(m.ai_label.text).toContain("AI");
  });

  it("seals the manifest with a verifiable hash", () => {
    const m = buildLicenseManifest(input);
    expect(verifyManifest(m)).toBe(true);
  });

  it("detects tampering with settlement amounts", () => {
    const m = buildLicenseManifest(input);
    m.settlement.distribution.creator = 999_999;
    expect(verifyManifest(m)).toBe(false);
  });

  it("hashes the prompt rather than storing it verbatim", () => {
    const m = buildLicenseManifest(input);
    expect(m.provenance.prompt_hash).toHaveLength(64);
    expect(JSON.stringify(m)).not.toContain("neon city");
  });
});
