import { describe, expect, it } from "vitest";
import { creationOrderDistribution, templateOrderDistribution } from "./pricing.js";

describe("marketplace pricing", () => {
  it("distributes a creation sale by the IP sale split", () => {
    const d = creationOrderDistribution(100_000, { owner: 0.4, creator: 0.4, platform: 0.2 });
    expect(d).toEqual({ owner: 40_000, creator: 40_000, platform: 20_000 });
  });

  it("applies a flat take rate to template sales (rest to author)", () => {
    const d = templateOrderDistribution(10_000);
    expect(d).toEqual({ owner: 0, creator: 8_000, platform: 2_000 });
  });

  it("always sums to the gross amount", () => {
    const d = templateOrderDistribution(9_999, 0.3);
    expect(d.owner + d.creator + d.platform).toBe(9_999);
  });
});
