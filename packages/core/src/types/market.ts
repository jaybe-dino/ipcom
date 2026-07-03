import type { Currency, ISODateTime, Money, UUID } from "./common.js";

/**
 * Marketplace (PRD §4.7 / §6): catalog of exportable works and prompt
 * templates, orders, and automatic license issuance with a platform take rate.
 */

export type ListingKind = "creation" | "template";

export interface PromptTemplate {
  template_id: UUID;
  author_id: UUID;
  ip_id?: UUID | null;
  title: string;
  /** The reusable prompt/workflow body. */
  body: string;
  created_at: ISODateTime;
}

export interface Listing {
  listing_id: UUID;
  kind: ListingKind;
  seller_id: UUID;
  /** creation_id (kind=creation) or template_id (kind=template). */
  ref_id: UUID;
  /** Source IP for creation listings (drives the revenue split). */
  ip_id?: UUID | null;
  title: string;
  price: Money;
  currency: Currency;
  active: boolean;
  created_at: ISODateTime;
}

export type OrderStatus = "paid" | "refunded";

export interface Order {
  order_id: UUID;
  listing_id: UUID;
  buyer_id: UUID;
  seller_id: UUID;
  amount: Money;
  /** Split applied at purchase time. */
  distribution: { owner: Money; creator: Money; platform: Money };
  /** Issued license manifest asset id. */
  license_doc?: UUID | null;
  /** Promo code applied at checkout, if any, and the discount it granted. */
  coupon_code?: string | null;
  discount?: Money | null;
  status: OrderStatus;
  created_at: ISODateTime;
}

/** Discount kind: percentage off (0..1) or a fixed KRW amount. */
export type CouponKind = "percent" | "fixed";

/**
 * A marketplace promo code (PRD §6). The platform absorbs the discount off its
 * take: the buyer pays less, the transaction settles on the discounted amount.
 */
export interface Coupon {
  code: string;
  kind: CouponKind;
  /** For "percent": fraction in (0,1]. For "fixed": KRW off. */
  value: number;
  /** Minimum listing price the code applies to. */
  min_price?: Money | null;
  /** Max redemptions across all buyers (null = unlimited). */
  max_redemptions?: number | null;
  redemptions: number;
  active: boolean;
  expires_at?: ISODateTime | null;
  created_at: ISODateTime;
}
