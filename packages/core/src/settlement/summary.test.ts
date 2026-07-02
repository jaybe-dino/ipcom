import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types/ledger.js";
import { summarizeSettlements } from "./summary.js";

function entry(partial: Partial<LedgerEntry>): LedgerEntry {
  return {
    entry_id: Math.random().toString(36).slice(2),
    event_type: "settle",
    actor: "u_1",
    payload: {},
    payload_hash: "h",
    prev_hash: "p",
    timestamp: "2026-07-01T10:00:00.000Z",
    index: 0,
    ...partial,
  };
}

describe("summarizeSettlements", () => {
  const entries: LedgerEntry[] = [
    entry({ event_type: "export", payload: { use_type: "commercial", fee_amount: 500_000 } }),
    entry({
      event_type: "settle",
      timestamp: "2026-07-01T10:00:00.000Z",
      payload: { fee_amount: 500_000, distribution: { owner: 300_000, creator: 125_000, platform: 75_000 } },
    }),
    entry({
      event_type: "settle",
      timestamp: "2026-07-02T09:00:00.000Z",
      payload: { order_id: "ord_1", amount: 100_000, distribution: { owner: 60_000, creator: 25_000, platform: 15_000 } },
    }),
  ];

  it("totals fees and distribution across settle events", () => {
    const s = summarizeSettlements(entries, { days: 7, now: "2026-07-02T12:00:00.000Z" });
    expect(s.export_count).toBe(1);
    expect(s.settle_count).toBe(2);
    expect(s.total_fees).toBe(600_000);
    expect(s.distribution).toEqual({ owner: 360_000, creator: 150_000, platform: 90_000 });
  });

  it("splits revenue by source (export vs marketplace order)", () => {
    const s = summarizeSettlements(entries, { now: "2026-07-02T12:00:00.000Z" });
    expect(s.by_source.export).toEqual({ count: 1, fees: 500_000 });
    expect(s.by_source.market).toEqual({ count: 1, fees: 100_000 });
  });

  it("produces a continuous daily window with gaps zero-filled", () => {
    const s = summarizeSettlements(entries, { days: 3, now: "2026-07-02T12:00:00.000Z" });
    expect(s.daily.map((d) => d.date)).toEqual(["2026-06-30", "2026-07-01", "2026-07-02"]);
    expect(s.daily[0]!.fees).toBe(0); // no activity
    expect(s.daily[1]!.fees).toBe(500_000);
    expect(s.daily[2]!.fees).toBe(100_000);
  });
});
