import * as XLSX from "xlsx";
import type { KeepaProduct } from "@/lib/scan-types";

export type SheetRow = Record<string, string | number | null | undefined>;

export type SupplierRowNormalized = {
  id: string;
  productTitle: string;
  barcodeRaw: string;
  barcodeCanonical: string;
  asin: string;
  cost: number;
  rowData: SheetRow;
};

export type KeepaCsvRowNormalized = {
  asin: string;
  eanCanonical: string[];
  sellPrice: number;
  buyBox90dAvg: number;
  bsr: number;
  bsrDrops90d: number;
  newOfferCountCurrent: number;
  amazonInStockPercent90d: number;
  fbaPickPackFee: number;
  referralFeeBasedOnCurrentBuyBox: number;
  referralFeePercent: number;
  buyBoxCurrent: number;
  title: string;
};

export type KeepaLiveEnriched = {
  asin: string;
  sellPrice: number;
  bsr: number;
  title: string;
};

const PRODUCT_KEYS = [
  "product",
  "productname",
  "title",
  "name",
  "itemname",
  "description",
];
const ASIN_KEYS = ["asin"];
const BARCODE_KEYS = ["barcode", "ean", "upc", "gtin", "barcodeean", "productcode"];
const COST_KEYS = [
  "cost",
  "costprice",
  "pieceprice",
  "piecepricegbp",
  "suppliercost",
  "buyprice",
  "costexvat",
  "buycost",
  "purchaseprice",
  "unitcost",
];

export const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeRow = (row: SheetRow): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeKey(key)] = value;
  }
  return normalized;
};

const normalizeHeaderLabel = (label: string): string =>
  label
    .toLowerCase()
    .replace(/£/g, "gbp")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeDigits = (value: unknown): string =>
  String(value ?? "").replace(/\D/g, "");

export const isValidAsin = (value: string): boolean => /^[A-Z0-9]{10}$/.test(value);

export const normalizeBarcode = (value: unknown): string => {
  const digits = normalizeDigits(value);
  return /^[0-9]{8,14}$/.test(digits) ? digits : "";
};

export const barcodeVariants = (code: string): string[] => {
  const c = normalizeBarcode(code);
  if (!c) return [];
  const variants = new Set<string>([c]);
  if (c.length === 12) variants.add(`0${c}`);
  if (c.length === 13 && c.startsWith("0")) variants.add(c.slice(1));
  return Array.from(variants);
};

const parseCurrencyLike = (value: unknown): number => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
};

const parsePercentLike = (value: unknown): number | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
};

const findString = (row: SheetRow, keys: string[]): string => {
  const normalized = normalizeRow(row);
  for (const key of keys) {
    const value = normalized[normalizeKey(key)];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const findNumber = (row: SheetRow, keys: string[]): number => {
  const normalized = normalizeRow(row);
  for (const key of keys) {
    const value = normalized[normalizeKey(key)];
    const num = parseCurrencyLike(value);
    if (num > 0) return num;
  }
  return 0;
};

const isSupplierSeparatorRow = (values: string[]): boolean => {
  const trimmed = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (trimmed.length < 3) return false;
  return new Set(trimmed).size === 1;
};

const parseSupplierSheetRows = (sheet: XLSX.WorkSheet): SheetRow[] => {
  const direct = XLSX.utils.sheet_to_json<SheetRow>(sheet, {
    defval: "",
    raw: false,
  });
  const directKeys = Object.keys(direct[0] ?? {});
  const looksStructured =
    directKeys.length > 0 && !directKeys.every((key) => key.startsWith("__EMPTY"));
  if (looksStructured) return direct;

  const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (matrix.length === 0) return [];

  const headerRowIndex = matrix.findIndex((row) => {
    const labels = row.map((cell) => String(cell ?? "").toUpperCase());
    return (
      labels.includes("DESCRIPTION") &&
      labels.some((label) => label.includes("PIECE PRICE")) &&
      labels.some((label) => label.includes("PRODUCT CODE") || label.includes("BARCODE"))
    );
  });
  if (headerRowIndex < 0) return direct;

  const rawHeaders = matrix[headerRowIndex].map((cell) => String(cell ?? "").trim());
  const headers = rawHeaders.map((cell, index) =>
    normalizeHeaderLabel(cell) || `column_${index + 1}`,
  );

  const parsed: SheetRow[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i];
    const values = row.map((cell) => String(cell ?? "").trim());
    if (values.every((value) => !value)) continue;
    if (isSupplierSeparatorRow(values)) continue;

    const item: SheetRow = {};
    headers.forEach((header, colIndex) => {
      item[header] = row[colIndex] ?? "";
    });
    parsed.push(item);
  }

  return parsed;
};

export const parseSupplierRows = (sheet: XLSX.WorkSheet): SupplierRowNormalized[] => {
  const rows = parseSupplierSheetRows(sheet);
  return rows.map((row, idx) => {
    const productTitle = findString(row, PRODUCT_KEYS) || "Untitled";
    const asin = findString(row, ASIN_KEYS).toUpperCase();
    const barcodeRaw = findString(row, BARCODE_KEYS);
    const barcodeCanonical = normalizeBarcode(barcodeRaw);
    const cost = findNumber(row, COST_KEYS);

    return {
      id: `supplier_${idx + 1}`,
      productTitle,
      asin,
      barcodeRaw,
      barcodeCanonical,
      cost,
      rowData: row,
    };
  });
};

export const parseKeepaCsvRows = (sheet: XLSX.WorkSheet): KeepaCsvRowNormalized[] => {
  const rawRows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: "", raw: false });
  const out: KeepaCsvRowNormalized[] = [];

  for (const row of rawRows) {
    const norm = normalizeRow(row);
    const asin = String(norm[normalizeKey("ASIN")] ?? "").trim().toUpperCase();
    const title = String(norm[normalizeKey("Title")] ?? "").trim();
    const eanRaw = String(norm[normalizeKey("Product Codes: EAN")] ?? "").trim();
    const eanCanonical = eanRaw
      .split(/[;,|]/)
      .map((v) => normalizeBarcode(v))
      .filter(Boolean);

    const buyBoxCurrent = parseCurrencyLike(norm[normalizeKey("Buy Box 🚚: Current")]);
    const buyBox90dAvg = parseCurrencyLike(
      norm[normalizeKey("Buy Box 🚚: 90 days avg.")],
    );
    const sellPrice = buyBoxCurrent;
    const bsr = parseCurrencyLike(norm[normalizeKey("Sales Rank: Current")]);
    const bsrDrops90d = parseCurrencyLike(
      norm[normalizeKey("Sales Rank: Drops last 90 days")],
    );
    const newOfferCountCurrent = parseCurrencyLike(
      norm[normalizeKey("New Offer Count: Current")],
    );
    const amazon90dOos = parsePercentLike(norm[normalizeKey("Amazon: 90 days OOS")]);
    const amazonInStockPercent90d =
      amazon90dOos === null ? 0 : Math.max(0, Math.min(100, 100 - amazon90dOos));

    const fbaPickPackFee = parseCurrencyLike(norm[normalizeKey("FBA Pick&Pack Fee")]);
    const referralFeeBasedOnCurrentBuyBox = parseCurrencyLike(
      norm[normalizeKey("Referral Fee based on current Buy Box price")],
    );
    const referralFeePercent =
      parsePercentLike(norm[normalizeKey("Referral Fee %")]) ?? 0;

    if (!asin && eanCanonical.length === 0) continue;

    out.push({
      asin,
      title,
      eanCanonical,
      buyBoxCurrent,
      sellPrice,
      buyBox90dAvg,
      bsr,
      bsrDrops90d,
      newOfferCountCurrent,
      amazonInStockPercent90d,
      fbaPickPackFee,
      referralFeeBasedOnCurrentBuyBox,
      referralFeePercent,
    });
  }

  return out;
};

export const buildKeepaCsvIndex = (rows: KeepaCsvRowNormalized[]) => {
  const keepaByAsin: Record<string, KeepaCsvRowNormalized> = {};
  const keepaByBarcode: Record<string, KeepaCsvRowNormalized> = {};

  for (const row of rows) {
    if (row.asin) keepaByAsin[row.asin] = row;
    for (const ean of row.eanCanonical) {
      for (const variant of barcodeVariants(ean)) {
        if (!keepaByBarcode[variant]) keepaByBarcode[variant] = row;
      }
    }
  }

  return { keepaByAsin, keepaByBarcode };
};

export const extractSellPrice = (product: KeepaProduct): number => {
  if (typeof product.buyBoxPrice === "number" && product.buyBoxPrice > 0) {
    return product.buyBoxPrice / 100;
  }

  const candidates = product.stats?.current;
  if (!candidates || !Array.isArray(candidates)) return 0;

  const preferredIndexes = [18, 1, 7, 0, 10, 3, 8];
  for (const index of preferredIndexes) {
    const value = candidates[index];
    if (typeof value === "number" && value > 0) {
      return value / 100;
    }
  }

  return 0;
};

export const extractBsr = (product: KeepaProduct): number => {
  const currentSalesRank = product.stats?.current?.[3];
  if (typeof currentSalesRank === "number" && currentSalesRank > 0) {
    return Math.round(currentSalesRank);
  }

  const salesRanks = product.salesRanks;
  if (!salesRanks) return 0;

  const latestRanks = Object.values(salesRanks)
    .map((series) => {
      const valid = series.filter((rank) => typeof rank === "number" && rank > 0);
      return valid.length > 0 ? valid[valid.length - 1] : 0;
    })
    .filter((rank) => rank > 0);

  if (latestRanks.length === 0) return 0;
  return Math.min(...latestRanks);
};

export const extractLiveCodes = (product: KeepaProduct): string[] => {
  const codeCandidates = [
    ...(product.eanList ?? []),
    ...(product.upcList ?? []),
    product.ean,
    product.upc,
    product.gtin,
    product.matchedCode,
  ];
  const uniqueCodes = new Set<string>();
  for (const candidate of codeCandidates) {
    const normalized = normalizeBarcode(candidate);
    if (normalized) uniqueCodes.add(normalized);
  }
  return Array.from(uniqueCodes);
};

export const parseWorkbookFromFile = async (file: File) => {
  const isCsv = file.name.toLowerCase().endsWith(".csv");
  return isCsv
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
};

export const getDuplicateRows = (values: string[]): number => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let duplicateRows = 0;
  counts.forEach((count) => {
    if (count > 1) duplicateRows += count;
  });

  return duplicateRows;
};

export type BarcodeListParseResult = {
  validCodes: string[];
  invalidTokens: string[];
  duplicatesRemoved: number;
  rawCount: number;
};

export const parseBarcodeListText = (input: string): BarcodeListParseResult => {
  const tokens = input
    .split(/[\s,;]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

  const validCodes: string[] = [];
  const invalidTokens: string[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const token of tokens) {
    const normalized = normalizeBarcode(token);
    if (!normalized) {
      invalidTokens.push(token);
      continue;
    }

    if (seen.has(normalized)) {
      duplicatesRemoved += 1;
      continue;
    }

    seen.add(normalized);
    validCodes.push(normalized);
  }

  return {
    validCodes,
    invalidTokens,
    duplicatesRemoved,
    rawCount: tokens.length,
  };
};

export const parseBarcodeListFile = async (
  file: File,
): Promise<BarcodeListParseResult> => {
  const text = await file.text();
  return parseBarcodeListText(text);
};
