/**
 * @remix-hub/core
 *
 * Platform-agnostic domain for REMIX HUB: types, the Rights Engine (G1/G2/G3),
 * the Consent Matrix, moderation hard limits, pricing/settlement math, and the
 * append-only License Ledger. Shared by the API server and every client
 * (web today; app/desktop later).
 */
export * from "./types/index.js";

// Consent Matrix
export {
  defaultConsentPolicy,
  revisePolicy,
  hardLimits,
  invalidSplits,
  type ConsentPolicyOverrides,
} from "./consent/matrix.js";

// Moderation
export {
  screenHardLimits,
  HARD_LIMIT_THRESHOLD,
  type ModerationInput,
} from "./moderation/hardLimits.js";

// Rights Engine
export {
  canGenerate,
  canShareInternally,
  exportDecision,
  type GateDecision,
  type GenerateVerdict,
  type ExportOutcome,
  type ExportVerdict,
} from "./rights/gates.js";
export {
  priceFor,
  distribute,
  PRICING_DEFAULTS,
  type PricingContext,
  type Distribution,
} from "./rights/pricing.js";

// License Ledger
export {
  LicenseLedger,
  canonicalize,
  hashEntry,
  type NewEntryInput,
} from "./ledger/ledger.js";
export { sha256Hex } from "./ledger/sha256.js";

// Provenance / Watermark
export {
  buildLicenseManifest,
  verifyManifest,
  isLicenseExpired,
  addDays,
  LICENSE_TERM_DAYS,
  type LicenseManifest,
  type ManifestInput,
} from "./provenance/manifest.js";

// Marketplace
export {
  creationOrderDistribution,
  templateOrderDistribution,
  TEMPLATE_TAKE_RATE,
} from "./market/pricing.js";

// Settlement analytics
export {
  summarizeSettlements,
  type SettlementSummary,
  type DailyPoint,
  type Split,
} from "./settlement/summary.js";
