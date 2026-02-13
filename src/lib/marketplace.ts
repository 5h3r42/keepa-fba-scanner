export type Marketplace = "UK" | "US" | "EU";

export type CurrencyCode = "GBP" | "USD" | "EUR";

export type MarketplaceConfig = {
  key: Marketplace;
  label: string;
  keepaDomain: number;
  amazonHost: string;
  defaultCurrency: CurrencyCode;
};

const MARKETPLACE_CONFIG: Record<Marketplace, MarketplaceConfig> = {
  UK: {
    key: "UK",
    label: "United Kingdom",
    keepaDomain: 2,
    amazonHost: "amazon.co.uk",
    defaultCurrency: "GBP",
  },
  US: {
    key: "US",
    label: "United States",
    keepaDomain: 1,
    amazonHost: "amazon.com",
    defaultCurrency: "USD",
  },
  EU: {
    key: "EU",
    label: "Europe",
    keepaDomain: 3,
    amazonHost: "amazon.de",
    defaultCurrency: "EUR",
  },
};

export const MARKETPLACE_KEYS = Object.keys(MARKETPLACE_CONFIG) as Marketplace[];

export const CURRENCY_KEYS: CurrencyCode[] = ["GBP", "USD", "EUR"];

export const getMarketplaceConfig = (marketplace: Marketplace): MarketplaceConfig =>
  MARKETPLACE_CONFIG[marketplace];

export const normalizeMarketplace = (input: unknown): Marketplace => {
  const value = String(input ?? "").trim().toUpperCase();
  if (value === "US") return "US";
  if (value === "EU") return "EU";
  return "UK";
};

export const normalizeCurrency = (
  input: unknown,
  fallbackMarketplace: Marketplace,
): CurrencyCode => {
  const value = String(input ?? "").trim().toUpperCase();
  if (value === "USD") return "USD";
  if (value === "EUR") return "EUR";
  if (value === "GBP") return "GBP";
  return getMarketplaceConfig(fallbackMarketplace).defaultCurrency;
};

export const formatCurrencyValue = (value: number, currency: CurrencyCode): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);

export const marketplaceOptions = MARKETPLACE_KEYS.map((key) => ({
  value: key,
  label: MARKETPLACE_CONFIG[key].label,
}));

export const currencyOptions = CURRENCY_KEYS.map((key) => ({
  value: key,
  label: key,
}));
