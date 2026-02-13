import { promises as fs } from "fs";
import path from "path";
import type {
  Product,
  ScanCompareResult,
  ScanHistoryRecord,
  ScanRunSummary,
} from "@/lib/scan-types";

const DATA_DIR = path.join(process.cwd(), ".data");
const HISTORY_FILE = path.join(DATA_DIR, "scan-history.json");
const MAX_HISTORY_RECORDS = 250;

const safeNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const averageBy = (rows: Product[], key: "roi" | "profit"): number => {
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, row) => sum + safeNumber(row[key]), 0);
  return total / rows.length;
};

const ensureDataFile = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(HISTORY_FILE);
  } catch {
    await fs.writeFile(HISTORY_FILE, "[]", "utf8");
  }
};

export const readScanHistory = async (): Promise<ScanHistoryRecord[]> => {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is ScanHistoryRecord => {
      return (
        Boolean(record) &&
        typeof record === "object" &&
        typeof (record as ScanHistoryRecord).id === "string" &&
        typeof (record as ScanHistoryRecord).createdAt === "string" &&
        typeof (record as ScanHistoryRecord).updatedAt === "string" &&
        Boolean((record as ScanHistoryRecord).summary) &&
        Array.isArray((record as ScanHistoryRecord).products)
      );
    });
  } catch {
    return [];
  }
};

const writeScanHistory = async (records: ScanHistoryRecord[]) => {
  await ensureDataFile();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(records, null, 2), "utf8");
};

export const upsertScanHistoryRecord = async (input: {
  id?: string;
  summary: ScanRunSummary;
  products: Product[];
}): Promise<ScanHistoryRecord> => {
  const now = new Date().toISOString();
  const records = await readScanHistory();
  const existingIdx = input.id
    ? records.findIndex((record) => record.id === input.id)
    : -1;

  const id = input.id ?? input.summary.id;

  const nextRecord: ScanHistoryRecord = {
    id,
    createdAt:
      existingIdx >= 0 ? records[existingIdx].createdAt : input.summary.createdAt || now,
    updatedAt: now,
    summary: input.summary,
    products: input.products,
  };

  let next: ScanHistoryRecord[];
  if (existingIdx >= 0) {
    next = [...records];
    next[existingIdx] = nextRecord;
  } else {
    next = [nextRecord, ...records];
  }

  const trimmed = next
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, MAX_HISTORY_RECORDS);

  await writeScanHistory(trimmed);
  return nextRecord;
};

export const getScanHistoryRecord = async (
  id: string,
): Promise<ScanHistoryRecord | null> => {
  const records = await readScanHistory();
  return records.find((record) => record.id === id) ?? null;
};

export const compareScanHistoryRecords = (
  base: ScanHistoryRecord,
  target: ScanHistoryRecord,
): ScanCompareResult => {
  const baseAvgRoi = averageBy(base.products, "roi");
  const baseAvgProfit = averageBy(base.products, "profit");
  const targetAvgRoi = averageBy(target.products, "roi");
  const targetAvgProfit = averageBy(target.products, "profit");

  return {
    baseScanId: base.id,
    targetScanId: target.id,
    deltaTotalRows: target.summary.totalRows - base.summary.totalRows,
    deltaQualifiedRows: target.summary.qualifiedRows - base.summary.qualifiedRows,
    deltaAverageRoi: Number((targetAvgRoi - baseAvgRoi).toFixed(2)),
    deltaAverageProfit: Number((targetAvgProfit - baseAvgProfit).toFixed(2)),
  };
};
