import { describe, expect, it } from "vitest";
import { type RgbaImage, decodePng, embedWatermark, encodePng, extractWatermark } from "./watermark.js";

/** Deterministic gradient so tests never rely on randomness. */
function gradient(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 7) & 0xff;
      data[i + 1] = (y * 5) & 0xff;
      data[i + 2] = (x * y) & 0xff;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("PNG codec", () => {
  it("round-trips an RGBA image losslessly", () => {
    const img = gradient(24, 16);
    const decoded = decodePng(encodePng(img));
    expect(decoded.width).toBe(24);
    expect(decoded.height).toBe(16);
    expect(Buffer.from(decoded.data)).toEqual(Buffer.from(img.data));
  });

  it("rejects non-PNG input", () => {
    expect(() => decodePng(Buffer.from("nope"))).toThrow(/not_a_png/);
  });
});

describe("invisible watermark", () => {
  it("embeds and recovers a payload", () => {
    const png = encodePng(gradient(64, 64));
    const marked = embedWatermark(png, "exp_abc123|hash:deadbeef");
    expect(extractWatermark(marked)).toBe("exp_abc123|hash:deadbeef");
  });

  it("returns null for an unmarked image", () => {
    expect(extractWatermark(encodePng(gradient(32, 32)))).toBeNull();
  });

  it("is visually imperceptible (only the blue LSB changes)", () => {
    const img = gradient(64, 64);
    const marked = decodePng(embedWatermark(encodePng(img), "provenance"));
    let maxDelta = 0;
    for (let i = 0; i < img.data.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(img.data[i]! - marked.data[i]!));
    }
    expect(maxDelta).toBeLessThanOrEqual(1); // ±1 on the blue LSB only
  });

  it("throws when the payload exceeds pixel capacity", () => {
    const png = encodePng(gradient(8, 8)); // 64 px → 64 bits ≈ 8 bytes total
    expect(() => embedWatermark(png, "x".repeat(100))).toThrow(/too_large/);
  });

  it("survives a decode/encode re-host cycle", () => {
    const marked = embedWatermark(encodePng(gradient(48, 48)), "keep-me");
    const rehosted = encodePng(decodePng(marked)); // simulate re-saving the PNG
    expect(extractWatermark(rehosted)).toBe("keep-me");
  });
});
