import { describe, expect, it, vi } from "vitest";
import { MemoryRepo } from "../repo/memory.js";
import { RemixService } from "../service.js";
import { PluginGateway } from "../plugins/gateway.js";
import type { Notifier, OutboundNotification } from "./notifier.js";

/** A spy notifier that records every outbound event. */
function spyNotifier() {
  const events: OutboundNotification[] = [];
  const notifier: Notifier = {
    id: "spy",
    async send(n) {
      events.push(n);
    },
  };
  return { notifier, events };
}

function makeService(notifier: Notifier) {
  const repo = new MemoryRepo();
  const gateway = new PluginGateway(); // built-in stub failover
  // repo, gateway, bus?, assets, moderator, payments, notifier
  const service = new RemixService(repo, gateway, undefined, undefined, undefined, undefined, notifier);
  return { repo, service };
}

describe("outbound notification dispatch", () => {
  it("fans out a mention to the notifier", async () => {
    const { notifier, events } = spyNotifier();
    const { service } = makeService(notifier);
    // owner mentions 민지 (display_name) in the seeded chat channel.
    await service.sendMessage({ channelId: "ch_chat", authorId: "user_owner_g", text: "@민지 확인 부탁" });
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget settle
    expect(events.some((e) => e.kind === "mention" && e.to === "user_minji")).toBe(true);
  });

  it("notifies the requester on an export decision and the creator on settlement", async () => {
    const { notifier, events } = spyNotifier();
    const { repo, service } = makeService(notifier);

    const gen = await service.submitGeneration({
      spaceId: "space_artist_g",
      creatorId: "user_minji",
      action: "image",
      prompt: "notify me",
    });
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    // Wait for async completion so the creation is 'generated'.
    for (let i = 0; i < 20; i++) {
      if ((await repo.getCreation(gen.creation.creation_id))?.status === "generated") break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const exp = await service.requestExport({
      creationId: gen.creation.creation_id,
      requesterId: "user_minji",
      useType: "commercial",
    });
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;

    await service.decideExport({ exportId: exp.export.export_id, ownerId: "user_owner_g", approve: true });
    await service.payAndSettle(exp.export.export_id, "user_owner_g");
    await new Promise((r) => setTimeout(r, 0));

    expect(events.some((e) => e.kind === "export_decision" && e.to === "user_minji")).toBe(true);
    expect(events.some((e) => e.kind === "settlement" && e.to === "user_minji")).toBe(true);

    // A commercial license carries a 365-day term. A reminder window past that
    // catches it; a tiny window does not.
    const near = await service.remindExpiringLicenses({ withinDays: 400 });
    expect(near.reminded).toBeGreaterThanOrEqual(1);
    expect(near.expiring.some((x) => x.requester_id === "user_minji")).toBe(true);
    expect(events.some((e) => e.kind === "license_expiry" && e.to === "user_minji")).toBe(true);

    const far = await service.remindExpiringLicenses({ withinDays: 1 });
    expect(far.reminded).toBe(0);
  });
});
