import { NextResponse } from "next/server";

type KeepaRequestBody = {
  asins?: unknown;
  codes?: unknown;
};

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

type KeepaTokenMeta = {
  tokensLeft: number | null;
  refillIn: number | null;
  refillRate: number | null;
  timestamp: number | null;
};

type KeepaLookupResult = {
  products: KeepaProductResult[];
  tokenMeta: KeepaTokenMeta;
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
    };
  }

  const domain = 2; // UK marketplace
  const params = new URLSearchParams({
    key: apiKey,
    domain: String(domain),
    stats: "180",
    offers: "20",
  });
  params.set(field, values.join(","));
  const keepaUrl = `https://api.keepa.com/product?${params.toString()}`;
  const response = await fetch(keepaUrl);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Keepa API request failed (${response.status}): ${errorText.slice(0, 200)}`,
    );
  }

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
  };
};

const fetchKeepaByField = async (
  apiKey: string,
  field: "asin" | "code",
  values: string[],
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

  for (const chunk of chunks) {
    const result = await fetchKeepaSingleBatch(apiKey, field, chunk);
    latestTokenMeta = result.tokenMeta;
    allProducts.push(...result.products);
  }

  return {
    products: allProducts,
    tokenMeta: latestTokenMeta,
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

const fetchKeepaByCodes = async (apiKey: string, codes: string[]) => {
  if (codes.length === 0) {
    return {
      products: [],
      tokenMeta: {
        tokensLeft: null,
        refillIn: null,
        refillRate: null,
        timestamp: null,
      },
    };
  }

  const products: KeepaProductResult[] = [];
  let latestMeta: KeepaTokenMeta = {
    tokensLeft: null,
    refillIn: null,
    refillRate: null,
    timestamp: null,
  };

  // Fast path: one batched lookup for all codes.
  const batch = await fetchKeepaByField(apiKey, "code", codes);
  latestMeta = batch.tokenMeta;
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

  // Fallback path: only unresolved codes are looked up individually, in small parallel batches.
  const unresolved = codes.filter((code) => !matched.has(code));
  const batchSize = 10;
  for (let i = 0; i < unresolved.length; i += batchSize) {
    const chunk = unresolved.slice(i, i + batchSize);
    const chunkResults = await Promise.all(
      chunk.map((code) => fetchKeepaByField(apiKey, "code", [code])),
    );
    for (let idx = 0; idx < chunk.length; idx += 1) {
      const code = chunk[idx];
      const result = chunkResults[idx];
      latestMeta = result.tokenMeta;
      for (const product of result.products) {
        products.push({ ...product, matchedCode: code });
      }
    }
  }

  return {
    products,
    tokenMeta: latestMeta,
  };
};

const fetchKeepa = async (asins: string[], codes: string[]) => {
  const apiKey = process.env.KEEPA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing KEEPA_API_KEY in .env.local" },
      { status: 500 },
    );
  }

  try {
    const [asinResult, codeResult] = await Promise.all([
      fetchKeepaByField(apiKey, "asin", asins),
      fetchKeepaByCodes(apiKey, codes),
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

    return NextResponse.json({
      products: Array.from(deduped.values()),
      keepaMeta: {
        asinLookup: asinResult.tokenMeta,
        codeLookup: codeResult.tokenMeta,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Keepa API request failed";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as KeepaRequestBody;
    const asins = normalizeAsins(body.asins);
    const codes = normalizeCodes(body.codes);
    if (asins.length === 0 && codes.length === 0) {
      return NextResponse.json(
        { error: "Invalid ASIN or barcode input" },
        { status: 400 },
      );
    }
    return await fetchKeepa(asins, codes);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const asins = getAsinsFromQuery(req);
    const codes = getCodesFromQuery(req);
    if (asins.length === 0 && codes.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid asin/code query parameter" },
        { status: 400 },
      );
    }
    return await fetchKeepa(asins, codes);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
