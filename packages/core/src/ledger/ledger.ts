import type { ISODateTime, UUID } from "../types/common.js";
import { GENESIS_HASH, type LedgerEntry, type LedgerEventType } from "../types/ledger.js";
import { sha256Hex } from "./sha256.js";

/**
 * Append-only License Ledger (PRD §3.6 / §5.4).
 *
 * Each entry's `payload_hash` is computed over a canonical serialization of
 * (index, event_type, actor, payload, prev_hash, timestamp). Chaining
 * `prev_hash` makes any retroactive edit detectable.
 */

export interface NewEntryInput {
  event_type: LedgerEventType;
  actor: UUID;
  payload: Record<string, unknown>;
  timestamp: ISODateTime;
  /** Supply an id generator to keep core free of randomness side effects. */
  entry_id: UUID;
}

/** Stable JSON: object keys sorted recursively so hashing is deterministic. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

export function hashEntry(
  index: number,
  input: NewEntryInput,
  prev_hash: string,
): string {
  return sha256Hex(
    canonicalize({
      index,
      event_type: input.event_type,
      actor: input.actor,
      payload: input.payload,
      prev_hash,
      timestamp: input.timestamp,
    }),
  );
}

/** An append-only ledger with integrity verification. */
export class LicenseLedger {
  private entries: LedgerEntry[] = [];

  constructor(initial: LedgerEntry[] = []) {
    this.entries = [...initial];
  }

  get length(): number {
    return this.entries.length;
  }

  list(): readonly LedgerEntry[] {
    return this.entries;
  }

  get headHash(): string {
    const last = this.entries[this.entries.length - 1];
    return last ? last.payload_hash : GENESIS_HASH;
  }

  append(input: NewEntryInput): LedgerEntry {
    const index = this.entries.length;
    const prev_hash = this.headHash;
    const payload_hash = hashEntry(index, input, prev_hash);
    const entry: LedgerEntry = {
      entry_id: input.entry_id,
      event_type: input.event_type,
      actor: input.actor,
      payload: input.payload,
      payload_hash,
      prev_hash,
      timestamp: input.timestamp,
      index,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Verify the full chain. Returns the first broken index, or -1 if intact. */
  verify(): number {
    let prev = GENESIS_HASH;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.index !== i || e.prev_hash !== prev) return i;
      const recomputed = hashEntry(
        i,
        {
          event_type: e.event_type,
          actor: e.actor,
          payload: e.payload,
          timestamp: e.timestamp,
          entry_id: e.entry_id,
        },
        prev,
      );
      if (recomputed !== e.payload_hash) return i;
      prev = e.payload_hash;
    }
    return -1;
  }
}
