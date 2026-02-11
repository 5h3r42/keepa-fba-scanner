// src/lib/fees.ts

export type FeeCategory = "BEAUTY_HEALTH" | "GROCERY" | "OTHER";

export type VatMode = {
  // If true: you are VAT registered (you charge output VAT, reclaim VAT on fees)
  vatRegistered: boolean;

  // Standard UK VAT rate (usually 20%)
  vatRate: number; // 0.2
};

export type FeeInputs = {
  sellPriceGross: number; // Buy Box price the customer pays (assume VAT-inclusive)
  category: FeeCategory;

  // Your defaults
  prepFee: number; // 0.69
  inboundFee: number; // 0.30

  vat: VatMode;
};

export type FeeBreakdown = {
  sellPriceGross: number;

  // Referral fee
  referralFeeExVat: number;
  referralFeeVat: number;
  referralFeeGross: number;

  // Prep + inbound (not VAT’d in this calculator; treat as your cost inputs)
  prepFee: number;
  inboundFee: number;

  // Totals (fees Amazon charges you)
  amazonFeesExVat: number;
  amazonFeesVat: number;
  amazonFeesGross: number;

  // Revenue net of VAT (only meaningful if vatRegistered=true)
  sellPriceNet: number;
};

/**
 * UK Referral Fee rules (from Amazon EU rate card):
 * - Beauty/Health/Personal Care: 8% up to £10, 15% above £10
 * - Grocery & Gourmet: 8% up to £10, 15% above £10
 * Source: Amazon FBA Rate Card (EU), effective 1 Feb 2025 :contentReference[oaicite:1]{index=1} :contentReference[oaicite:2]{index=2}
 */
export function calcReferralFeeExVatUK(
  sellPriceGross: number,
  category: FeeCategory,
): number {
  // Same tiering for these categories in the rate card
  const tiered =
    category === "BEAUTY_HEALTH" ||
    category === "GROCERY" ||
    category === "OTHER";

  if (!tiered) return round2(sellPriceGross * 0.15);

  const threshold = 10;
  const lowRate = 0.08;
  const highRate = 0.15;

  const lowPortion = Math.min(sellPriceGross, threshold);
  const highPortion = Math.max(0, sellPriceGross - threshold);

  return round2(lowPortion * lowRate + highPortion * highRate);
}

/**
 * Fee engine:
 * - Calculates referral fee ex VAT
 * - Adds VAT on Amazon fees (reclaimable if VAT registered)
 * - Includes prep + inbound (your operational costs)
 */
export function calcFeesUK(input: FeeInputs): FeeBreakdown {
  const { sellPriceGross, category, prepFee, inboundFee, vat } = input;

  const referralFeeExVat = calcReferralFeeExVatUK(sellPriceGross, category);

  // Amazon charges VAT on fees. If VAT registered, you reclaim it (so it’s not a real cost).
  const referralFeeVat = round2(referralFeeExVat * vat.vatRate);
  const referralFeeGross = round2(referralFeeExVat + referralFeeVat);

  const amazonFeesExVat = referralFeeExVat; // Step 1 only includes referral fee
  const amazonFeesVat = round2(amazonFeesExVat * vat.vatRate);
  const amazonFeesGross = round2(amazonFeesExVat + amazonFeesVat);

  const sellPriceNet = vat.vatRegistered
    ? round2(sellPriceGross / (1 + vat.vatRate))
    : sellPriceGross;

  return {
    sellPriceGross,

    referralFeeExVat,
    referralFeeVat,
    referralFeeGross,

    prepFee,
    inboundFee,

    amazonFeesExVat,
    amazonFeesVat,
    amazonFeesGross,

    sellPriceNet,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
