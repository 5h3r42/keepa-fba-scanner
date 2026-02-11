import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const apiKey = process.env.KEEPA_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 500 });
  }

  const asinParam = req.nextUrl.searchParams.get("asin");

  if (!asinParam) {
    return NextResponse.json({ error: "Missing ASIN" }, { status: 400 });
  }

  const asins = asinParam.split(",");

  try {
    const res = await fetch(
      `https://api.keepa.com/product?key=${apiKey}&domain=2&asin=${asins.join(",")}`,
    );

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Keepa request failed" },
      { status: 500 },
    );
  }
}
