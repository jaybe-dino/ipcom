/**
 * Outbound notifications (PRD §2.1 알림). In-app notifications are persisted by
 * the repo; this fans the important ones OUT to email/push via a webhook so a
 * downstream function (SES/SendGrid/FCM/Slack) can deliver them.
 *
 * Env-gated and drop-in: NoopNotifier by default (dev/test), WebhookNotifier
 * when NOTIFY_WEBHOOK_URL is set. Fail-safe by contract — send() never throws,
 * so a flaky notifier can't break the request that triggered it.
 */
export type NotifyKind = "mention" | "reply" | "dm" | "export_decision" | "settlement";

export interface OutboundNotification {
  kind: NotifyKind;
  /** Recipient user id. */
  to: string;
  /** Actor that triggered it, if any. */
  actor?: string;
  title: string;
  body: string;
  /** Extra structured context for the receiver (ids, amounts, links). */
  meta?: Record<string, unknown>;
}

export interface Notifier {
  readonly id: string;
  send(n: OutboundNotification): Promise<void>;
}

export class NoopNotifier implements Notifier {
  readonly id = "noop";
  async send(): Promise<void> {
    /* no-op */
  }
}

export type FetchFn = typeof fetch;

export class WebhookNotifier implements Notifier {
  readonly id = "webhook";
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(n: OutboundNotification): Promise<void> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      await this.fetchFn(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ source: "remix-hub", sent_at: new Date().toISOString(), ...n }),
      });
    } catch {
      // Best-effort: delivery failures must not surface to the caller.
    }
  }
}

export function notifierFromEnv(env: NodeJS.ProcessEnv = process.env): Notifier {
  if (env.NOTIFY_WEBHOOK_URL) {
    return new WebhookNotifier(env.NOTIFY_WEBHOOK_URL, env.NOTIFY_WEBHOOK_TOKEN);
  }
  return new NoopNotifier();
}
