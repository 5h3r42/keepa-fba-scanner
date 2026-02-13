import { NextResponse } from "next/server";
import {
  getMarketplaceConfig,
  normalizeMarketplace,
  type Marketplace,
} from "@/lib/marketplace";
import type { TokenBudgetMode } from "@/lib/scan-types";

type KeepaRequestBody = {
  asins?: unknown;
  codes?: unknown;
  marketplace?: unknown;
  tokenGuard?: unknown;
};

type KeepaTokenMeta = {
  tokensLeft: number | null;
  refillIn: number | null;
  refillRate: number | null;
  timestamp: number | null;
};

type KeepaRequestCostMeta = {
  requestId: string;
  marketplace: Marketplace;
  requestedAsins: number;
  requestedCodes: number;
  apiCalls: number;
  durationMs: number;
  startedAt: string;
  blockedByGuard: boolean;
};

type TokenGuardConfig = {
  mode: TokenBudgetMode;
  hardLimit: number;
};

type KeepaProductResult = {
  asin?: string;
  matchedCode?: string;
  eanList?: Array<string | number>;
  upcList?: Array<string | number>;
  ean?: string | number;
  upc?: string | number;
  gtin?: string | number;
};

type KeepaApiResponse = {
  products?: KeepaProductResult[];
  tokensLeft?: number;
  refillIn?: number;
  refillRate?: number;
  timestamp?: number;
};

type KeepaLookupResult = {
  products: KeepaProductResult[];
  tokenMeta: KeepaTokenMeta;
  apiCalls: number;
};

type RateBucket = {
  count: number;
  windowStart: number;
};

type RequestContext = {
  marketplace: Marketplace;
  tokenGuard: TokenGuardConfig;
};

const MAX_LOOKUP_VALUES = 300;
const MAX_REQUEST_VALUES = 500;
const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 350;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Math.max(
  5,
  Number.parseInt(process.env.KEEPA_PROXY_RPM ?? "40", 10) || 40,
);
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 45_000;

const rateBuckets = new Map<string, RateBucket>();

const circuitState = {
  failures: 0,
  openUntil: 0,
};

const lastTokenSnapshot = new Map<Marketplace, { asin: number | null; code: number | null }>();

const normalizeAsins = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  return input
    .filter((asin): asin is string => typeof asin === "string")
    .map((asin) => asin.trim().toUpperCase())
    .filter((asin) => /^[A-Z0-9]{10}$/.test(asin));
};

const normalizeCodes = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  return input
    .filter((code): code is string => typeof code === "string")
    .map((code) => code.replace(/\D/g, ""))
    .filter((code) => /^[0-9]{8,14}$/.test(code));
};

const getAsinsFromQuery = (req: Request): string[] => {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("asin");
  if (!raw) return [];
  return raw
    .split(",")
    .map((asin) => asin.trim().toUpperCase())
    .filter((asin) => /^[A-Z0-9]{10}$/.test(asin));
};

const getCodesFromQuery = (req: Request): string[] => {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("code");
  if (!raw) return [];
  return raw
    .split(",")
    .map((code) => code.replace(/\D/g, ""))
    .filter((code) => /^[0-9]{8,14}$/.test(code));
};

const normalizeTokenGuard = (input: unknown): TokenGuardConfig => {
  if (!input || typeof input !== "object") {
    return { mode: "off", hardLimit: 0 };
  }

  const record = input as Record<string, unknown>;
  const modeRaw = String(record.mode ?? "off").trim().toLowerCase();
  const mode: TokenBudgetMode =
    modeRaw === "warn" || modeRaw === "hard_stop" ? (modeRaw as TokenBudgetMode) : "off";

  const hardLimitNum = Number(record.hardLimit);
  const hardLimit = Number.isFinite(hardLimitNum)
    ? Math.max(0, Math.floor(hardLimitNum))
    : 0;

  return {
    mode,
    hardLimit,
  };
};

const normalizeRequestContext = (input: {
  marketplace?: unknown;
  tokenGuard?: unknown;
}): RequestContext => ({
  marketplace: normalizeMarketplace(input.marketplace),
  tokenGuard: normalizeTokenGuard(input.tokenGuard),
});

const getClientKey = (req: Request): string => {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const candidate = forwardedFor || realIp || "unknown";
  return `${candidate}:${req.headers.get("user-agent") ?? "ua"}`;
};

const enforceRateLimit = (req: Request): { allowed: true } | { allowed: false; retryAfter: number } => {
  const key = getClientKey(req);
  const now = Date.now();
  const existing = rateBuckets.get(key);

  if (!existing || now - existing.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((existing.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  existing.count += 1;
  rateBuckets.set(key, existing);
  return { allowed: true };
};

const ensureAuthorized = (req: Request): NextResponse | null => {
  const requiredToken = process.env.KEEPA_PROXY_TOKEN;
  if (!requiredToken) return null;

  const token = req.headers.get("x-keepa-proxy-token");
  if (token !== requiredToken) {
    return NextResponse.json(
      { error: "Unauthorized Keepa proxy request" },
      { status: 401 },
    );
  }

  return null;
};

const ensureValidPayloadSize = (asins: string[], codes: string[]): NextResponse | null => {
  if (asins.length > MAX_LOOKUP_VALUES || codes.length > MAX_LOOKUP_VALUES) {
    return NextResponse.json(
      {
        error: `Request exceeds per-field limit (${MAX_LOOKUP_VALUES})`,
      },
      { status: 413 },
    );
  }

  if (asins.length + codes.length > MAX_REQUEST_VALUES) {
    return NextResponse.json(
      {
        error: `Request exceeds total lookup limit (${MAX_REQUEST_VALUES})`,
      },
      { status: 413 },
    );
  }

  return null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isCircuitOpen = () => Date.now() < circuitState.openUntil;

const markCircuitFailure = () => {
  circuitState.failures += 1;
  if (circuitState.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitState.openUntil = Date.now() + CIRCUIT_OPEN_MS;
  }
};

const markCircuitSuccess = () => {
  circuitState.failures = 0;
  circuitState.openUntil = 0;
};

const fetchKeepaWithRetry = async (url: string): Promise<Response> => {
  if (isCircuitOpen()) {
    throw new Error("Keepa upstream is temporarily unavailable (circuit breaker open)");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        markCircuitSuccess();
        return response;
      }

      const body = await response.text();
      const trimmed = body.slice(0, 200);
      throw new Error(`Keepa API request failed (${response.status}): ${trimmed}`);
    } catch (error: unknown) {
      clearTimeout(timeout);
      const normalized =
        error instanceof Error ? error : new Error("Unknown Keepa upstream error");
      lastError = normalized;
      markCircuitFailure();

      if (attempt < RETRY_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS * (attempt + 1));
      }
    }
  }

  throw lastError ?? new Error("Keepa upstream request failed");
};

const chunkArray = <T,>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
};

const fetchKeepaSingleBatch = async (
  apiKey: string,
  field: "asin" | "code",
  values: string[],
  marketplace: Marketplace,
): Promise<KeepaLookupResult> => {
  if (values.length === 0) {
    return {
      products: [],
      tokenMeta: {
        tokensLeft: null,
        refillIn: null,
        refillRate: null,
        timestamp: null,
      },
      apiCalls: 0,
    };
  }

  const config = getMarketplaceConfig(marketplace);
  const params = new URLSearchParams({
    key: apiKey,
    domain: String(config.keepaDomain),
    stats: "180",
    offers: "20",
  });
  params.set(field, values.join(","));
  const keepaUrl = `https://api.keepa.com/product?${params.toString()}`;
  const response = await fetchKeepaWithRetry(keepaUrl);

  const text = await response.text();
  if (!text) {
    throw new Error("Empty response from Keepa");
  }

  const data = JSON.parse(text) as KeepaApiResponse;
  return {
    products: data.products ?? [],
    tokenMeta: {
      tokensLeft: typeof data.tokensLeft === "number" ? data.tokensLeft : null,
      refillIn: typeof data.refillIn === "number" ? data.refillIn : null,
      refillRate: typeof data.refillRate === "number" ? data.refillRate : null,
      timestamp: typeof data.timestamp === "number" ? data.timestamp : null,
    },
    apiCalls: 1,
  };
};

const fetchKeepaByField = async (
  apiKey: string,
  field: "asin" | "code",
  values: string[],
  marketplace: Marketplace,
): Promise<KeepaLookupResult> => {
  const uniqueValues = Array.from(new Set(values));
  const chunks = chunkArray(uniqueValues, 100);
  const allProducts: KeepaProductResult[] = [];
  let latestTokenMeta: KeepaTokenMeta = {
    tokensLeft: null,
    refillIn: null,
    refillRate: null,
    timestamp: null,
  };
  let apiCalls = 0;

  for (const chunk of chunks) {
    const result = await fetchKeepaSingleBatch(apiKey, field, chunk, marketplace);
    latestTokenMeta = result.tokenMeta;
    allProducts.push(...result.products);
    apiCalls += result.apiCalls;
  }

  return {
    products: allProducts,
    tokenMeta: latestTokenMeta,
    apiCalls,
  };
};

const normalizeCode = (value: unknown): string => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^[0-9]{8,14}$/.test(digits) ? digits : "";
};

const extractProductCodes = (product: KeepaProductResult): string[] => {
  const candidates = [
    ...(product.eanList ?? []),
    ...(product.upcList ?? []),
    product.ean,
    product.upc,
    product.gtin,
  ];
  const codes = new Set<string>();
  for (const candidate of candidates) {
    const code = normalizeCode(candidate);
    if (code) codes.add(code);
  }
  return Array.from(codes);
};

const fetchKeepaByCodes = async (
  apiKey: string,
  codes: string[],
  marketplace: Marketplace,
) => {
  if (codes.length === 0) {
    return {
      products: [],
      tokenMeta: {
        tokensLeft: null,
        refillIn: null,
        refillRate: null,
        timestamp: null,
      },
      apiCalls: 0,
    };
  }

  const products: KeepaProductResult[] = [];
  let latestMeta: KeepaTokenMeta = {
    tokensLeft: null,
    refillIn: null,
    refillRate: null,
    timestamp: null,
  };
  let apiCalls = 0;

  const batch = await fetchKeepaByField(apiKey, "code", codes, marketplace);
  latestMeta = batch.tokenMeta;
  apiCalls += batch.apiCalls;

  const requested = new Set(codes);
  const matched = new Set<string>();

  for (const product of batch.products) {
    const productCodes = extractProductCodes(product).filter((code) =>
      requested.has(code),
    );
    if (productCodes.length === 0) continue;
    for (const code of productCodes) {
      matched.add(code);
      products.push({ ...product, matchedCode: code });
    }
  }

  const unresolved = codes.filter((code) => !matched.has(code));
  const batchSize = 10;

  for (let i = 0; i < unresolved.length; i += batchSize) {
    const chunk = unresolved.slice(i, i + batchSize);
    const chunkResults = await Promise.all(
      chunk.map((code) => fetchKeepaByField(apiKey, "code", [code], marketplace)),
    );

    for (let idx = 0; idx < chunk.length; idx += 1) {
      const code = chunk[idx];
      const result = chunkResults[idx];
      latestMeta = result.tokenMeta;
      apiCalls += result.apiCalls;
      for (const product of result.products) {
        products.push({ ...product, matchedCode: code });
      }
    }
  }

  return {
    products,
    tokenMeta: latestMeta,
    apiCalls,
  };
};

const isTokenGuardBlocked = (
  marketplace: Marketplace,
  tokenGuard: TokenGuardConfig,
): boolean => {
  if (tokenGuard.mode !== "hard_stop") return false;
  if (tokenGuard.hardLimit <= 0) return false;

  const snapshot = lastTokenSnapshot.get(marketplace);
  if (!snapshot) return false;

  const asinBlocked =
    typeof snapshot.asin === "number" && snapshot.asin <= tokenGuard.hardLimit;
  const codeBlocked =
    typeof snapshot.code === "number" && snapshot.code <= tokenGuard.hardLimit;

  return asinBlocked || codeBlocked;
};

const fetchKeepa = async (
  asins: string[],
  codes: string[],
  context: RequestContext,
) => {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const requestId = crypto.randomUUID();
  const apiKey = process.env.KEEPA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing KEEPA_API_KEY in .env.local" },
      { status: 500 },
    );
  }

  if (isTokenGuardBlocked(context.marketplace, context.tokenGuard)) {
    const requestCost: KeepaRequestCostMeta = {
      requestId,
      marketplace: context.marketplace,
      requestedAsins: asins.length,
      requestedCodes: codes.length,
      apiCalls: 0,
      durationMs: Date.now() - started,
      startedAt,
      blockedByGuard: true,
    };

    return NextResponse.json(
      {
        error: "Token guard blocked live lookup before request execution",
        keepaMeta: { requestCost },
      },
      { status: 429 },
    );
  }

  try {
    const [asinResult, codeResult] = await Promise.all([
      fetchKeepaByField(apiKey, "asin", asins, context.marketplace),
      fetchKeepaByCodes(apiKey, codes, context.marketplace),
    ]);

    const merged = [...asinResult.products, ...codeResult.products].filter(
      (product) => !!product.asin,
    );
    const deduped = new Map<string, KeepaProductResult>();
    for (const product of merged) {
      const asinKey = product.asin?.trim().toUpperCase() ?? "";
      const codeKey = product.matchedCode ?? "";
      const key = `${asinKey}|${codeKey}`;
      if (!deduped.has(key)) deduped.set(key, product);
    }

    lastTokenSnapshot.set(context.marketplace, {
      asin: asinResult.tokenMeta.tokensLeft,
      code: codeResult.tokenMeta.tokensLeft,
    });

    const requestCost: KeepaRequestCostMeta = {
      requestId,
      marketplace: context.marketplace,
      requestedAsins: asins.length,
      requestedCodes: codes.length,
      apiCalls: asinResult.apiCalls + codeResult.apiCalls,
      durationMs: Date.now() - started,
      startedAt,
      blockedByGuard: false,
    };

    return NextResponse.json({
      products: Array.from(deduped.values()),
      keepaMeta: {
        asinLookup: asinResult.tokenMeta,
        codeLookup: codeResult.tokenMeta,
        requestCost,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Keepa API request failed";

    const requestCost: KeepaRequestCostMeta = {
      requestId,
      marketplace: context.marketplace,
      requestedAsins: asins.length,
      requestedCodes: codes.length,
      apiCalls: 0,
      durationMs: Date.now() - started,
      startedAt,
      blockedByGuard: false,
    };

    return NextResponse.json(
      { error: message, keepaMeta: { requestCost } },
      { status: 500 },
    );
  }
};

const parseGetContext = (req: Request): RequestContext => {
  const { searchParams } = new URL(req.url);
  return normalizeRequestContext({
    marketplace: searchParams.get("marketplace"),
    tokenGuard: {
      mode: searchParams.get("tokenMode"),
      hardLimit: searchParams.get("tokenHardLimit"),
    },
  });
};

export async function POST(req: Request) {
  const authError = ensureAuthorized(req);
  if (authError) return authError;

  const rateLimit = enforceRateLimit(req);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests to Keepa proxy. Please retry shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfter),
        },
      },
    );
  }

  try {
    const body = (await req.json()) as KeepaRequestBody;
    const asins = normalizeAsins(body.asins);
    const codes = normalizeCodes(body.codes);
    const context = normalizeRequestContext({
      marketplace: body.marketplace,
      tokenGuard: body.tokenGuard,
    });

    const payloadError = ensureValidPayloadSize(asins, codes);
    if (payloadError) return payloadError;

    if (asins.length === 0 && codes.length === 0) {
      return NextResponse.json(
        { error: "Invalid ASIN or barcode input" },
        { status: 400 },
      );
    }

    return await fetchKeepa(asins, codes, context);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const authError = ensureAuthorized(req);
  if (authError) return authError;

  const rateLimit = enforceRateLimit(req);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests to Keepa proxy. Please retry shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfter),
        },
      },
    );
  }

  try {
    const asins = getAsinsFromQuery(req);
    const codes = getCodesFromQuery(req);
    const context = parseGetContext(req);

    const payloadError = ensureValidPayloadSize(asins, codes);
    if (payloadError) return payloadError;

    if (asins.length === 0 && codes.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid asin/code query parameter" },
        { status: 400 },
      );
    }

    return await fetchKeepa(asins, codes, context);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
