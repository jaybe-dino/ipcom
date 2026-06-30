import type { ISODateTime, UUID } from "./common.js";

/**
 * PRD §3.6 — LedgerEntry (원장). Append-only with a hash chain for integrity.
 * Blockchain/NFT embedding is an optional later phase.
 */

export type LedgerEventType = "create" | "export" | "settle" | "adjust";

export interface LedgerEntry {
  entry_id: UUID;
  event_type: LedgerEventType;
  /** Who triggered the event. */
  actor: UUID;
  /** Domain payload for the event (creation/export/settlement details). */
  payload: Record<string, unknown>;
  /** Hash of this entry's canonical contents. */
  payload_hash: string;
  /** Hash of the previous entry (genesis = GENESIS_HASH). */
  prev_hash: string;
  timestamp: ISODateTime;
  /** Sequence index, 0-based. */
  index: number;
}

export const GENESIS_HASH = "0".repeat(64);
