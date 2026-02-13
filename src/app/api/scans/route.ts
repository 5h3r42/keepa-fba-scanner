import { NextResponse } from "next/server";
import {
  compareScanHistoryRecords,
  getScanHistoryRecord,
  readScanHistory,
  upsertScanHistoryRecord,
} from "@/lib/scan-history-store";
import type { Product, ScanRunSummary } from "@/lib/scan-types";

type SaveScanBody = {
  summary?: unknown;
  products?: unknown;
};

const isSummary = (value: unknown): value is ScanRunSummary => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.completedAt === "string" &&
    (v.scanInputMode === "supplier_file" ||
      v.scanInputMode === "barcode_list" ||
      v.scanInputMode === undefined) &&
    typeof v.marketplace === "string" &&
    typeof v.currency === "string" &&
    typeof v.totalRows === "number"
  );
};

const isProducts = (value: unknown): value is Product[] => {
  return Array.isArray(value);
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const compareParam = searchParams.get("compare");

  if (compareParam) {
    const ids = compareParam
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (ids.length !== 2) {
      return NextResponse.json(
        { error: "compare query must include exactly two scan IDs" },
        { status: 400 },
      );
    }

    const base = await getScanHistoryRecord(ids[0]);
    const target = await getScanHistoryRecord(ids[1]);

    if (!base || !target) {
      return NextResponse.json(
        { error: "One or both scan IDs do not exist" },
        { status: 404 },
      );
    }

    return NextResponse.json({ compare: compareScanHistoryRecords(base, target) });
  }

  const includeProducts = searchParams.get("includeProducts") === "1";
  const records = await readScanHistory();

  if (includeProducts) {
    return NextResponse.json({ scans: records });
  }

  return NextResponse.json({
    scans: records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      summary: record.summary,
    })),
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SaveScanBody;

    if (!isSummary(body.summary) || !isProducts(body.products)) {
      return NextResponse.json(
        { error: "Invalid scan payload" },
        { status: 400 },
      );
    }

    const saved = await upsertScanHistoryRecord({
      summary: body.summary,
      products: body.products,
    });

    return NextResponse.json({ scan: saved });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save scan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
