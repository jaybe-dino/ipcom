import { describe, expect, it } from "vitest";
import { Metrics, RateLimiter } from "./observability.js";

describe("RateLimiter", () => {
  it("allows up to max then denies within the window", () => {
    let t = 1000;
    const rl = new RateLimiter(3, 1000, () => t);
    expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(true);
    const denied = rl.check("k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    let t = 0;
    const rl = new RateLimiter(1, 1000, () => t);
    expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(false);
    t = 1001;
    expect(rl.check("k").allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter(1, 1000, () => 0);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });
});

describe("Metrics", () => {
  it("counts by status class and errors", () => {
    const m = new Metrics();
    m.record(200);
    m.record(404);
    m.record(500);
    const s = m.snapshot();
    expect(s.total).toBe(3);
    expect(s.errors).toBe(1);
    expect(s.by_status["2xx"]).toBe(1);
    expect(s.by_status["5xx"]).toBe(1);
  });
});
