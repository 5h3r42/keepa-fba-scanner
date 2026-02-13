import { NextResponse } from "next/server";
import {
  getScanHistoryRecord,
  upsertScanHistoryRecord,
} from "@/lib/scan-history-store";
import type { ScanRunSummary } from "@/lib/scan-types";

type UpdateBody = {
  tags?: unknown;
  notes?: unknown;
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  const scan = await getScanHistoryRecord(params.id);

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  return NextResponse.json({ scan });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  const existing = await getScanHistoryRecord(params.id);

  if (!existing) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  try {
    const body = (await req.json()) as UpdateBody;
    const tags = normalizeTags(body.tags);
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : existing.summary.notes;

    const summary: ScanRunSummary = {
      ...existing.summary,
      tags,
      notes,
    };

    const updated = await upsertScanHistoryRecord({
      id: existing.id,
      summary,
      products: existing.products,
    });

    return NextResponse.json({ scan: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update scan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
