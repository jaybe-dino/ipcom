import type { ISODateTime } from "../types/common.js";
import type { LedgerEntry } from "../types/ledger.js";

/**
 * Settlement analytics (PRD §4.8 정산 대시보드). A pure aggregation over the
 * license ledger so the same numbers can be computed server-side, tested in
 * isolation, and rendered as charts on the client.
 */
export interface Split {
  owner: number;
  creator: number;
  platform: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  fees: number;
  owner: number;
  creator: number;
  platform: number;
}

export interface SettlementSummary {
  export_count: number;
  settle_count: number;
  total_fees: number;
  distribution: Split;
  /** Revenue by source: external exports vs marketplace orders. */
  by_source: { export: { count: number; fees: number }; market: { count: number; fees: number } };
  /** One point per day for the trailing `days` window, oldest first. */
  daily: DailyPoint[];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function splitOf(e: LedgerEntry): Split {
  const d = e.payload.distribution as Partial<Split> | undefined;
  return { owner: num(d?.owner), creator: num(d?.creator), platform: num(d?.platform) };
}

/** Settle entries record the fee under `fee_amount` (export) or `amount` (order). */
function feeOf(e: LedgerEntry): number {
  return num(e.payload.fee_amount ?? e.payload.amount);
}

function dayStr(iso: ISODateTime): string {
  return iso.slice(0, 10);
}

export function summarizeSettlements(
  entries: LedgerEntry[],
  opts: { days?: number; now?: ISODateTime } = {},
): SettlementSummary {
  const days = opts.days ?? 14;
  const now = opts.now ?? new Date().toISOString();

  const settle = entries.filter((e) => e.event_type === "settle");
  const distribution: Split = { owner: 0, creator: 0, platform: 0 };
  const by_source = { export: { count: 0, fees: 0 }, market: { count: 0, fees: 0 } };
  let total_fees = 0;
  const perDay = new Map<string, DailyPoint>();

  for (const e of settle) {
    const fee = feeOf(e);
    const s = splitOf(e);
    total_fees += fee;
    distribution.owner += s.owner;
    distribution.creator += s.creator;
    distribution.platform += s.platform;

    // Marketplace settlements carry an order_id; external exports do not.
    const bucket = e.payload.order_id ? by_source.market : by_source.export;
    bucket.count += 1;
    bucket.fees += fee;

    const day = dayStr(e.timestamp);
    const point = perDay.get(day) ?? { date: day, fees: 0, owner: 0, creator: 0, platform: 0 };
    point.fees += fee;
    point.owner += s.owner;
    point.creator += s.creator;
    point.platform += s.platform;
    perDay.set(day, point);
  }

  // Build a continuous trailing window ending at `now`, filling gaps with zeros.
  const daily: DailyPoint[] = [];
  const end = new Date(dayStr(now));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    daily.push(perDay.get(key) ?? { date: key, fees: 0, owner: 0, creator: 0, platform: 0 });
  }

  return {
    export_count: entries.filter((e) => e.event_type === "export").length,
    settle_count: settle.length,
    total_fees,
    distribution,
    by_source,
    daily,
  };
}
