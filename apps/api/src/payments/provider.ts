import { newId } from "../ids.js";

/**
 * Payment provider (PRD §4.6). Settlement charges the fee before distributing.
 * MockPaymentProvider auto-succeeds (dev/test); StripePaymentProvider drops in
 * when STRIPE_SECRET_KEY is set — same interface, no code changes elsewhere.
 * Amounts are integer minor units (KRW is zero-decimal).
 */
export interface ChargeInput {
  amount: number;
  currency: string;
  reference: string;
  description?: string;
}

export interface ChargeResult {
  ok: boolean;
  payment_id: string;
  status: string;
  error?: string;
}

export interface PaymentProvider {
  readonly id: string;
  charge(input: ChargeInput): Promise<ChargeResult>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = "mock";
  async charge(_input: ChargeInput): Promise<ChargeResult> {
    return { ok: true, payment_id: newId("pay"), status: "succeeded" };
  }
}

export type FetchFn = typeof fetch;

export class StripePaymentProvider implements PaymentProvider {
  readonly id = "stripe";
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = "https://api.stripe.com/v1",
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async charge(input: ChargeInput): Promise<ChargeResult> {
    try {
      const body = new URLSearchParams({
        amount: String(input.amount),
        currency: input.currency.toLowerCase(),
        description: input.description ?? input.reference,
        "metadata[reference]": input.reference,
      });
      const res = await this.fetchFn(`${this.baseUrl}/payment_intents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) {
        return { ok: false, payment_id: "", status: "failed", error: `stripe_${res.status}` };
      }
      const data = (await res.json()) as { id: string; status: string };
      return { ok: true, payment_id: data.id, status: data.status };
    } catch (e) {
      return { ok: false, payment_id: "", status: "failed", error: (e as Error).message };
    }
  }
}

export function paymentProviderFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  if (env.STRIPE_SECRET_KEY) {
    return new StripePaymentProvider(env.STRIPE_SECRET_KEY, env.STRIPE_BASE_URL ?? undefined);
  }
  return new MockPaymentProvider();
}
