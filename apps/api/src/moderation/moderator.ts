import { screenHardLimits, type ModerationInput, type ModerationResult } from "@remix-hub/core";

/**
 * Pluggable moderation (PRD §4.4). The keyword screen is the offline default;
 * a real classifier drops in behind the same interface via HttpModerator — it
 * fetches category scores from an external model and feeds them into the core
 * Hard Limit screen (which applies the shared threshold), so policy stays in
 * one place. Any failure falls back to the keyword screen (fail-safe).
 */
export interface Moderator {
  screen(input: ModerationInput): Promise<ModerationResult>;
}

export class KeywordModerator implements Moderator {
  async screen(input: ModerationInput): Promise<ModerationResult> {
    return screenHardLimits(input);
  }
}

export type FetchFn = typeof fetch;

export interface HttpModeratorConfig {
  url: string;
  apiKey?: string;
}

export class HttpModerator implements Moderator {
  constructor(
    private readonly config: HttpModeratorConfig,
    private readonly fallback: Moderator = new KeywordModerator(),
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async screen(input: ModerationInput): Promise<ModerationResult> {
    try {
      const res = await this.fetchFn(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({ input: [input.prompt, ...(input.source_assets ?? [])].join("\n") }),
      });
      if (!res.ok) throw new Error(`moderation ${res.status}`);
      const data = (await res.json()) as { scores?: Record<string, number> };
      // Merge model scores with any caller-provided scores, then apply the
      // shared threshold + keyword net in core.
      return screenHardLimits({ ...input, scores: { ...input.scores, ...(data.scores ?? {}) } });
    } catch {
      return this.fallback.screen(input);
    }
  }
}

export function moderatorFromEnv(env: NodeJS.ProcessEnv = process.env): Moderator {
  if (env.MODERATION_URL) {
    return new HttpModerator({ url: env.MODERATION_URL, apiKey: env.MODERATION_API_KEY });
  }
  return new KeywordModerator();
}
