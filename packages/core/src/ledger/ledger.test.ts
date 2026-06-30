import { describe, expect, it } from "vitest";
import { GENESIS_HASH } from "../types/ledger.js";
import { LicenseLedger } from "./ledger.js";
import { sha256Hex } from "./sha256.js";

describe("sha256Hex", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("LicenseLedger", () => {
  const ts = "2026-06-30T00:00:00.000Z";

  it("chains entries from genesis and verifies intact", () => {
    const ledger = new LicenseLedger();
    const a = ledger.append({
      entry_id: "e1",
      event_type: "create",
      actor: "u1",
      payload: { creation_id: "c1" },
      timestamp: ts,
    });
    expect(a.prev_hash).toBe(GENESIS_HASH);
    expect(a.index).toBe(0);

    const b = ledger.append({
      entry_id: "e2",
      event_type: "export",
      actor: "u1",
      payload: { export_id: "x1" },
      timestamp: ts,
    });
    expect(b.prev_hash).toBe(a.payload_hash);
    expect(ledger.verify()).toBe(-1);
  });

  it("detects tampering with a prior payload", () => {
    const ledger = new LicenseLedger();
    ledger.append({
      entry_id: "e1",
      event_type: "create",
      actor: "u1",
      payload: { amount: 100 },
      timestamp: ts,
    });
    ledger.append({
      entry_id: "e2",
      event_type: "settle",
      actor: "u1",
      payload: { amount: 200 },
      timestamp: ts,
    });

    // Mutate entry 0's payload after the fact.
    const tampered = ledger.list()[0]!;
    (tampered.payload as Record<string, unknown>).amount = 999;
    expect(ledger.verify()).toBe(0);
  });
});
