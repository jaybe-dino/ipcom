import { describe, expect, it } from "vitest";
import { EventBus } from "./bus.js";

describe("EventBus", () => {
  it("delivers events only to subscribers of the topic", () => {
    const bus = new EventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.subscribe("ch_a", (e) => a.push(e));
    bus.subscribe("ch_b", (e) => b.push(e));

    bus.publish({ type: "post.created", channel_id: "ch_a", post: 1 });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it("stops delivering after unsubscribe and cleans up the topic", () => {
    const bus = new EventBus();
    const unsub = bus.subscribe("ch", () => {});
    expect(bus.subscriberCount("ch")).toBe(1);
    unsub();
    expect(bus.subscriberCount("ch")).toBe(0);
  });

  it("isolates a throwing subscriber from the rest", () => {
    const bus = new EventBus();
    let reached = false;
    bus.subscribe("ch", () => {
      throw new Error("boom");
    });
    bus.subscribe("ch", () => {
      reached = true;
    });
    bus.publish({ type: "creation.updated", channel_id: "ch" });
    expect(reached).toBe(true);
  });
});
