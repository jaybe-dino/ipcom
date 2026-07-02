import type { ISODateTime, Money } from "../types/common.js";
import type { UseType } from "../types/consent.js";
import { canonicalize } from "../ledger/ledger.js";
import { sha256Hex } from "../ledger/sha256.js";

/**
 * License manifest (PRD §4.5 / §7.3): the human- and machine-readable proof
 * attached to every external export. Carries the source IP, the granted license
 * terms, the mandatory visible "AI generated" label, provenance, and the
 * settlement split — sealed with a content hash so it can be verified later.
 */
export interface LicenseManifest {
  version: 1;
  export_id: string;
  creation_id: string;
  ip_id: string;
  ip_name: string;
  creator_id: string;
  use_type: UseType;
  /** Human-readable license scope/terms for this use type. */
  license: { scope: string; terms: string };
  /** AI disclosure. External exports are always visible (PRD §7.3). */
  ai_label: { visible: boolean; text: string };
  provenance: { plugin_id: string; model?: string; prompt_hash: string };
  settlement: {
    fee_amount: Money;
    distribution: { owner: Money; creator: Money; platform: Money };
  };
  issued_at: ISODateTime;
  /** Expiry of the granted license; null = perpetual (personal share, sale). */
  valid_until: ISODateTime | null;
  /** sha256 over the manifest contents (excluding this + signature fields). */
  manifest_hash: string;
  /** Detached signature over manifest_hash (set server-side; C2PA-style). */
  provenance_signature?: string;
  /** Identifier of the signing key. */
  signing_key_id?: string;
}

const AI_LABEL_TEXT = "AI 생성 콘텐츠 · REMIX HUB";

/**
 * Default license term per use type (days). Commercial licenses are time-boxed
 * (1 year), while personal shares and outright sales are perpetual (null).
 */
export const LICENSE_TERM_DAYS: Record<UseType, number | null> = {
  personal: null,
  commercial: 365,
  sale: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compute the expiry from issue time + a term in days. */
export function addDays(issued_at: ISODateTime, days: number): ISODateTime {
  return new Date(new Date(issued_at).getTime() + days * DAY_MS).toISOString();
}

const SCOPE_BY_USE: Record<UseType, { scope: string; terms: string }> = {
  personal: {
    scope: "비상업 개인 공유",
    terms: "워터마크 부착 · 재판매 불가 · SNS 등 개인 게시 한정",
  },
  commercial: {
    scope: "상업적 활용 라이선스",
    terms: "지정 범위·기간 내 광고/콘텐츠 소재 사용 · 재라이선스 불가",
  },
  sale: {
    scope: "작품 판매 라이선스",
    terms: "구매자에게 사용권 이전 · 수익 분배 적용",
  },
};

export interface ManifestInput {
  export_id: string;
  creation_id: string;
  ip_id: string;
  ip_name: string;
  creator_id: string;
  use_type: UseType;
  plugin_id: string;
  model?: string;
  prompt: string;
  fee_amount: Money;
  distribution: { owner: Money; creator: Money; platform: Money };
  issued_at: ISODateTime;
  /**
   * Explicit expiry override. When omitted, derived from LICENSE_TERM_DAYS for
   * the use type. Pass `null` to force a perpetual license.
   */
  valid_until?: ISODateTime | null;
}

/** Build a sealed license manifest. The hash covers every field except itself. */
export function buildLicenseManifest(input: ManifestInput): LicenseManifest {
  const base: Omit<LicenseManifest, "manifest_hash"> = {
    version: 1,
    export_id: input.export_id,
    creation_id: input.creation_id,
    ip_id: input.ip_id,
    ip_name: input.ip_name,
    creator_id: input.creator_id,
    use_type: input.use_type,
    license: SCOPE_BY_USE[input.use_type],
    ai_label: { visible: true, text: AI_LABEL_TEXT },
    provenance: {
      plugin_id: input.plugin_id,
      model: input.model,
      prompt_hash: sha256Hex(input.prompt),
    },
    settlement: { fee_amount: input.fee_amount, distribution: input.distribution },
    issued_at: input.issued_at,
    valid_until:
      input.valid_until !== undefined
        ? input.valid_until
        : LICENSE_TERM_DAYS[input.use_type] === null
          ? null
          : addDays(input.issued_at, LICENSE_TERM_DAYS[input.use_type]!),
  };
  return { ...base, manifest_hash: sha256Hex(canonicalize(base)) };
}

/** True if the license has a term and that term has passed as of `nowISO`. */
export function isLicenseExpired(manifest: LicenseManifest, nowISO: ISODateTime): boolean {
  if (!manifest.valid_until) return false;
  return new Date(nowISO).getTime() > new Date(manifest.valid_until).getTime();
}

/** Verify a manifest's seal. Returns true if the hash matches its contents. */
export function verifyManifest(manifest: LicenseManifest): boolean {
  // Exclude the hash itself and the detached signature fields (added post-seal).
  const { manifest_hash, provenance_signature, signing_key_id, ...rest } = manifest;
  return sha256Hex(canonicalize(rest)) === manifest_hash;
}
