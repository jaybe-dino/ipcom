import {
  applyCoupon,
  buildLicenseManifest,
  creationOrderDistribution,
  templateOrderDistribution,
  type Coupon,
  type Currency,
  type Listing,
  type Order,
  type PromptTemplate,
} from "@remix-hub/core";
import type { AssetStore } from "./assets/store.js";
import { newId, now } from "./ids.js";
import { MockPaymentProvider, type PaymentProvider } from "./payments/provider.js";
import { signManifestHash } from "./provenance/sign.js";
import type { Repo } from "./repo/types.js";

type Result<T> = { ok: true; value: T } | { ok: false; status: number; reason: string };

/**
 * Marketplace service (PRD §4.7): list exportable creations and prompt
 * templates, purchase them, and auto-issue a license + settle with the platform
 * take rate. Reuses the Rights Engine split (creation) / flat take (template).
 */
export class MarketService {
  constructor(
    private readonly repo: Repo,
    private readonly assets: AssetStore,
    private readonly payments: PaymentProvider = new MockPaymentProvider(),
  ) {}

  async catalog(): Promise<{ listings: Listing[]; templates: PromptTemplate[] }> {
    const [listings, templates] = await Promise.all([
      this.repo.listListings(),
      this.repo.listTemplates(),
    ]);
    return { listings: listings.filter((l) => l.active), templates };
  }

  /** Create (or overwrite) a promo code. Codes are normalized to upper-case. */
  async createCoupon(params: {
    code: string;
    kind: Coupon["kind"];
    value: number;
    minPrice?: number;
    maxRedemptions?: number | null;
    expiresAt?: string | null;
  }): Promise<Result<Coupon>> {
    const code = params.code?.trim().toUpperCase();
    if (!code) return { ok: false, status: 400, reason: "invalid_code" };
    if (params.kind === "percent" && !(params.value > 0 && params.value <= 1)) {
      return { ok: false, status: 400, reason: "percent_must_be_0_1" };
    }
    if (params.kind === "fixed" && params.value <= 0) {
      return { ok: false, status: 400, reason: "invalid_value" };
    }
    const coupon: Coupon = {
      code,
      kind: params.kind,
      value: params.value,
      min_price: params.minPrice ?? null,
      max_redemptions: params.maxRedemptions ?? null,
      redemptions: 0,
      active: true,
      expires_at: params.expiresAt ?? null,
      created_at: now(),
    };
    await this.repo.saveCoupon(coupon);
    return { ok: true, value: coupon };
  }

  async listCoupons(): Promise<Coupon[]> {
    return this.repo.listCoupons();
  }

  async createTemplate(params: {
    authorId: string;
    title: string;
    body: string;
    ipId?: string;
  }): Promise<PromptTemplate> {
    const template: PromptTemplate = {
      template_id: newId("tpl"),
      author_id: params.authorId,
      ip_id: params.ipId ?? null,
      title: params.title,
      body: params.body,
      created_at: now(),
    };
    await this.repo.saveTemplate(template);
    return template;
  }

  async createListing(params: {
    sellerId: string;
    kind: Listing["kind"];
    refId: string;
    title: string;
    price: number;
    currency?: Currency;
  }): Promise<Result<Listing>> {
    let ipId: string | null = null;
    if (params.kind === "creation") {
      const creation = await this.repo.getCreation(params.refId);
      if (!creation) return { ok: false, status: 404, reason: "creation_not_found" };
      if (creation.creator_id !== params.sellerId) {
        return { ok: false, status: 403, reason: "not_creation_owner" };
      }
      ipId = creation.ip_id;
    } else {
      const template = await this.repo.getTemplate(params.refId);
      if (!template) return { ok: false, status: 404, reason: "template_not_found" };
      if (template.author_id !== params.sellerId) {
        return { ok: false, status: 403, reason: "not_template_author" };
      }
    }
    if (params.price <= 0) return { ok: false, status: 400, reason: "invalid_price" };

    const listing: Listing = {
      listing_id: newId("lst"),
      kind: params.kind,
      seller_id: params.sellerId,
      ref_id: params.refId,
      ip_id: ipId,
      title: params.title,
      price: params.price,
      currency: params.currency ?? "KRW",
      active: true,
      created_at: now(),
    };
    await this.repo.saveListing(listing);
    return { ok: true, value: listing };
  }

  async purchase(listingId: string, buyerId: string, couponCode?: string): Promise<Result<Order>> {
    const listing = await this.repo.getListing(listingId);
    if (!listing || !listing.active) return { ok: false, status: 404, reason: "listing_not_found" };
    if (listing.seller_id === buyerId) return { ok: false, status: 400, reason: "cannot_buy_own_listing" };

    // Resolve an optional promo code up-front so an invalid one fails cleanly.
    // The platform absorbs the discount: the buyer is charged the reduced price
    // and the whole settlement (charge, split, license) runs on that amount.
    let couponCodeApplied: string | null = null;
    let discount = 0;
    if (couponCode?.trim()) {
      const coupon = await this.repo.getCoupon(couponCode.trim().toUpperCase());
      if (!coupon) return { ok: false, status: 404, reason: "coupon_not_found" };
      const applied = applyCoupon(listing.price, coupon, now());
      if (!applied.ok) return { ok: false, status: 400, reason: applied.reason };
      discount = applied.discount;
      couponCodeApplied = coupon.code;
    }
    const chargeable = listing.price - discount;

    // Charge the buyer before issuing the license (mock in dev; Stripe if keyed).
    const charge = await this.payments.charge({
      amount: chargeable,
      currency: listing.currency,
      reference: listing.listing_id,
      description: `REMIX HUB ${listing.kind} ${listing.title}`,
    });
    if (!charge.ok) return { ok: false, status: 402, reason: "payment_failed" };

    // Compute the split: creation → IP sale split, template → flat take rate.
    let distribution;
    let manifestFields: { ip_id: string; ip_name: string; creator_id: string; plugin_id: string; model?: string; prompt: string };
    if (listing.kind === "creation") {
      const creation = await this.repo.getCreation(listing.ref_id);
      const ip = creation ? await this.repo.getIp(creation.ip_id) : null;
      if (!creation || !ip) return { ok: false, status: 404, reason: "creation_not_found" };
      distribution = creationOrderDistribution(chargeable, ip.policy.revenue_split.sale);
      manifestFields = {
        ip_id: ip.ip_id,
        ip_name: ip.name,
        creator_id: creation.creator_id,
        plugin_id: creation.plugin_id,
        model: creation.provenance?.model_info.model,
        prompt: creation.provenance?.prompt ?? "",
      };
    } else {
      const template = await this.repo.getTemplate(listing.ref_id);
      if (!template) return { ok: false, status: 404, reason: "template_not_found" };
      distribution = templateOrderDistribution(chargeable);
      manifestFields = {
        ip_id: template.ip_id ?? "none",
        ip_name: "prompt-template",
        creator_id: template.author_id,
        plugin_id: "template",
        prompt: template.title,
      };
    }

    const orderId = newId("ord");
    const manifest = buildLicenseManifest({
      export_id: orderId,
      creation_id: listing.ref_id,
      use_type: "sale",
      fee_amount: chargeable,
      distribution,
      issued_at: now(),
      ...manifestFields,
    });
    const sig = signManifestHash(manifest.manifest_hash);
    manifest.provenance_signature = sig.signature;
    manifest.signing_key_id = sig.key_id;
    const licenseDoc = await this.assets.put({
      scope: "export",
      content_type: "application/vnd.remixhub.license+json",
      data: manifest,
    });

    const order: Order = {
      order_id: orderId,
      listing_id: listing.listing_id,
      buyer_id: buyerId,
      seller_id: listing.seller_id,
      amount: chargeable,
      distribution,
      license_doc: licenseDoc,
      coupon_code: couponCodeApplied,
      discount,
      status: "paid",
      created_at: now(),
    };
    await this.repo.saveOrder(order);
    if (couponCodeApplied) await this.repo.redeemCoupon(couponCodeApplied);

    await this.repo.appendLedger({
      event_type: "settle",
      actor: buyerId,
      payload: {
        order_id: order.order_id,
        listing_id: listing.listing_id,
        kind: listing.kind,
        amount: chargeable,
        list_price: listing.price,
        coupon_code: couponCodeApplied,
        discount,
        distribution,
        license_doc: licenseDoc,
        manifest_hash: manifest.manifest_hash,
      },
    });

    return { ok: true, value: order };
  }
}
