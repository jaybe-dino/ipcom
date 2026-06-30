import { describe, expect, it } from "vitest";
import { defaultConsentPolicy } from "../consent/matrix.js";
import { screenHardLimits } from "../moderation/hardLimits.js";
import type { IP } from "../types/consent.js";
import { canGenerate, exportDecision } from "./gates.js";
import { distribute } from "./pricing.js";

function makeIP(overrides: Partial<IP> = {}): IP {
  return {
    ip_id: "ip_1",
    owner_id: "owner_1",
    name: "Artist G",
    verification: "official",
    policy: defaultConsentPolicy(),
    ...overrides,
  };
}

describe("G1 canGenerate", () => {
  it("allows an enabled action that passes moderation", () => {
    const ip = makeIP();
    const mod = screenHardLimits({ prompt: "neon cyberpunk city, cinematic" });
    expect(canGenerate(ip, "image", mod)).toEqual({ decision: "ALLOW" });
  });

  it("denies a disabled action with not_allowed", () => {
    const ip = makeIP(); // voice is OFF by default
    const mod = screenHardLimits({ prompt: "calm narration" });
    expect(canGenerate(ip, "voice", mod)).toEqual({
      decision: "DENY",
      reason: "not_allowed",
    });
  });

  it("denies on hard-limit violation regardless of consent", () => {
    const ip = makeIP();
    const mod = screenHardLimits({ prompt: "성적 deepfake nsfw" });
    expect(canGenerate(ip, "image", mod)).toEqual({
      decision: "DENY",
      reason: "hard_limit",
    });
  });
});

describe("G3 exportDecision", () => {
  it("auto-approves personal use with a flat fee", () => {
    const v = exportDecision(makeIP(), "personal");
    expect(v.outcome).toBe("auto");
    expect(v.fee).toBe(1_000);
    expect(v.visible_label).toBe(true);
  });

  it("routes commercial use to review with base fee", () => {
    const v = exportDecision(makeIP(), "commercial");
    expect(v.outcome).toBe("review");
    expect(v.fee).toBe(500_000);
    expect(v.split).toEqual({ owner: 0.6, creator: 0.25, platform: 0.15 });
  });

  it("requires sale_price for sale and prices at the sale price", () => {
    const ip = makeIP();
    expect(() => exportDecision(ip, "sale")).toThrow();
    const v = exportDecision(ip, "sale", { sale_price: 100_000 });
    expect(v.fee).toBe(100_000);
  });

  it("denies when policy is deny", () => {
    const ip = makeIP({
      policy: defaultConsentPolicy({ export_policy: { sale: "deny" } }),
    });
    const v = exportDecision(ip, "sale", { sale_price: 100_000 });
    expect(v).toEqual({ outcome: "deny", fee: 0, split: null, visible_label: true });
  });
});

describe("distribute", () => {
  it("splits commercial 500k as 300k/125k/75k", () => {
    expect(distribute(500_000, { owner: 0.6, creator: 0.25, platform: 0.15 })).toEqual({
      owner: 300_000,
      creator: 125_000,
      platform: 75_000,
    });
  });

  it("assigns rounding remainder to platform and always sums to gross", () => {
    const d = distribute(100, { owner: 1 / 3, creator: 1 / 3, platform: 1 / 3 });
    expect(d.owner + d.creator + d.platform).toBe(100);
  });
});
