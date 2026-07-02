import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Detached provenance signature over a manifest hash (C2PA-style claim signing).
 * HMAC-SHA256 with a server key; a real deployment would use an asymmetric key
 * (ed25519) + certificate, but the sign/verify contract is identical.
 */
const DEV_KEY = "remix-hub-dev-provenance-key";

function signingKey(): string {
  return process.env.PROVENANCE_SIGNING_KEY ?? DEV_KEY;
}

/** Short, non-secret identifier for the active key (for rotation/audit). */
export function keyId(): string {
  return createHmac("sha256", "keyid").update(signingKey()).digest("hex").slice(0, 12);
}

export function signManifestHash(manifestHash: string): { signature: string; key_id: string } {
  const signature = createHmac("sha256", signingKey()).update(manifestHash).digest("hex");
  return { signature, key_id: keyId() };
}

export function verifyManifestSignature(manifestHash: string, signature: string): boolean {
  const expected = createHmac("sha256", signingKey()).update(manifestHash).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
