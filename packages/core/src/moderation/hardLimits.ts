import { HARD_LIMIT_CATEGORIES, type HardLimitCategory } from "../types/consent.js";
import type { ModerationResult } from "../types/creation.js";

/**
 * Lightweight, deterministic pre-generation screen (PRD §4.4).
 *
 * This is a placeholder classifier: in production the Plugin Gateway calls a
 * real moderation model and feeds the scores here. The contract — score map +
 * threshold → pass/flag — stays identical, so the production model is a drop-in.
 */

export interface ModerationInput {
  prompt: string;
  source_assets?: string[];
  /** Externally-computed category scores [0,1]; merged over the keyword screen. */
  scores?: Partial<Record<HardLimitCategory, number>>;
}

/** Decision threshold; scores at or above this flag the category. */
export const HARD_LIMIT_THRESHOLD = 0.5;

/** Naive Korean+English keyword lexicon for the offline screen. */
const LEXICON: Record<HardLimitCategory, RegExp[]> = {
  sexual: [/\b(nsfw|nude|sexual|porn)\b/i, /성적|음란|노출/],
  defamation: [/\b(fake news|defamation)\b/i, /허위사실|명예훼손|가짜뉴스/],
  harassment: [/\b(threat|harass|blackmail)\b/i, /협박|괴롭힘|스토킹/],
  political_abuse: [/\b(political\s+smear)\b/i, /정치적\s*악용|선거조작/],
};

function keywordScore(text: string, patterns: RegExp[]): number {
  return patterns.some((re) => re.test(text)) ? 1 : 0;
}

/**
 * Run the hard-limit screen. Returns a ModerationResult; `passed === false`
 * means generation must be denied.
 */
export function screenHardLimits(input: ModerationInput): ModerationResult {
  const haystack = [input.prompt, ...(input.source_assets ?? [])].join(" \n ");
  const scores: Record<string, number> = {};
  const flagged: string[] = [];

  for (const category of HARD_LIMIT_CATEGORIES) {
    const external = input.scores?.[category] ?? 0;
    const lexical = keywordScore(haystack, LEXICON[category]);
    const score = Math.max(external, lexical);
    scores[category] = score;
    if (score >= HARD_LIMIT_THRESHOLD) flagged.push(category);
  }

  return { passed: flagged.length === 0, scores, flagged };
}
