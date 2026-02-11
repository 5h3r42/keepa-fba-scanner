import { NextResponse } from "next/server";

type KeepaRequestBody = {
  asins?: unknown;
};

const normalizeAsins = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  return input
    .filter((asin): asin is string => typeof asin === "string")
    .map((asin) => asin.trim().toUpperCase())
    .filter((asin) => /^[A-Z0-9]{10}$/.test(asin));
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

const fetchKeepa = async (asins: string[]) => {
  const apiKey = process.env.KEEPA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing KEEPA_API_KEY in .env.local" },
      { status: 500 },
    );
  }

  const domain = 2; // UK marketplace

  const params = new URLSearchParams({
    key: apiKey,
    domain: String(domain),
    asin: asins.join(","),
    stats: "180",
    offers: "20",
  });
  const keepaUrl = `https://api.keepa.com/product?${params.toString()}`;

  const response = await fetch(keepaUrl);

  if (!response.ok) {
    return NextResponse.json(
      { error: "Keepa API request failed" },
      { status: 500 },
    );
  }

  const text = await response.text();

  if (!text) {
    return NextResponse.json(
      { error: "Empty response from Keepa" },
      { status: 500 },
    );
  }

  const data = JSON.parse(text);
  return NextResponse.json(data);
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as KeepaRequestBody;
    const asins = normalizeAsins(body.asins);
    if (asins.length === 0) {
      return NextResponse.json(
        { error: "Invalid ASIN input" },
        { status: 400 },
      );
    }
    return await fetchKeepa(asins);
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
    if (asins.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid asin query parameter" },
        { status: 400 },
      );
    }
    return await fetchKeepa(asins);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
