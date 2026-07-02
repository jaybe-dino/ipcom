import { describe, expect, it, vi } from "vitest";
import { MockPaymentProvider, StripePaymentProvider, paymentProviderFromEnv } from "./provider.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("MockPaymentProvider", () => {
  it("auto-succeeds", async () => {
    const r = await new MockPaymentProvider().charge({ amount: 1000, currency: "KRW", reference: "x" });
    expect(r.ok).toBe(true);
    expect(r.payment_id).toBeTruthy();
  });
});

describe("StripePaymentProvider", () => {
  it("creates a PaymentIntent with auth + form body and returns its id", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: "pi_123", status: "requires_confirmation" }));
    const p = new StripePaymentProvider("sk_test", "https://api.stripe.test/v1", fetchFn as unknown as typeof fetch);
    const r = await p.charge({ amount: 500_000, currency: "KRW", reference: "exp_1" });
    expect(r.ok).toBe(true);
    expect(r.payment_id).toBe("pi_123");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.test/v1/payment_intents");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk_test" });
    expect(String((init as RequestInit).body)).toContain("amount=500000");
  });

  it("fails gracefully on a non-OK response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: {} }, false, 402));
    const p = new StripePaymentProvider("sk_test", undefined, fetchFn as unknown as typeof fetch);
    const r = await p.charge({ amount: 1000, currency: "KRW", reference: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("402");
  });
});

describe("paymentProviderFromEnv", () => {
  it("defaults to mock, uses Stripe when keyed", () => {
    expect(paymentProviderFromEnv({}).id).toBe("mock");
    expect(paymentProviderFromEnv({ STRIPE_SECRET_KEY: "sk" }).id).toBe("stripe");
  });
});
