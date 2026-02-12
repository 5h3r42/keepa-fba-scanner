"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useDashboardSettings } from "@/lib/dashboard-settings";
import { DashboardSettingsPanel } from "@/components/dashboard-settings-panel";

type SheetRow = Record<string, string | number | null | undefined>;

type MatchSource =
  | "keepa_csv_asin"
  | "keepa_csv_barcode"
  | "live_keepa"
  | "unmatched";

type SupplierRowNormalized = {
  productTitle: string;
  barcodeRaw: string;
  barcodeCanonical: string;
  asin: string;
  cost: number;
  rowData: SheetRow;
};

type KeepaCsvRowNormalized = {
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

type KeepaProduct = {
  asin?: string;
  matchedCode?: string;
  title?: string;
  stats?: {
    current?: Array<number | null>;
  };
  salesRanks?: Record<string, number[]>;
  buyBoxPrice?: number;
  eanList?: Array<string | number>;
  upcList?: Array<string | number>;
  ean?: string | number;
  upc?: string | number;
  gtin?: string | number;
};

type KeepaResponse = {
  products?: KeepaProduct[];
  keepaMeta?: {
    asinLookup?: {
      tokensLeft: number | null;
      refillIn: number | null;
      refillRate: number | null;
      timestamp: number | null;
    };
    codeLookup?: {
      tokensLeft: number | null;
      refillIn: number | null;
      refillRate: number | null;
      timestamp: number | null;
    };
  };
  error?: {
    message?: string;
  };
};

type KeepaLiveEnriched = {
  asin: string;
  sellPrice: number;
  bsr: number;
  title: string;
};

type Product = {
  product: string;
  asin: string;
  barcode: string;
  bsr: number;
  bsrDrops90d: number;
  cost: number;
  sellPrice: number;
  buyBox90dAvg: number;
  newOfferCount: number;
  amazonInStockPercent: number;
  referralFee: number;
  fbaFee: number;
  maxBuyCost: number;
  profit: number;
  roi: number;
  matchesCriteria: boolean;
  matchSource: MatchSource;
  status: string;
};

type SortKey =
  | "product"
  | "barcode"
  | "asin"
  | "matchSource"
  | "status"
  | "bsr"
  | "bsrDrops90d"
  | "cost"
  | "sellPrice"
  | "buyBox90dAvg"
  | "newOfferCount"
  | "amazonInStockPercent"
  | "referralFee"
  | "fbaFee"
  | "maxBuyCost"
  | "profit"
  | "roi";

type SortConfig = {
  key: SortKey;
  direction: "asc" | "desc";
} | null;

type ColumnLayoutItem = {
  key: SortKey;
  visible: boolean;
};

type MatchSummary = {
  total: number;
  csvAsin: number;
  csvBarcode: number;
  live: number;
  unmatched: number;
  fallbackAttempted: number;
  fallbackCapped: number;
};

type ScanQueueProgress = {
  stage: "idle" | "preparing" | "processing" | "complete" | "error";
  totalCandidates: number;
  processedCandidates: number;
  totalBatches: number;
  completedBatches: number;
  matchedLive: number;
  message: string;
};

type SavedScan = {
  id: string;
  name: string;
  createdAt: string;
  modeLabel: string;
  products: Product[];
  matchSummary: MatchSummary | null;
};

const SAVED_SCANS_STORAGE_KEY = "keepa-saved-scans-v1";
const CURRENT_SCAN_STORAGE_KEY = "keepa-current-scan-v1";
const COLUMN_LAYOUT_STORAGE_KEY = "keepa-column-layout-v1";
const MAX_SAVED_SCANS = 10;
const MAX_SAVED_SCAN_ROWS = 1000;
const LIVE_FALLBACK_BATCH_SIZE = 100;

const DEFAULT_COLUMN_LAYOUT: ColumnLayoutItem[] = [
  { key: "product", visible: true },
  { key: "barcode", visible: true },
  { key: "asin", visible: true },
  { key: "matchSource", visible: true },
  { key: "status", visible: true },
  { key: "bsr", visible: true },
  { key: "bsrDrops90d", visible: true },
  { key: "cost", visible: true },
  { key: "sellPrice", visible: true },
  { key: "buyBox90dAvg", visible: true },
  { key: "newOfferCount", visible: true },
  { key: "amazonInStockPercent", visible: true },
  { key: "referralFee", visible: true },
  { key: "fbaFee", visible: true },
  { key: "maxBuyCost", visible: true },
  { key: "profit", visible: true },
  { key: "roi", visible: true },
];

const COLUMN_LABELS: Record<SortKey, string> = {
  product: "Product",
  barcode: "Barcode",
  asin: "ASIN",
  matchSource: "Match Source",
  status: "Status",
  bsr: "BSR",
  bsrDrops90d: "BSR Drops 90d",
  cost: "Cost",
  sellPrice: "Sell Price",
  buyBox90dAvg: "Buy Box 90d Avg",
  newOfferCount: "New Offers",
  amazonInStockPercent: "Amazon In Stock %",
  referralFee: "Referral Fee",
  fbaFee: "FBA Fee",
  maxBuyCost: "Max Buy Cost",
  profit: "Profit",
  roi: "ROI",
};

const COLUMN_WIDTHS: Record<SortKey, string> = {
  product: "w-[20%]",
  barcode: "w-[9%]",
  asin: "w-[8%]",
  matchSource: "w-[10%]",
  status: "w-[11%]",
  bsr: "w-[5%]",
  bsrDrops90d: "w-[6%]",
  cost: "w-[5%]",
  sellPrice: "w-[6%]",
  buyBox90dAvg: "w-[6%]",
  newOfferCount: "w-[6%]",
  amazonInStockPercent: "w-[6%]",
  referralFee: "w-[6%]",
  fbaFee: "w-[5%]",
  maxBuyCost: "w-[6%]",
  profit: "w-[5%]",
  roi: "w-[5%]",
};

type CurrentScanSnapshot = {
  products: Product[];
  matchSummary: MatchSummary | null;
  keepaMetaText: string;
  keepaCsvStatus: string;
  supplierFileName: string;
  keepaExportFileName: string;
  lastRunModeLabel: string;
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
const BARCODE_KEYS = ["barcode", "ean", "upc", "gtin", "barcodeean"];
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

const normalizeKey = (key: string): string =>
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

const normalizeBarcode = (value: unknown): string => {
  const digits = normalizeDigits(value);
  return /^[0-9]{8,14}$/.test(digits) ? digits : "";
};

const barcodeVariants = (code: string): string[] => {
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

const parsePercentLike = (value: unknown): number => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
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
      labels.includes("PRODUCT CODE")
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

const parseSupplierRows = (sheet: XLSX.WorkSheet): SupplierRowNormalized[] => {
  const rows = parseSupplierSheetRows(sheet);
  return rows.map((row) => {
    const productTitle = findString(row, PRODUCT_KEYS) || "Untitled";
    const asin = findString(row, ASIN_KEYS).toUpperCase();
    const barcodeRaw = findString(row, BARCODE_KEYS);
    const barcodeCanonical = normalizeBarcode(barcodeRaw);
    const cost = findNumber(row, COST_KEYS);

    return {
      productTitle,
      asin,
      barcodeRaw,
      barcodeCanonical,
      cost,
      rowData: row,
    };
  });
};

const parseKeepaCsvRows = (sheet: XLSX.WorkSheet): KeepaCsvRowNormalized[] => {
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
      amazon90dOos > 0 ? Math.max(0, 100 - amazon90dOos) : 0;
    const fbaPickPackFee = parseCurrencyLike(norm[normalizeKey("FBA Pick&Pack Fee")]);
    const referralFeeBasedOnCurrentBuyBox = parseCurrencyLike(
      norm[normalizeKey("Referral Fee based on current Buy Box price")],
    );
    const referralFeePercent = parsePercentLike(norm[normalizeKey("Referral Fee %")]);

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

const buildKeepaCsvIndex = (rows: KeepaCsvRowNormalized[]) => {
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

const extractSellPrice = (product: KeepaProduct): number => {
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

const extractBsr = (product: KeepaProduct): number => {
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

const extractLiveCodes = (product: KeepaProduct): string[] => {
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

const parseWorkbookFromFile = async (file: File) => {
  const isCsv = file.name.toLowerCase().endsWith(".csv");
  return isCsv
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
};

const compactProductForSave = (product: Product): Product => ({
  ...product,
  product: product.product.slice(0, 180),
  status: product.status.slice(0, 80),
});

const compactProductsForSave = (items: Product[]): Product[] =>
  items.slice(0, MAX_SAVED_SCAN_ROWS).map(compactProductForSave);

const makeSafeFileName = (value: string): string =>
  value
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

export default function Page() {
  const {
    settings,
    activeView,
    setActiveView,
    scanModalOpen,
    setScanModalOpen,
    saveScanSignal,
  } =
    useDashboardSettings();

  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [keepaExportFile, setKeepaExportFile] = useState<File | null>(null);
  const [supplierFileName, setSupplierFileName] = useState("");
  const [keepaExportFileName, setKeepaExportFileName] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
  const [keepaMetaText, setKeepaMetaText] = useState("");
  const [keepaCsvStatus, setKeepaCsvStatus] = useState("");
  const [keepaCsvParsing, setKeepaCsvParsing] = useState(false);
  const [scanProgressText, setScanProgressText] = useState("");
  const [lastRunModeLabel, setLastRunModeLabel] = useState("");
  const [savedScans, setSavedScans] = useState<SavedScan[]>([]);
  const [saveNotice, setSaveNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [queueProgress, setQueueProgress] = useState<ScanQueueProgress>({
    stage: "idle",
    totalCandidates: 0,
    processedCandidates: 0,
    totalBatches: 0,
    completedBatches: 0,
    matchedLive: 0,
    message: "",
  });
  const [error, setError] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [columnLayout, setColumnLayout] =
    useState<ColumnLayoutItem[]>(DEFAULT_COLUMN_LAYOUT);
  const [columnManagerOpen, setColumnManagerOpen] = useState(false);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [scanStateLoaded, setScanStateLoaded] = useState(false);
  const lastHandledSaveSignalRef = useRef(0);
  const actionButtonClass =
    "inline-flex h-14 items-center rounded-xl border border-zinc-700 bg-zinc-900 px-8 text-[15px] font-medium text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500";
  const compactActionButtonClass =
    "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 transition hover:bg-zinc-800";

  const formatCurrency = (value: number) => `£${value.toFixed(2)}`;

  const modeLabel = keepaExportFile
    ? "CSV-first + live fallback queue"
    : "Live-only (no Keepa CSV provided)";
  const displayModeLabel =
    !keepaExportFile && products.length > 0 && lastRunModeLabel
      ? lastRunModeLabel
      : modeLabel;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_SCANS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedScan[];
      if (Array.isArray(parsed)) {
        setSavedScans(parsed);
      }
    } catch {
      // Ignore malformed saved scan storage.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMN_LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ColumnLayoutItem[];
      if (!Array.isArray(parsed)) return;

      const defaultKeys = new Set(DEFAULT_COLUMN_LAYOUT.map((item) => item.key));
      const validItems = parsed.filter(
        (item): item is ColumnLayoutItem =>
          Boolean(item) &&
          typeof item.key === "string" &&
          defaultKeys.has(item.key as SortKey) &&
          typeof item.visible === "boolean",
      );
      if (validItems.length === 0) return;

      const seen = new Set<SortKey>();
      const normalized: ColumnLayoutItem[] = [];
      for (const item of validItems) {
        const key = item.key as SortKey;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push({ key, visible: item.visible });
      }

      for (const fallback of DEFAULT_COLUMN_LAYOUT) {
        if (!seen.has(fallback.key)) {
          normalized.push(fallback);
        }
      }

      setColumnLayout(normalized);
    } catch {
      // Ignore malformed column layout storage.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(COLUMN_LAYOUT_STORAGE_KEY, JSON.stringify(columnLayout));
  }, [columnLayout]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CURRENT_SCAN_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<CurrentScanSnapshot>;
      if (Array.isArray(parsed.products)) {
        setProducts(parsed.products as Product[]);
      }
      if (parsed.matchSummary) {
        setMatchSummary(parsed.matchSummary as MatchSummary);
      }
      if (typeof parsed.keepaMetaText === "string") {
        setKeepaMetaText(parsed.keepaMetaText);
      }
      if (typeof parsed.keepaCsvStatus === "string") {
        setKeepaCsvStatus(parsed.keepaCsvStatus);
      }
      if (typeof parsed.supplierFileName === "string") {
        setSupplierFileName(parsed.supplierFileName);
      }
      if (typeof parsed.keepaExportFileName === "string") {
        setKeepaExportFileName(parsed.keepaExportFileName);
      }
      if (typeof parsed.lastRunModeLabel === "string") {
        setLastRunModeLabel(parsed.lastRunModeLabel);
      }
    } catch {
      // Ignore malformed scan snapshot storage.
    } finally {
      setScanStateLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!scanStateLoaded) return;

    const compactProducts = compactProductsForSave(products);
    const snapshot: CurrentScanSnapshot = {
      products: compactProducts,
      matchSummary,
      keepaMetaText,
      keepaCsvStatus,
      supplierFileName,
      keepaExportFileName,
      lastRunModeLabel,
    };

    try {
      localStorage.setItem(CURRENT_SCAN_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      try {
        localStorage.setItem(
          CURRENT_SCAN_STORAGE_KEY,
          JSON.stringify({ ...snapshot, products: compactProducts.slice(0, 200) }),
        );
      } catch {
        // Ignore storage quota failures.
      }
    }
  }, [
    scanStateLoaded,
    products,
    matchSummary,
    keepaMetaText,
    keepaCsvStatus,
    supplierFileName,
    keepaExportFileName,
    lastRunModeLabel,
  ]);

  const persistSavedScans = (next: SavedScan[]): boolean => {
    let candidate = [...next];
    while (candidate.length > 0) {
      try {
        localStorage.setItem(SAVED_SCANS_STORAGE_KEY, JSON.stringify(candidate));
        setSavedScans(candidate);
        return true;
      } catch {
        candidate = candidate.slice(0, -1);
      }
    }

    setSavedScans([]);
    return false;
  };

  const saveCurrentScan = useCallback(() => {
    if (products.length === 0) {
      setSaveNotice("No scan results to save yet.");
      return;
    }

    const scan: SavedScan = {
      id: `${Date.now()}`,
      name: `Scan ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      modeLabel,
      products: compactProductsForSave(products),
      matchSummary,
    };
    const next = [scan, ...savedScans].slice(0, MAX_SAVED_SCANS);
    const saved = persistSavedScans(next);
    setSaveNotice(
      saved
        ? `Saved: ${scan.name}${products.length > MAX_SAVED_SCAN_ROWS ? ` (first ${MAX_SAVED_SCAN_ROWS} rows)` : ""}`
        : "Could not save scan. Browser storage is full.",
    );
  }, [products, modeLabel, matchSummary, savedScans]);

  useEffect(() => {
    if (saveScanSignal === 0) return;
    if (lastHandledSaveSignalRef.current === saveScanSignal) return;
    lastHandledSaveSignalRef.current = saveScanSignal;
    saveCurrentScan();
  }, [saveScanSignal, saveCurrentScan]);

  const loadSavedScan = (scan: SavedScan) => {
    setProducts(scan.products);
    setMatchSummary(scan.matchSummary);
    setError("");
    setKeepaMetaText("");
    setSaveNotice(`Loaded: ${scan.name}`);
    setActiveView("dashboard");
  };

  const deleteSavedScan = (id: string) => {
    const next = savedScans.filter((scan) => scan.id !== id);
    persistSavedScans(next);
  };

  const downloadSavedScan = (scan: SavedScan) => {
    const rows = scan.products.map((p) => ({
      Product: p.product,
      Barcode: p.barcode,
      ASIN: p.asin,
      BSR: p.bsr || "",
      "BSR Drops 90d": p.bsrDrops90d || "",
      "Cost (GBP)": p.cost,
      "Sell Price (GBP)": p.sellPrice || "",
      "Buy Box 90d Avg (GBP)": p.buyBox90dAvg || "",
      "New Offers": p.newOfferCount || "",
      "Amazon In Stock %": p.amazonInStockPercent || "",
      "Referral Fee (GBP)": p.referralFee || "",
      "FBA Fee (GBP)": p.fbaFee || "",
      "Max Buy Cost (GBP)": p.maxBuyCost || "",
      "Profit (GBP)": p.profit || "",
      "ROI (%)": p.roi || "",
      "Match Source": p.matchSource,
      Status: p.status,
      Qualified: p.matchesCriteria ? "Yes" : "No",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Saved Scan");
    const fileName = `${makeSafeFileName(scan.name)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const fetchLiveKeepa = async (asins: string[], barcodes: string[]) => {
    if (asins.length === 0 && barcodes.length === 0) {
      return { byKey: {} as Record<string, KeepaLiveEnriched>, metaText: "" };
    }

    const response = await fetch("/api/keepa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asins, codes: barcodes }),
    });

    const payload = (await response.json()) as KeepaResponse;
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "Keepa request failed");
    }

    const byKey: Record<string, KeepaLiveEnriched> = {};
    for (const item of payload.products ?? []) {
      const asin = item.asin?.trim().toUpperCase();
      if (!asin) continue;
      const enriched: KeepaLiveEnriched = {
        asin,
        title: item.title?.trim() ?? "",
        sellPrice: extractSellPrice(item),
        bsr: extractBsr(item),
      };
      byKey[asin] = enriched;
      for (const code of extractLiveCodes(item)) {
        byKey[code] = enriched;
      }
    }

    const asinMeta = payload.keepaMeta?.asinLookup;
    const codeMeta = payload.keepaMeta?.codeLookup;
    const metaParts: string[] = [];
    if (asinMeta?.tokensLeft !== null && asinMeta?.tokensLeft !== undefined) {
      metaParts.push(
        `ASIN lookup tokens left: ${asinMeta.tokensLeft} (refill rate: ${
          asinMeta.refillRate ?? "-"
        }/min)`,
      );
    }
    if (codeMeta?.tokensLeft !== null && codeMeta?.tokensLeft !== undefined) {
      metaParts.push(
        `Barcode lookup tokens left: ${codeMeta.tokensLeft} (refill rate: ${
          codeMeta.refillRate ?? "-"
        }/min)`,
      );
    }

    return { byKey, metaText: metaParts.join(" | ") };
  };

  const buildRowStatus = (
    matchSource: MatchSource,
    sellPrice: number,
    bsr: number,
    matchesCriteria: boolean,
    hasIdentifier: boolean,
  ) => {
    if (!hasIdentifier) return "Missing ASIN and barcode";
    if (matchSource === "unmatched") return "No Keepa match";
    if (!sellPrice) return "No sell price";
    if (!bsr) return "No BSR";
    if (!matchesCriteria) return "Below filter criteria";
    return "Qualified";
  };

  const runScan = async () => {
    if (!supplierFile) {
      setError("Please select a supplier file first.");
      return;
    }

    setLoading(true);
    setError("");
    setKeepaMetaText("");
    setScanProgressText("Starting scan...");
    setQueueProgress({
      stage: "preparing",
      totalCandidates: 0,
      processedCandidates: 0,
      totalBatches: 0,
      completedBatches: 0,
      matchedLive: 0,
      message: "Preparing queue...",
    });

    try {
      setScanProgressText("Reading supplier file...");
      const supplierWorkbook = await parseWorkbookFromFile(supplierFile);
      const supplierSheet = supplierWorkbook.Sheets[supplierWorkbook.SheetNames[0]];
      const supplierRows = parseSupplierRows(supplierSheet);

      let keepaByAsin: Record<string, KeepaCsvRowNormalized> = {};
      let keepaByBarcode: Record<string, KeepaCsvRowNormalized> = {};

      if (keepaExportFile) {
        setScanProgressText("Reading Keepa CSV...");
        const keepaWorkbook = await parseWorkbookFromFile(keepaExportFile);
        const keepaSheet = keepaWorkbook.Sheets[keepaWorkbook.SheetNames[0]];
        const keepaRows = parseKeepaCsvRows(keepaSheet);
        ({ keepaByAsin, keepaByBarcode } = buildKeepaCsvIndex(keepaRows));
      }

      setScanProgressText("Merging supplier rows...");
      const merged = supplierRows.map((s) => {
        let keepaCsvMatch: KeepaCsvRowNormalized | undefined;
        let matchSource: MatchSource = "unmatched";

        if (s.asin && keepaByAsin[s.asin]) {
          keepaCsvMatch = keepaByAsin[s.asin];
          matchSource = "keepa_csv_asin";
        }

        if (!keepaCsvMatch && s.barcodeCanonical) {
          for (const variant of barcodeVariants(s.barcodeCanonical)) {
            const candidate = keepaByBarcode[variant];
            if (candidate) {
              keepaCsvMatch = candidate;
              matchSource = "keepa_csv_barcode";
              break;
            }
          }
        }

        return {
          supplier: s,
          keepaCsv: keepaCsvMatch,
          live: undefined as KeepaLiveEnriched | undefined,
          matchSource,
        };
      });

      const unmatchedRows = merged.filter((row) => row.matchSource === "unmatched");
      const fallbackCandidates = unmatchedRows;
      const fallbackCapped = 0;
      const totalBatches = Math.ceil(
        fallbackCandidates.length / LIVE_FALLBACK_BATCH_SIZE,
      );
      const liveByKey: Record<string, KeepaLiveEnriched> = {};
      let matchedLive = 0;
      let latestMetaText = "";

      setQueueProgress({
        stage: "processing",
        totalCandidates: fallbackCandidates.length,
        processedCandidates: 0,
        totalBatches,
        completedBatches: 0,
        matchedLive: 0,
        message:
          fallbackCandidates.length > 0
            ? "Running live Keepa fallback queue..."
            : "No live fallback needed.",
      });

      for (let i = 0; i < fallbackCandidates.length; i += LIVE_FALLBACK_BATCH_SIZE) {
        const chunk = fallbackCandidates.slice(i, i + LIVE_FALLBACK_BATCH_SIZE);
        const fallbackAsins = Array.from(
          new Set(
            chunk
              .map((row) => row.supplier.asin)
              .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)),
          ),
        );
        const fallbackCodes = Array.from(
          new Set(
            chunk.map((row) => row.supplier.barcodeCanonical).filter(Boolean),
          ),
        );

        if (fallbackAsins.length > 0 || fallbackCodes.length > 0) {
          const liveResult = await fetchLiveKeepa(fallbackAsins, fallbackCodes);
          if (liveResult.metaText) latestMetaText = liveResult.metaText;
          Object.assign(liveByKey, liveResult.byKey);

          for (const row of chunk) {
            const hit =
              liveResult.byKey[row.supplier.asin] ||
              liveResult.byKey[row.supplier.barcodeCanonical];
            if (hit) matchedLive += 1;
          }
        }

        const processed = Math.min(
          fallbackCandidates.length,
          i + LIVE_FALLBACK_BATCH_SIZE,
        );
        const completedBatches = Math.min(
          totalBatches,
          Math.ceil(processed / LIVE_FALLBACK_BATCH_SIZE),
        );

        setScanProgressText(
          `Running live Keepa fallback... batch ${completedBatches}/${totalBatches || 1}`,
        );
        setQueueProgress({
          stage: "processing",
          totalCandidates: fallbackCandidates.length,
          processedCandidates: processed,
          totalBatches,
          completedBatches,
          matchedLive,
          message: `Processed ${processed}/${fallbackCandidates.length} unmatched rows`,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      setKeepaMetaText(latestMetaText);

      const finalized = merged.map((row) => {
        const liveMatch =
          row.matchSource === "unmatched"
            ? liveByKey[row.supplier.asin] || liveByKey[row.supplier.barcodeCanonical]
            : undefined;

        const effectiveMatchSource: MatchSource =
          row.matchSource !== "unmatched"
            ? row.matchSource
            : liveMatch
              ? "live_keepa"
              : "unmatched";

        const asin =
          row.supplier.asin || row.keepaCsv?.asin || liveMatch?.asin || "";
        const productTitle =
          row.supplier.productTitle || row.keepaCsv?.title || liveMatch?.title || "Untitled";
        const sellPrice =
          row.keepaCsv?.sellPrice || row.keepaCsv?.buyBoxCurrent || liveMatch?.sellPrice || 0;
        const bsr = row.keepaCsv?.bsr || liveMatch?.bsr || 0;
        const bsrDrops90d = row.keepaCsv?.bsrDrops90d || 0;
        const buyBox90dAvg = row.keepaCsv?.buyBox90dAvg || 0;
        const newOfferCount = row.keepaCsv?.newOfferCountCurrent || 0;
        const amazonInStockPercent = row.keepaCsv?.amazonInStockPercent90d || 0;

        const cost = row.supplier.cost;
        const calcCost = cost;

        const referralFee =
          row.keepaCsv?.referralFeeBasedOnCurrentBuyBox ||
          (row.keepaCsv?.referralFeePercent
            ? sellPrice * (row.keepaCsv.referralFeePercent / 100)
            : sellPrice * (settings.referralRatePercent / 100));

        const fbaFee = row.keepaCsv?.fbaPickPackFee || settings.fulfilmentFee;
        const amazonFeeBase =
          referralFee + settings.perItemFee + settings.variableClosingFee + fbaFee;
        const digitalServicesFee =
          amazonFeeBase * (settings.digitalServicesFeePercent / 100);
        const amazonFeesTotal = amazonFeeBase + digitalServicesFee;

        const vatRate = settings.vatRatePercent / 100;
        const vatOnSale =
          settings.vatRegistered && settings.includeEstimatedVatOnSale
            ? sellPrice * (vatRate / (1 + vatRate))
            : 0;
        const vatOnCost =
          settings.vatRegistered && !settings.costEnteredExVat
            ? calcCost * (vatRate / (1 + vatRate))
            : 0;
        const vatOnFees = settings.vatRegistered ? amazonFeesTotal * vatRate : 0;
        const vatDue =
          settings.vatRegistered && settings.useVatDueModel
            ? Math.max(0, vatOnSale - vatOnCost - vatOnFees)
            : vatOnSale;

        const totalCost =
          calcCost +
          settings.prepFee +
          settings.inboundFee +
          settings.miscFee +
          settings.storageFee +
          amazonFeesTotal +
          vatDue -
          settings.feeDiscount;

        const profit = sellPrice - totalCost;
        const roi = calcCost > 0 ? (profit / calcCost) * 100 : 0;

        const nonProductCosts = totalCost - calcCost;
        const maxCostByProfit = Math.max(
          0,
          sellPrice - nonProductCosts - settings.minProfit,
        );
        const maxCostByRoi =
          settings.minRoi > -100
            ? Math.max(
                0,
                (sellPrice - nonProductCosts) / (1 + settings.minRoi / 100),
              )
            : 0;
        const maxBuyCost = Math.max(0, Math.min(maxCostByProfit, maxCostByRoi));

        const matchesCriteria =
          roi >= settings.minRoi &&
          profit >= settings.minProfit &&
          bsr > 0 &&
          bsr <= settings.maxBsr;

        const status = buildRowStatus(
          effectiveMatchSource,
          sellPrice,
          bsr,
          matchesCriteria,
          Boolean(row.supplier.asin || row.supplier.barcodeCanonical),
        );

        const product: Product = {
          product: productTitle,
          asin,
          barcode: row.supplier.barcodeCanonical,
          bsr,
          bsrDrops90d,
          cost,
          sellPrice,
          buyBox90dAvg,
          newOfferCount,
          amazonInStockPercent,
          referralFee,
          fbaFee,
          maxBuyCost,
          profit,
          roi,
          matchesCriteria,
          matchSource: effectiveMatchSource,
          status,
        };

        return product;
      });

      const summary: MatchSummary = {
        total: finalized.length,
        csvAsin: finalized.filter((p) => p.matchSource === "keepa_csv_asin").length,
        csvBarcode: finalized.filter((p) => p.matchSource === "keepa_csv_barcode").length,
        live: finalized.filter((p) => p.matchSource === "live_keepa").length,
        unmatched: finalized.filter((p) => p.matchSource === "unmatched").length,
        fallbackAttempted: fallbackCandidates.length,
        fallbackCapped,
      };

      setProducts(finalized);
      setMatchSummary(summary);
      setQueueProgress({
        stage: "complete",
        totalCandidates: fallbackCandidates.length,
        processedCandidates: fallbackCandidates.length,
        totalBatches,
        completedBatches: totalBatches,
        matchedLive: finalized.filter((p) => p.matchSource === "live_keepa").length,
        message: "Background queue complete.",
      });
      setSupplierFileName(supplierFile.name);
      setKeepaExportFileName(keepaExportFile?.name ?? "");
      setLastRunModeLabel(modeLabel);
      setScanProgressText("Scan complete.");
      setScanModalOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setError(message);
      setScanProgressText("Scan failed.");
      setQueueProgress((prev) => ({
        ...prev,
        stage: "error",
        message: message,
      }));
    } finally {
      setLoading(false);
    }
  };

  const visibleProducts = settings.onlyShowQualified
    ? products.filter((product) => product.matchesCriteria)
    : products;

  const sortedProducts = useMemo(() => {
    if (!sortConfig) return visibleProducts;

    const sorted = [...visibleProducts].sort((a, b) => {
      const av = a[sortConfig.key];
      const bv = b[sortConfig.key];

      if (typeof av === "number" && typeof bv === "number") {
        return av - bv;
      }

      return String(av).localeCompare(String(bv), undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });

    return sortConfig.direction === "asc" ? sorted : sorted.reverse();
  }, [visibleProducts, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / rowsPerPage));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [rowsPerPage, sortConfig, settings.onlyShowQualified, products.length]);

  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedProducts.slice(startIndex, startIndex + rowsPerPage);
  }, [sortedProducts, currentPage, rowsPerPage]);

  const visibleColumns = useMemo(
    () => columnLayout.filter((item) => item.visible).map((item) => item.key),
    [columnLayout],
  );

  const toggleColumnVisibility = (key: SortKey) => {
    setColumnLayout((prev) => {
      const visibleCount = prev.filter((item) => item.visible).length;
      return prev.map((item) => {
        if (item.key !== key) return item;
        if (item.visible && visibleCount === 1) return item;
        return { ...item, visible: !item.visible };
      });
    });
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    setColumnLayout((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  };

  const resetColumnLayout = () => {
    setColumnLayout(DEFAULT_COLUMN_LAYOUT);
  };

  const toggleSort = (key: SortKey) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const sortIcon = (key: SortKey) => {
    if (!sortConfig || sortConfig.key !== key) return "☰↕";
    return sortConfig.direction === "asc" ? "▲" : "▼";
  };

  const onSupplierFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSupplierFile(file);
    setSupplierFileName(file?.name ?? "");
  };

  const onKeepaFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setKeepaExportFile(file);
    setKeepaExportFileName(file?.name ?? "");
    setKeepaCsvStatus("");
    setKeepaCsvParsing(false);
    if (!file) return;

    try {
      setKeepaCsvParsing(true);
      setKeepaCsvStatus("Parsing Keepa CSV...");
      const workbook = await parseWorkbookFromFile(file);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const keepaRows = parseKeepaCsvRows(sheet);
      setKeepaCsvStatus(
        `Keepa CSV loaded: ${keepaRows.length} products. ${
          supplierFile ? "Click Run Scan to merge." : "Now upload supplier file."
        }`,
      );
    } catch {
      setKeepaCsvStatus("Failed to parse Keepa CSV. Check file format.");
    } finally {
      setKeepaCsvParsing(false);
    }
  };

  return (
    <div>
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">
        {activeView === "settings"
          ? "Dashboard Settings"
          : activeView === "saved"
            ? "Saved Scans"
            : "Dashboard"}
      </h1>

      {activeView === "settings" ? (
        <DashboardSettingsPanel />
      ) : activeView === "saved" ? (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <p className="mb-4 text-sm text-zinc-300">
            Saved scans are stored locally in your browser.
          </p>
          {savedScans.length === 0 ? (
            <p className="text-sm text-zinc-400">No saved scans yet.</p>
          ) : (
            <div className="space-y-3">
              {savedScans.map((scan) => (
                <div
                  key={scan.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-zinc-100">{scan.name}</p>
                    <p className="text-xs text-zinc-400">
                      {new Date(scan.createdAt).toLocaleString()} | {scan.products.length} rows | {scan.modeLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadSavedScan(scan)}
                      className={compactActionButtonClass}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadSavedScan(scan)}
                      className={compactActionButtonClass}
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSavedScan(scan.id)}
                      className={compactActionButtonClass}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <p className="mb-4 inline-flex rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
            Mode: {displayModeLabel}
          </p>
          {saveNotice && <p className="mb-3 text-sm text-emerald-300">{saveNotice}</p>}

          <div className="mb-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setScanModalOpen(true)}
              className={actionButtonClass}
            >
              Open Scan Window
            </button>
            <button
              type="button"
              onClick={runScan}
              disabled={!supplierFile || loading}
              className={actionButtonClass}
            >
              <span className="inline-flex items-center gap-2">
                {loading ? <Spinner /> : null}
                {loading ? "Scanning..." : "Run Scan"}
              </span>
            </button>
            <button
              type="button"
              onClick={saveCurrentScan}
              disabled={products.length === 0}
              className={actionButtonClass}
            >
              Save Current Scan
            </button>
            <button
              type="button"
              onClick={() => setActiveView("saved")}
              className={actionButtonClass}
            >
              View Saved Scans ({savedScans.length})
            </button>
            <button
              type="button"
              onClick={() => setColumnManagerOpen(true)}
              className={actionButtonClass}
            >
              Column Manager
            </button>
          </div>

          {(supplierFile || supplierFileName) && (
            <p className="mb-1 text-sm text-zinc-300">
              Supplier: {supplierFile?.name ?? supplierFileName}
            </p>
          )}
          {(keepaExportFile || keepaExportFileName) && (
            <p className="mb-1 text-sm text-zinc-300">
              Keepa CSV: {keepaExportFile?.name ?? keepaExportFileName}
            </p>
          )}
          {keepaCsvStatus && <p className="mb-1 text-sm text-zinc-300">{keepaCsvStatus}</p>}
          {keepaMetaText && <p className="mb-3 text-sm text-zinc-300">{keepaMetaText}</p>}
          {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
          {queueProgress.totalCandidates > 0 && (
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
              <p className="text-sm text-zinc-200">
                Queue: {queueProgress.completedBatches}/{queueProgress.totalBatches} batches
                | {queueProgress.processedCandidates}/{queueProgress.totalCandidates} rows
                | Live matched: {queueProgress.matchedLive}
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded bg-zinc-800">
                <div
                  className="h-full bg-zinc-400 transition-all"
                  style={{
                    width: `${
                      queueProgress.totalCandidates > 0
                        ? Math.round(
                            (queueProgress.processedCandidates /
                              queueProgress.totalCandidates) *
                              100,
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-400">{queueProgress.message}</p>
            </div>
          )}

          {matchSummary && (
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200">
              <p>
                Total: {matchSummary.total} | CSV ASIN: {matchSummary.csvAsin} |
                CSV Barcode: {matchSummary.csvBarcode} | Live fallback: {matchSummary.live} |
                Unmatched: {matchSummary.unmatched}
              </p>
              <p>
                Live fallback attempted: {matchSummary.fallbackAttempted}
                {matchSummary.fallbackCapped > 0
                  ? ` (cap reached, ${matchSummary.fallbackCapped} skipped)`
                  : ""}
              </p>
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-black">
            <table className="w-full min-w-[1900px] text-left table-fixed">
              <thead className="bg-zinc-800/90">
                <tr>
                  {visibleColumns.map((columnKey, idx) => (
                    <th
                      key={columnKey}
                      className={`${idx === 0 ? "p-4" : "px-3 py-4 border-l border-zinc-700"} ${COLUMN_WIDTHS[columnKey]}`}
                    >
                      <SortHeader
                        label={COLUMN_LABELS[columnKey]}
                        icon={sortIcon(columnKey)}
                        onClick={() => toggleSort(columnKey)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedProducts.map((p, index) => (
                  <tr
                    key={`${p.barcode}-${p.asin}-${index}`}
                    className="border-t border-zinc-800 bg-black hover:bg-zinc-950/80"
                  >
                    {visibleColumns.map((columnKey, idx) => {
                      const cellClass =
                        idx === 0
                          ? "p-4"
                          : "whitespace-nowrap px-3 py-4 border-l border-zinc-800";

                      if (columnKey === "product") {
                        return (
                          <td key={columnKey} className={`${cellClass} max-w-0`}>
                            {p.asin ? (
                              <a
                                href={`https://www.amazon.co.uk/dp/${p.asin}`}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-zinc-100 underline-offset-2 hover:underline"
                                title={p.product}
                              >
                                {p.product}
                              </a>
                            ) : (
                              <span className="block truncate" title={p.product}>
                                {p.product}
                              </span>
                            )}
                          </td>
                        );
                      }

                      if (columnKey === "matchSource") {
                        return (
                          <td key={columnKey} className={`${cellClass} border-l border-zinc-800`}>
                            <span
                              className="inline-flex max-w-full items-center rounded-full border border-zinc-700 px-3 py-1 text-zinc-300"
                              title={p.matchSource}
                            >
                              <span className="truncate">{p.matchSource}</span>
                            </span>
                          </td>
                        );
                      }

                      if (columnKey === "status") {
                        return (
                          <td key={columnKey} className={`${cellClass} border-l border-zinc-800`}>
                            <span
                              className="inline-flex max-w-full items-center rounded-full border border-zinc-700 px-3 py-1 text-zinc-300"
                              title={p.status}
                            >
                              <span className="truncate">{p.status}</span>
                            </span>
                          </td>
                        );
                      }

                      const value = (() => {
                        switch (columnKey) {
                          case "barcode":
                            return p.barcode || "-";
                          case "asin":
                            return p.asin || "-";
                          case "bsr":
                            return p.bsr || "-";
                          case "bsrDrops90d":
                            return p.bsrDrops90d || "-";
                          case "cost":
                            return formatCurrency(p.cost);
                          case "sellPrice":
                            return p.sellPrice ? formatCurrency(p.sellPrice) : "-";
                          case "buyBox90dAvg":
                            return p.buyBox90dAvg ? formatCurrency(p.buyBox90dAvg) : "-";
                          case "newOfferCount":
                            return p.newOfferCount || "-";
                          case "amazonInStockPercent":
                            return p.amazonInStockPercent
                              ? `${p.amazonInStockPercent.toFixed(0)}%`
                              : "-";
                          case "referralFee":
                            return p.referralFee ? formatCurrency(p.referralFee) : "-";
                          case "fbaFee":
                            return p.fbaFee ? formatCurrency(p.fbaFee) : "-";
                          case "maxBuyCost":
                            return p.maxBuyCost ? formatCurrency(p.maxBuyCost) : "-";
                          case "profit":
                            return p.sellPrice ? formatCurrency(p.profit) : "-";
                          case "roi":
                            return p.sellPrice && p.cost > 0 ? `${p.roi.toFixed(1)}%` : "-";
                          default:
                            return "-";
                        }
                      })();

                      return <td key={columnKey} className={cellClass}>{value}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-black px-4 py-3 text-zinc-300">
            <p className="text-sm">{`0 of ${sortedProducts.length} row(s) selected.`}</p>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-200">Rows per page</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(Number(e.target.value))}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={40}>40</option>
                </select>
              </div>

              <span className="text-sm text-zinc-200">
                Page {currentPage} of {totalPages}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="h-10 w-10 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300"
                  aria-label="First page"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="h-10 w-10 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300"
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  }
                  disabled={currentPage >= totalPages}
                  className="h-10 w-10 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300"
                  aria-label="Next page"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className="h-10 w-10 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300"
                  aria-label="Last page"
                >
                  »
                </button>
              </div>
            </div>
          </div>

          {columnManagerOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
              <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
                <div className="sticky top-0 z-10 mb-2 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-6 py-4">
                  <h2 className="text-xl font-semibold">Column Manager</h2>
                  <button
                    type="button"
                    onClick={() => setColumnManagerOpen(false)}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 transition hover:bg-zinc-800"
                  >
                    Close
                  </button>
                </div>

                <p className="mb-4 px-6 text-sm text-zinc-300">
                  Show/hide columns, reorder them, and your layout will be saved.
                </p>

                <div className="space-y-2 overflow-y-auto px-6 pb-4">
                  {columnLayout.map((item, index) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black px-3 py-2"
                    >
                      <label className="flex items-center gap-3 text-sm text-zinc-100">
                        <input
                          type="checkbox"
                          checked={item.visible}
                          onChange={() => toggleColumnVisibility(item.key)}
                          disabled={
                            item.visible &&
                            columnLayout.filter((column) => column.visible).length === 1
                          }
                        />
                        <span>{COLUMN_LABELS[item.key]}</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => moveColumn(index, -1)}
                          disabled={index === 0}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveColumn(index, 1)}
                          disabled={index === columnLayout.length - 1}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="sticky bottom-0 mt-2 flex justify-end gap-2 border-t border-zinc-800 bg-zinc-950 px-6 py-4">
                  <button
                    type="button"
                    onClick={resetColumnLayout}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 transition hover:bg-zinc-800"
                  >
                    Reset to Default
                  </button>
                  <button
                    type="button"
                    onClick={() => setColumnManagerOpen(false)}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 transition hover:bg-zinc-800"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          {scanModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
              <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
                <h2 className="text-xl font-semibold mb-4">Scan Files</h2>
                <p className="mb-4 text-sm text-zinc-300">
                  Add supplier and Keepa files, then run scan.
                </p>

                <div className="space-y-3">
                  <label className="block">
                    <span className="block text-sm mb-1">Supplier File (.csv/.xlsx)</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={onSupplierFileChange}
                      className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-2 file:font-medium file:text-zinc-100 file:transition hover:file:bg-zinc-800"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-sm mb-1">Keepa Export CSV (optional)</span>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={onKeepaFileChange}
                      className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-2 file:font-medium file:text-zinc-100 file:transition hover:file:bg-zinc-800"
                    />
                  </label>
                </div>

                {(supplierFile || supplierFileName) && (
                  <p className="mt-3 text-sm text-zinc-300">
                    Supplier: {supplierFile?.name ?? supplierFileName}
                  </p>
                )}
                {(keepaExportFile || keepaExportFileName) && (
                  <p className="text-sm text-zinc-300">
                    Keepa CSV: {keepaExportFile?.name ?? keepaExportFileName}
                  </p>
                )}
                {keepaCsvStatus && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-zinc-300">
                    {keepaCsvParsing ? <Spinner /> : null}
                    <span>{keepaCsvStatus}</span>
                  </p>
                )}
                {scanProgressText && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-zinc-300">
                    {loading ? <Spinner /> : null}
                    <span>{scanProgressText}</span>
                  </p>
                )}
                {queueProgress.stage === "processing" && (
                  <div className="mt-3 rounded-lg border border-zinc-800 bg-black p-3">
                    <p className="text-xs text-zinc-300">
                      Queue: {queueProgress.completedBatches}/{queueProgress.totalBatches} batches
                      | {queueProgress.processedCandidates}/{queueProgress.totalCandidates} rows
                    </p>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded bg-zinc-800">
                      <div
                        className="h-full bg-zinc-400 transition-all"
                        style={{
                          width: `${
                            queueProgress.totalCandidates > 0
                              ? Math.round(
                                  (queueProgress.processedCandidates /
                                    queueProgress.totalCandidates) *
                                    100,
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setScanModalOpen(false)}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 transition hover:bg-zinc-800"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={runScan}
                    disabled={!supplierFile || loading}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500"
                  >
                    <span className="inline-flex items-center gap-2">
                      {loading ? <Spinner /> : null}
                      {loading ? "Scanning..." : "Run Scan"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SortHeader({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 text-left text-slate-100"
    >
      <span>{label}</span>
      <span className="text-[12px] text-slate-400">{icon}</span>
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
