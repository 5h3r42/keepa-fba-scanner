"use client";

import {
  ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Moon, Sun, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { DashboardSettingsPanel } from "@/components/dashboard-settings-panel";
import { useDashboardSettings } from "@/lib/dashboard-settings";
import { useTheme } from "@/lib/theme";
import {
  formatCurrencyValue,
  getMarketplaceConfig,
} from "@/lib/marketplace";
import type {
  BarcodeInputReport,
  KeepaResponse,
  MatchSource,
  MatchSummary,
  Product,
  ScanInputMode,
  ScanCompareResult,
  ScanHistoryRecord,
  ScanRunSummary,
  TokenSnapshot,
} from "@/lib/scan-types";
import {
  barcodeVariants,
  buildKeepaCsvIndex,
  extractBsr,
  extractLiveCodes,
  extractSellPrice,
  getDuplicateRows,
  isValidAsin,
  normalizeBarcode,
  parseKeepaCsvRows,
  parseBarcodeListFile,
  parseBarcodeListText,
  parseSupplierRows,
  parseWorkbookFromFile,
  type BarcodeListParseResult,
  type KeepaCsvRowNormalized,
  type KeepaLiveEnriched,
  type SupplierRowNormalized,
} from "@/lib/scan-utils";

type SortKey =
  | "product"
  | "barcode"
  | "asin"
  | "matchSource"
  | "matchConfidence"
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

type CurrentScanSnapshot = {
  products: Product[];
  matchSummary: MatchSummary | null;
  keepaMetaText: string;
  keepaCsvStatus: string;
  supplierFileName: string;
  keepaExportFileName: string;
  lastRunModeLabel: string;
  scanInputMode: ScanInputMode;
  barcodeListInput: string;
  barcodeListFileName: string;
  barcodeInputReport: BarcodeInputReport | null;
  scanRunSummary: ScanRunSummary | null;
};

type SavedScan = {
  id: string;
  name: string;
  createdAt: string;
  modeLabel: string;
  products: Product[];
  matchSummary: MatchSummary | null;
  scanRunSummary: ScanRunSummary | null;
};

type ScanQueueProgress = {
  stage: "idle" | "preparing" | "processing" | "complete" | "error";
  totalCandidates: number;
  processedCandidates: number;
  totalBatches: number;
  completedBatches: number;
  matchedLive: number;
  deferredCandidates: number;
  message: string;
};

type DecisionFilters = {
  search: string;
  asin: string;
  barcode: string;
  minRoi: string;
  minProfit: string;
  maxBsr: string;
  status: string;
  matchSources: MatchSource[];
};

type DecisionFilterPreset = {
  id: string;
  name: string;
  filters: DecisionFilters;
};

type InputQualityReport = {
  supplierRows: number;
  missingIdentifierRows: number;
  invalidAsinRows: number;
  invalidBarcodeRows: number;
  duplicateAsinRows: number;
  duplicateBarcodeRows: number;
};

type BarcodeListDiagnostics = BarcodeInputReport & {
  finalCount: number;
  invalidSample: string[];
};

type LiveLookupResult = {
  byKey: Record<string, KeepaLiveEnriched>;
  metaText: string;
  apiCalls: number;
  blockedByGuard: boolean;
  tokenSnapshot: TokenSnapshot;
};

type ErrorDisplayParts = {
  summary: string;
  rawPayload: string | null;
};

const SAVED_SCANS_STORAGE_KEY = "keepa-saved-scans-v2";
const CURRENT_SCAN_STORAGE_KEY = "keepa-current-scan-v2";
const COLUMN_LAYOUT_STORAGE_KEY = "keepa-column-layout-v1";
const FILTER_PRESET_STORAGE_KEY = "keepa-filter-presets-v1";
const MAX_SAVED_SCANS = 20;
const MAX_SAVED_SCAN_ROWS = 2000;
const LIVE_FALLBACK_BATCH_SIZE = 100;
const BARCODE_LIST_HARD_CAP = 2500;
const BARCODE_INPUT_PERSIST_MAX_CHARS = 50_000;
const BARCODE_INVALID_SAMPLE_LIMIT = 8;
const SHOW_ERROR_PAYLOAD_BY_DEFAULT = false;

const DEFAULT_COLUMN_LAYOUT: ColumnLayoutItem[] = [
  { key: "product", visible: true },
  { key: "barcode", visible: true },
  { key: "asin", visible: true },
  { key: "matchSource", visible: true },
  { key: "matchConfidence", visible: true },
  { key: "status", visible: true },
  { key: "bsr", visible: true },
  { key: "bsrDrops90d", visible: false },
  { key: "cost", visible: true },
  { key: "sellPrice", visible: true },
  { key: "buyBox90dAvg", visible: false },
  { key: "newOfferCount", visible: false },
  { key: "amazonInStockPercent", visible: false },
  { key: "referralFee", visible: false },
  { key: "fbaFee", visible: false },
  { key: "maxBuyCost", visible: true },
  { key: "profit", visible: true },
  { key: "roi", visible: true },
];

const COLUMN_LABELS: Record<SortKey, string> = {
  product: "Product",
  barcode: "Barcode",
  asin: "ASIN",
  matchSource: "Match Source",
  matchConfidence: "Match Confidence",
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
  matchConfidence: "w-[8%]",
  status: "w-[11%]",
  bsr: "w-[6%]",
  bsrDrops90d: "w-[7%]",
  cost: "w-[6%]",
  sellPrice: "w-[6%]",
  buyBox90dAvg: "w-[6%]",
  newOfferCount: "w-[6%]",
  amazonInStockPercent: "w-[7%]",
  referralFee: "w-[6%]",
  fbaFee: "w-[6%]",
  maxBuyCost: "w-[6%]",
  profit: "w-[6%]",
  roi: "w-[6%]",
};

const EMPTY_TOKEN_SNAPSHOT: TokenSnapshot = {
  asinTokensLeft: null,
  codeTokensLeft: null,
  refillRate: null,
};

const DEFAULT_FILTERS: DecisionFilters = {
  search: "",
  asin: "",
  barcode: "",
  minRoi: "",
  minProfit: "",
  maxBsr: "",
  status: "",
  matchSources: [],
};

const BUILTIN_PRESETS: DecisionFilterPreset[] = [
  {
    id: "preset_fast_flips",
    name: "Fast flips",
    filters: {
      ...DEFAULT_FILTERS,
      maxBsr: "80000",
      minRoi: "25",
      minProfit: "2",
    },
  },
  {
    id: "preset_low_bsr",
    name: "Low BSR only",
    filters: {
      ...DEFAULT_FILTERS,
      maxBsr: "50000",
    },
  },
  {
    id: "preset_live_matches",
    name: "Live matches",
    filters: {
      ...DEFAULT_FILTERS,
      matchSources: ["live_keepa"],
    },
  },
  {
    id: "preset_unmatched",
    name: "Unmatched",
    filters: {
      ...DEFAULT_FILTERS,
      matchSources: ["unmatched"],
    },
  },
];

const compactProductForSave = (product: Product): Product => ({
  ...product,
  product: product.product.slice(0, 180),
  status: product.status.slice(0, 120),
  failReasons: product.failReasons.slice(0, 5).map((reason) => reason.slice(0, 120)),
});

const compactProductsForSave = (items: Product[]): Product[] =>
  items.slice(0, MAX_SAVED_SCAN_ROWS).map(compactProductForSave);

const makeSafeFileName = (value: string): string =>
  value
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

const calcEstimatedApiCalls = (rows: number) => Math.max(0, Math.ceil(rows / LIVE_FALLBACK_BATCH_SIZE) * 2);

const parseNumericFilter = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveKeepaErrorMessage = (payload: KeepaResponse): string => {
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  if (
    payload.error &&
    typeof payload.error === "object" &&
    typeof payload.error.message === "string" &&
    payload.error.message.trim()
  ) {
    return payload.error.message.trim();
  }
  return "Keepa request failed";
};

const getMatchConfidence = (
  source: MatchSource,
  liveMatchedBy: "asin" | "barcode" | null,
): number => {
  if (source === "keepa_csv_asin") return 0.99;
  if (source === "keepa_csv_barcode") return 0.92;
  if (source === "live_keepa") return liveMatchedBy === "asin" ? 0.8 : 0.7;
  return 0;
};

const buildRemediationSuggestions = (product: Product): string[] => {
  const suggestions: string[] = [];

  if (!product.asin && !product.barcode) {
    suggestions.push("Add a valid ASIN or barcode in your supplier file.");
  }
  if (product.asin && !isValidAsin(product.asin)) {
    suggestions.push("ASIN should be 10 alphanumeric characters.");
  }
  if (product.barcodeRaw && !product.barcode) {
    suggestions.push("Barcode contains invalid characters or length.");
  }
  if (suggestions.length === 0) {
    suggestions.push("Retry unmatched row with manual ASIN/barcode override.");
  }

  return suggestions;
};

const exportProductsToWorkbook = (
  products: Product[],
  fileName: string,
  currency: string,
) => {
  const rows = products.map((p) => ({
    Product: p.product,
    Barcode: p.barcode,
    "Barcode (Raw)": p.barcodeRaw,
    ASIN: p.asin,
    BSR: p.bsr || "",
    "BSR Drops 90d": p.bsrDrops90d || "",
    [`Cost (${currency})`]: p.cost,
    [`Sell Price (${currency})`]: p.sellPrice || "",
    [`Buy Box 90d Avg (${currency})`]: p.buyBox90dAvg || "",
    "New Offers": p.newOfferCount || "",
    "Amazon In Stock %": p.amazonInStockPercent || "",
    [`Referral Fee (${currency})`]: p.referralFee || "",
    [`FBA Fee (${currency})`]: p.fbaFee || "",
    [`Max Buy Cost (${currency})`]: p.maxBuyCost || "",
    [`Profit (${currency})`]: p.profit || "",
    "ROI (%)": p.roi || "",
    "Match Source": p.matchSource,
    "Match Confidence": Number((p.matchConfidence * 100).toFixed(1)),
    Status: p.status,
    "Fail Reasons": p.failReasons.join(" | "),
    Duplicate: p.isDuplicate ? "Yes" : "No",
    Qualified: p.matchesCriteria ? "Yes" : "No",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Scan Results");
  XLSX.writeFile(workbook, fileName);
};

export default function Page() {
  const {
    settings,
    activeView,
    setActiveView,
    scanModalOpen,
    setScanModalOpen,
    saveScanSignal,
  } = useDashboardSettings();
  const { theme, toggleTheme } = useTheme();
  const isLightMode = theme === "light";
  const ThemeToggleIcon = isLightMode ? Sun : Moon;

  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [keepaExportFile, setKeepaExportFile] = useState<File | null>(null);
  const [scanInputMode, setScanInputMode] = useState<ScanInputMode>("supplier_file");
  const [barcodeListInput, setBarcodeListInput] = useState("");
  const [barcodeListFileName, setBarcodeListFileName] = useState("");
  const [barcodeListStatus, setBarcodeListStatus] = useState("");
  const [barcodeListParsing, setBarcodeListParsing] = useState(false);
  const [barcodeInputReport, setBarcodeInputReport] = useState<BarcodeInputReport | null>(null);
  const [supplierFileName, setSupplierFileName] = useState("");
  const [keepaExportFileName, setKeepaExportFileName] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
  const [scanRunSummary, setScanRunSummary] = useState<ScanRunSummary | null>(null);
  const [inputQualityReport, setInputQualityReport] = useState<InputQualityReport | null>(null);
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
    deferredCandidates: 0,
    message: "",
  });
  const [error, setError] = useState("");
  const [showErrorPayload, setShowErrorPayload] = useState(
    SHOW_ERROR_PAYLOAD_BY_DEFAULT,
  );
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [columnLayout, setColumnLayout] =
    useState<ColumnLayoutItem[]>(DEFAULT_COLUMN_LAYOUT);
  const [columnManagerOpen, setColumnManagerOpen] = useState(false);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [scanStateLoaded, setScanStateLoaded] = useState(false);
  const [decisionFilters, setDecisionFilters] = useState<DecisionFilters>(DEFAULT_FILTERS);
  const [customFilterPresets, setCustomFilterPresets] = useState<DecisionFilterPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [resultsTab, setResultsTab] = useState<"results" | "unmatched">("results");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [manualOverrides, setManualOverrides] = useState<
    Record<string, { asin: string; barcode: string }>
  >({});
  const [tokenSnapshot, setTokenSnapshot] = useState<TokenSnapshot>(EMPTY_TOKEN_SNAPSHOT);
  const [serverScans, setServerScans] = useState<ScanHistoryRecord[]>([]);
  const [serverCompare, setServerCompare] = useState<ScanCompareResult | null>(null);
  const [deletingServerScanId, setDeletingServerScanId] = useState<string | null>(null);

  const lastHandledSaveSignalRef = useRef(0);
  const supplierFileInputRef = useRef<HTMLInputElement | null>(null);
  const keepaFileInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeListFileInputRef = useRef<HTMLInputElement | null>(null);

  const actionButtonClass =
    "inline-flex h-12 items-center rounded-xl border border-zinc-700 bg-zinc-900 px-5 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500";
  const compactActionButtonClass =
    "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 transition hover:bg-zinc-800";
  const iconActionButtonClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-60";

  const marketplaceConfig = getMarketplaceConfig(settings.marketplace);
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyValue(value, settings.currency),
    [settings.currency],
  );

  const barcodeListRunCap = Math.min(
    BARCODE_LIST_HARD_CAP,
    Math.max(0, settings.maxLiveFallbackRows),
  );

  const barcodeListParseResult = useMemo<BarcodeListParseResult>(
    () => parseBarcodeListText(barcodeListInput),
    [barcodeListInput],
  );

  const barcodeListDiagnostics = useMemo<BarcodeListDiagnostics>(() => {
    const finalCount = Math.min(barcodeListParseResult.validCodes.length, barcodeListRunCap);
    const cappedCount = Math.max(0, barcodeListParseResult.validCodes.length - finalCount);
    return {
      rawCount: barcodeListParseResult.rawCount,
      validCount: barcodeListParseResult.validCodes.length,
      invalidCount: barcodeListParseResult.invalidTokens.length,
      duplicatesRemoved: barcodeListParseResult.duplicatesRemoved,
      cappedCount,
      finalCount,
      invalidSample: barcodeListParseResult.invalidTokens.slice(0, BARCODE_INVALID_SAMPLE_LIMIT),
    };
  }, [barcodeListParseResult, barcodeListRunCap]);

  const modeLabel =
    scanInputMode === "barcode_list"
      ? "Barcode list live scan"
      : keepaExportFile
        ? "CSV-first + live fallback queue"
        : "Live-only (no Keepa CSV provided)";

  const displayModeLabel =
    scanInputMode !== "barcode_list" && !keepaExportFile && products.length > 0 && lastRunModeLabel
      ? lastRunModeLabel
      : modeLabel;

  const canRunScan =
    scanInputMode === "supplier_file"
      ? Boolean(supplierFile)
      : barcodeListDiagnostics.finalCount > 0;

  const errorDisplay = useMemo<ErrorDisplayParts>(() => parseErrorDisplay(error), [error]);

  const hasScanInputDetails = Boolean(
    (scanInputMode === "supplier_file" && (supplierFile || supplierFileName)) ||
      (scanInputMode === "supplier_file" && (keepaExportFile || keepaExportFileName)) ||
      (scanInputMode === "barcode_list" && barcodeListFileName) ||
      (scanInputMode === "supplier_file" && keepaCsvStatus) ||
      barcodeListStatus,
  );

  const allFilterPresets = useMemo(
    () => [...BUILTIN_PRESETS, ...customFilterPresets],
    [customFilterPresets],
  );

  const selectedIdSet = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);

  const persistServerRun = useCallback(
    async (summary: ScanRunSummary, rows: Product[]) => {
      try {
        await fetch("/api/scans", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary,
            products: rows,
          }),
        });
      } catch {
        // Optional server history persistence.
      }
    },
    [],
  );

  const loadServerRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/scans?includeProducts=1");
      if (!response.ok) return;
      const payload = (await response.json()) as { scans?: ScanHistoryRecord[] };
      setServerScans(Array.isArray(payload.scans) ? payload.scans : []);
    } catch {
      // Ignore optional server history load failures.
    }
  }, []);

  const compareLatestServerRuns = useCallback(async () => {
    if (serverScans.length < 2) {
      setServerCompare(null);
      return;
    }

    const newest = serverScans[0];
    const previous = serverScans[1];

    try {
      const response = await fetch(
        `/api/scans?compare=${encodeURIComponent(previous.id)},${encodeURIComponent(newest.id)}`,
      );
      if (!response.ok) {
        setServerCompare(null);
        return;
      }

      const payload = (await response.json()) as { compare?: ScanCompareResult };
      setServerCompare(payload.compare ?? null);
    } catch {
      setServerCompare(null);
    }
  }, [serverScans]);

  useEffect(() => {
    loadServerRuns();
  }, [loadServerRuns]);

  useEffect(() => {
    compareLatestServerRuns();
  }, [compareLatestServerRuns]);

  useEffect(() => {
    setShowErrorPayload(SHOW_ERROR_PAYLOAD_BY_DEFAULT);
  }, [error]);

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
      const raw = localStorage.getItem(FILTER_PRESET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as DecisionFilterPreset[];
      if (!Array.isArray(parsed)) return;
      setCustomFilterPresets(parsed);
    } catch {
      // Ignore malformed filter presets.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(FILTER_PRESET_STORAGE_KEY, JSON.stringify(customFilterPresets));
  }, [customFilterPresets]);

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
      if (parsed.scanInputMode === "supplier_file" || parsed.scanInputMode === "barcode_list") {
        setScanInputMode(parsed.scanInputMode);
      }
      if (typeof parsed.barcodeListInput === "string") {
        setBarcodeListInput(parsed.barcodeListInput.slice(0, BARCODE_INPUT_PERSIST_MAX_CHARS));
      }
      if (typeof parsed.barcodeListFileName === "string") {
        setBarcodeListFileName(parsed.barcodeListFileName);
      }
      if (parsed.barcodeInputReport && typeof parsed.barcodeInputReport === "object") {
        setBarcodeInputReport(parsed.barcodeInputReport as BarcodeInputReport);
      }
      if (parsed.scanRunSummary) {
        setScanRunSummary(parsed.scanRunSummary as ScanRunSummary);
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
      scanInputMode,
      barcodeListInput: barcodeListInput.slice(0, BARCODE_INPUT_PERSIST_MAX_CHARS),
      barcodeListFileName,
      barcodeInputReport,
      scanRunSummary,
    };

    try {
      localStorage.setItem(CURRENT_SCAN_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      try {
        localStorage.setItem(
          CURRENT_SCAN_STORAGE_KEY,
          JSON.stringify({ ...snapshot, products: compactProducts.slice(0, 300) }),
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
    scanInputMode,
    barcodeListInput,
    barcodeListFileName,
    barcodeInputReport,
    scanRunSummary,
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
      scanRunSummary,
    };
    const next = [scan, ...savedScans].slice(0, MAX_SAVED_SCANS);
    const saved = persistSavedScans(next);
    setSaveNotice(
      saved
        ? `Saved: ${scan.name}${products.length > MAX_SAVED_SCAN_ROWS ? ` (first ${MAX_SAVED_SCAN_ROWS} rows)` : ""}`
        : "Could not save scan. Browser storage is full.",
    );
  }, [products, modeLabel, matchSummary, savedScans, scanRunSummary]);

  useEffect(() => {
    if (saveScanSignal === 0) return;
    if (lastHandledSaveSignalRef.current === saveScanSignal) return;
    lastHandledSaveSignalRef.current = saveScanSignal;
    saveCurrentScan();
  }, [saveScanSignal, saveCurrentScan]);

  const loadSavedScan = (scan: SavedScan) => {
    setProducts(scan.products);
    setMatchSummary(scan.matchSummary);
    setScanRunSummary(scan.scanRunSummary);
    setScanInputMode(
      scan.scanRunSummary?.scanInputMode ??
        (scan.modeLabel.toLowerCase().includes("barcode") ? "barcode_list" : "supplier_file"),
    );
    setSelectedRowIds([]);
    setError("");
    setKeepaMetaText("");
    setSaveNotice(`Loaded: ${scan.name}`);
    setActiveView("dashboard");
  };

  const loadServerScan = (scan: ScanHistoryRecord) => {
    setProducts(scan.products);
    setMatchSummary(scan.summary.matchSummary);
    setScanRunSummary(scan.summary);
    setScanInputMode(scan.summary.scanInputMode ?? "supplier_file");
    setSelectedRowIds([]);
    setError("");
    setKeepaMetaText("");
    setSaveNotice(`Loaded server run: ${scan.summary.id}`);
    setActiveView("dashboard");
  };

  const deleteSavedScan = (id: string) => {
    const next = savedScans.filter((scan) => scan.id !== id);
    persistSavedScans(next);
  };

  const deleteServerScan = async (id: string) => {
    const target = serverScans.find((scan) => scan.id === id);
    if (!target) return;
    const confirmed = window.confirm(`Delete server run ${target.summary.id}?`);
    if (!confirmed) return;

    setDeletingServerScanId(id);
    try {
      const response = await fetch(`/api/scans/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Failed to delete server scan.");
        return;
      }
      setServerScans((prev) => prev.filter((scan) => scan.id !== id));
      setSaveNotice(`Deleted server run: ${target.summary.id}`);
    } catch {
      setError("Failed to delete server scan.");
    } finally {
      setDeletingServerScanId(null);
    }
  };

  const downloadSavedScan = (scan: SavedScan) => {
    exportProductsToWorkbook(
      scan.products,
      `${makeSafeFileName(scan.name)}.xlsx`,
      settings.currency,
    );
  };

  const deleteSelectedRows = () => {
    if (selectedRowIds.length === 0) return;

    const selectedSet = new Set(selectedRowIds);
    const nextProducts = products.filter((product) => !selectedSet.has(product.id));
    const nextMatchSummary = matchSummary
      ? {
          ...matchSummary,
          total: nextProducts.length,
          csvAsin: nextProducts.filter((row) => row.matchSource === "keepa_csv_asin").length,
          csvBarcode: nextProducts.filter((row) => row.matchSource === "keepa_csv_barcode").length,
          live: nextProducts.filter((row) => row.matchSource === "live_keepa").length,
          unmatched: nextProducts.filter((row) => row.matchSource === "unmatched").length,
        }
      : null;

    setProducts(nextProducts);
    setSelectedRowIds([]);
    setMatchSummary(nextMatchSummary);
    setScanRunSummary((prev) =>
      prev
        ? {
            ...prev,
            totalRows: nextProducts.length,
            qualifiedRows: nextProducts.filter((row) => row.matchesCriteria).length,
            matchSummary: nextMatchSummary ?? prev.matchSummary,
          }
        : null,
    );
  };

  const toggleSelectRow = (rowId: string) => {
    setSelectedRowIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId],
    );
  };

  const applyFilters = useCallback(
    (rows: Product[]) => {
      const minRoiFilter = parseNumericFilter(decisionFilters.minRoi);
      const minProfitFilter = parseNumericFilter(decisionFilters.minProfit);
      const maxBsrFilter = parseNumericFilter(decisionFilters.maxBsr);
      const search = decisionFilters.search.trim().toLowerCase();
      const asin = decisionFilters.asin.trim().toUpperCase();
      const barcode = normalizeBarcode(decisionFilters.barcode);
      const status = decisionFilters.status.trim().toLowerCase();

      return rows.filter((product) => {
        if (settings.onlyShowQualified && !product.matchesCriteria) {
          return false;
        }

        if (search) {
          const haystack = `${product.product} ${product.asin} ${product.barcode} ${product.status}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }

        if (asin && !product.asin.includes(asin)) return false;
        if (barcode && !product.barcode.includes(barcode)) return false;

        if (
          decisionFilters.matchSources.length > 0 &&
          !decisionFilters.matchSources.includes(product.matchSource)
        ) {
          return false;
        }

        if (status && !product.status.toLowerCase().includes(status)) return false;

        if (minRoiFilter !== null && product.roi < minRoiFilter) return false;
        if (minProfitFilter !== null && product.profit < minProfitFilter) return false;
        if (maxBsrFilter !== null && product.bsr > maxBsrFilter) return false;

        return true;
      });
    },
    [decisionFilters, settings.onlyShowQualified],
  );

  const visibleProducts = useMemo(() => applyFilters(products), [applyFilters, products]);

  const unmatchedProducts = useMemo(
    () => visibleProducts.filter((product) => product.matchSource === "unmatched"),
    [visibleProducts],
  );

  const sortedProducts = useMemo(() => {
    const rows = resultsTab === "unmatched" ? unmatchedProducts : visibleProducts;

    if (!sortConfig) return rows;

    const sorted = [...rows].sort((a, b) => {
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
  }, [visibleProducts, unmatchedProducts, sortConfig, resultsTab]);

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / rowsPerPage));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [rowsPerPage, sortConfig, settings.onlyShowQualified, products.length, resultsTab]);

  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedProducts.slice(startIndex, startIndex + rowsPerPage);
  }, [sortedProducts, currentPage, rowsPerPage]);

  const visibleColumns = useMemo(
    () => columnLayout.filter((item) => item.visible).map((item) => item.key),
    [columnLayout],
  );

  const pageRowIds = useMemo(() => paginatedProducts.map((item) => item.id), [paginatedProducts]);
  const allPageSelected =
    pageRowIds.length > 0 && pageRowIds.every((rowId) => selectedIdSet.has(rowId));

  const toggleSelectPageRows = () => {
    setSelectedRowIds((prev) => {
      const set = new Set(prev);
      if (allPageSelected) {
        pageRowIds.forEach((rowId) => set.delete(rowId));
      } else {
        pageRowIds.forEach((rowId) => set.add(rowId));
      }
      return Array.from(set);
    });
  };

  const selectedProducts = useMemo(
    () => products.filter((product) => selectedIdSet.has(product.id)),
    [products, selectedIdSet],
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

  const onScanInputModeChange = (mode: ScanInputMode) => {
    setScanInputMode(mode);
    setError("");
    if (mode === "supplier_file") {
      setBarcodeListStatus("");
      setBarcodeInputReport(null);
    } else {
      setKeepaCsvStatus("");
    }
  };

  const onKeepaFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (scanInputMode !== "supplier_file") return;
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

  const onBarcodeListInputChange = (value: string) => {
    if (value.length > BARCODE_INPUT_PERSIST_MAX_CHARS) {
      setBarcodeListStatus(
        `Barcode input capped at ${BARCODE_INPUT_PERSIST_MAX_CHARS.toLocaleString()} characters.`,
      );
      setBarcodeListInput(value.slice(0, BARCODE_INPUT_PERSIST_MAX_CHARS));
      return;
    }

    setBarcodeListStatus("");
    setBarcodeListInput(value);
  };

  const onBarcodeListFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setBarcodeListFileName(file?.name ?? "");
    setBarcodeListStatus("");
    if (!file) return;

    try {
      setBarcodeListParsing(true);
      const text = await file.text();
      onBarcodeListInputChange(text);
      const parsed = await parseBarcodeListFile(file);
      setBarcodeListStatus(
        `Parsed ${parsed.rawCount.toLocaleString()} entries: ${parsed.validCodes.length.toLocaleString()} valid, ${parsed.invalidTokens.length.toLocaleString()} invalid, ${parsed.duplicatesRemoved.toLocaleString()} duplicates removed.`,
      );
    } catch {
      setBarcodeListStatus("Failed to parse barcode list file.");
    } finally {
      setBarcodeListParsing(false);
    }
  };

  const clearScanInputs = () => {
    setSupplierFile(null);
    setSupplierFileName("");
    setKeepaExportFile(null);
    setKeepaExportFileName("");
    setKeepaCsvStatus("");
    setKeepaCsvParsing(false);
    setBarcodeListInput("");
    setBarcodeListFileName("");
    setBarcodeListStatus("");
    setBarcodeListParsing(false);
    setBarcodeInputReport(null);

    if (supplierFileInputRef.current) {
      supplierFileInputRef.current.value = "";
    }
    if (keepaFileInputRef.current) {
      keepaFileInputRef.current.value = "";
    }
    if (barcodeListFileInputRef.current) {
      barcodeListFileInputRef.current.value = "";
    }
  };

  const buildFailReasons = (input: {
    matchSource: MatchSource;
    sellPrice: number;
    bsr: number;
    roi: number;
    profit: number;
    hasIdentifier: boolean;
    costMissing: boolean;
  }): string[] => {
    const reasons: string[] = [];

    if (!input.hasIdentifier) reasons.push("Missing ASIN and barcode");
    if (input.costMissing) reasons.push("Cost missing");
    if (input.matchSource === "unmatched") reasons.push("No Keepa match");
    if (!input.sellPrice) reasons.push("No sell price");
    if (!input.bsr) reasons.push("No BSR");

    if (!input.costMissing) {
      if (input.roi < settings.minRoi) {
        reasons.push(`ROI below ${settings.minRoi.toFixed(1)}%`);
      }
      if (input.profit < settings.minProfit) {
        reasons.push(`Profit below ${formatCurrency(settings.minProfit)}`);
      }
    }
    if (input.bsr > settings.maxBsr) {
      reasons.push(`BSR above ${settings.maxBsr.toLocaleString()}`);
    }

    return reasons;
  };

  const findLiveMatchByIdentifiers = (
    byKey: Record<string, KeepaLiveEnriched>,
    asinRaw?: string,
    barcodeRaw?: string,
  ): { match: KeepaLiveEnriched | undefined; matchedBy: "asin" | "barcode" | null } => {
    const asin = (asinRaw ?? "").trim().toUpperCase();
    if (asin && byKey[asin]) {
      return { match: byKey[asin], matchedBy: "asin" };
    }

    const barcode = normalizeBarcode(barcodeRaw ?? "");
    if (!barcode) {
      return { match: undefined, matchedBy: null };
    }

    for (const variant of barcodeVariants(barcode)) {
      if (byKey[variant]) {
        return { match: byKey[variant], matchedBy: "barcode" };
      }
    }

    return { match: undefined, matchedBy: null };
  };

  const fetchLiveKeepa = async (
    asins: string[],
    barcodes: string[],
  ): Promise<LiveLookupResult> => {
    if (asins.length === 0 && barcodes.length === 0) {
      return {
        byKey: {},
        metaText: "",
        apiCalls: 0,
        blockedByGuard: false,
        tokenSnapshot: EMPTY_TOKEN_SNAPSHOT,
      };
    }

    const proxyToken = process.env.NEXT_PUBLIC_KEEPA_PROXY_TOKEN;
    const response = await fetch("/api/keepa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(proxyToken ? { "x-keepa-proxy-token": proxyToken } : {}),
      },
      body: JSON.stringify({
        asins,
        codes: barcodes,
        marketplace: settings.marketplace,
        tokenGuard: {
          mode: settings.tokenBudgetMode,
          hardLimit: settings.tokenHardLimit,
        },
      }),
    });

    const payload = (await response.json()) as KeepaResponse;
    const requestCost = payload.keepaMeta?.requestCost;

    if (!response.ok) {
      if (response.status === 429) {
        const guardBlocked = requestCost?.blockedByGuard ?? false;
        const message = guardBlocked
          ? "Token guard blocked live lookup."
          : resolveKeepaErrorMessage(payload);

        return {
          byKey: {},
          metaText:
            message && message !== "Keepa request failed"
              ? message
              : "Keepa token/rate limit reached. Remaining rows deferred.",
          apiCalls: requestCost?.apiCalls ?? 0,
          blockedByGuard: true,
          tokenSnapshot: {
            asinTokensLeft: payload.keepaMeta?.asinLookup?.tokensLeft ?? null,
            codeTokensLeft: payload.keepaMeta?.codeLookup?.tokensLeft ?? null,
            refillRate:
              payload.keepaMeta?.asinLookup?.refillRate ??
              payload.keepaMeta?.codeLookup?.refillRate ??
              null,
          },
        };
      }

      if (response.status === 401) {
        throw new Error("Unauthorized Keepa proxy request. Check KEEPA proxy token configuration.");
      }
      if (response.status === 413) {
        throw new Error("Request is too large for Keepa proxy limits. Reduce barcode count.");
      }

      throw new Error(resolveKeepaErrorMessage(payload));
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
        for (const variant of barcodeVariants(code)) {
          byKey[variant] = enriched;
        }
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

    return {
      byKey,
      metaText: metaParts.join(" | "),
      apiCalls: requestCost?.apiCalls ?? 0,
      blockedByGuard: false,
      tokenSnapshot: {
        asinTokensLeft: asinMeta?.tokensLeft ?? null,
        codeTokensLeft: codeMeta?.tokensLeft ?? null,
        refillRate: asinMeta?.refillRate ?? codeMeta?.refillRate ?? null,
      },
    };
  };

  const computeInputQualityReport = (supplierRows: SupplierRowNormalized[]): InputQualityReport => {
    const asins = supplierRows.map((row) => row.asin).filter(Boolean);
    const barcodes = supplierRows.map((row) => row.barcodeCanonical).filter(Boolean);

    return {
      supplierRows: supplierRows.length,
      missingIdentifierRows: supplierRows.filter((row) => !row.asin && !row.barcodeCanonical).length,
      invalidAsinRows: supplierRows.filter((row) => row.asin && !isValidAsin(row.asin)).length,
      invalidBarcodeRows: supplierRows.filter((row) => row.barcodeRaw && !row.barcodeCanonical).length,
      duplicateAsinRows: getDuplicateRows(asins),
      duplicateBarcodeRows: getDuplicateRows(barcodes),
    };
  };

  const calculateFinancials = (input: {
    sellPrice: number;
    cost: number;
    bsr: number;
    matchSource: MatchSource;
    forceCostMissing?: boolean;
    keepaCsv?: KeepaCsvRowNormalized;
  }) => {
    const referralFee =
      input.keepaCsv?.referralFeeBasedOnCurrentBuyBox ||
      (input.keepaCsv?.referralFeePercent
        ? input.sellPrice * (input.keepaCsv.referralFeePercent / 100)
        : input.sellPrice * (settings.referralRatePercent / 100));

    const fbaFee = input.keepaCsv?.fbaPickPackFee || settings.fulfilmentFee;
    const amazonFeeBase =
      referralFee + settings.perItemFee + settings.variableClosingFee + fbaFee;
    const digitalServicesFee = amazonFeeBase * (settings.digitalServicesFeePercent / 100);
    const amazonFeesTotal = amazonFeeBase + digitalServicesFee;

    const vatRate = settings.vatRatePercent / 100;
    const vatOnSale =
      settings.vatRegistered && settings.includeEstimatedVatOnSale
        ? input.sellPrice * (vatRate / (1 + vatRate))
        : 0;
    const vatOnCost =
      settings.vatRegistered && !settings.costEnteredExVat
        ? input.cost * (vatRate / (1 + vatRate))
        : 0;
    const vatOnFees = settings.vatRegistered ? amazonFeesTotal * vatRate : 0;
    const vatDue =
      settings.vatRegistered && settings.useVatDueModel
        ? Math.max(0, vatOnSale - vatOnCost - vatOnFees)
        : vatOnSale;

    const totalCost =
      input.cost +
      settings.prepFee +
      settings.inboundFee +
      settings.miscFee +
      settings.storageFee +
      amazonFeesTotal +
      vatDue -
      settings.feeDiscount;

    const rawProfit = input.sellPrice - totalCost;
    const rawRoi = input.cost > 0 ? (rawProfit / input.cost) * 100 : 0;

    const nonProductCosts = totalCost - input.cost;
    const maxCostByProfit = Math.max(0, input.sellPrice - nonProductCosts - settings.minProfit);
    const maxCostByRoi =
      settings.minRoi > -100
        ? Math.max(0, (input.sellPrice - nonProductCosts) / (1 + settings.minRoi / 100))
        : 0;
    const rawMaxBuyCost = Math.max(0, Math.min(maxCostByProfit, maxCostByRoi));

    const forceCostMissing = Boolean(input.forceCostMissing);
    const profit = forceCostMissing ? 0 : rawProfit;
    const roi = forceCostMissing ? 0 : rawRoi;
    const maxBuyCost = forceCostMissing ? 0 : rawMaxBuyCost;

    return {
      referralFee,
      fbaFee,
      profit,
      roi,
      maxBuyCost,
    };
  };

  const finalizeProducts = (input: {
    scanRunId: string;
    scanInputMode: ScanInputMode;
    rows: Array<{
      supplier: SupplierRowNormalized;
      keepaCsv?: KeepaCsvRowNormalized;
      matchSource: MatchSource;
    }>;
    liveByKey: Record<string, KeepaLiveEnriched>;
  }): Product[] => {
    const provisional = input.rows.map((row, idx) => {
      const costMissing = input.scanInputMode === "barcode_list";
      const liveLookup = findLiveMatchByIdentifiers(
        input.liveByKey,
        row.supplier.asin,
        row.supplier.barcodeCanonical,
      );
      const liveMatch = row.matchSource === "unmatched" ? liveLookup.match : undefined;

      const effectiveMatchSource: MatchSource =
        row.matchSource !== "unmatched"
          ? row.matchSource
          : liveMatch
            ? "live_keepa"
            : "unmatched";

      const liveMatchedBy: "asin" | "barcode" | null = liveMatch
        ? liveLookup.matchedBy
        : null;

      const asin = row.supplier.asin || row.keepaCsv?.asin || liveMatch?.asin || "";
      const productTitle =
        row.supplier.productTitle || row.keepaCsv?.title || liveMatch?.title || "Untitled";
      const sellPrice =
        row.keepaCsv?.sellPrice || row.keepaCsv?.buyBoxCurrent || liveMatch?.sellPrice || 0;
      const bsr = row.keepaCsv?.bsr || liveMatch?.bsr || 0;
      const bsrDrops90d = row.keepaCsv?.bsrDrops90d || 0;
      const buyBox90dAvg = row.keepaCsv?.buyBox90dAvg || 0;
      const newOfferCount = row.keepaCsv?.newOfferCountCurrent || 0;
      const amazonInStockPercent = row.keepaCsv?.amazonInStockPercent90d || 0;

      const financials = calculateFinancials({
        sellPrice,
        cost: row.supplier.cost,
        bsr,
        matchSource: effectiveMatchSource,
        forceCostMissing: costMissing,
        keepaCsv: row.keepaCsv,
      });

      const failReasons = buildFailReasons({
        matchSource: effectiveMatchSource,
        sellPrice,
        bsr,
        roi: financials.roi,
        profit: financials.profit,
        hasIdentifier: Boolean(row.supplier.asin || row.supplier.barcodeCanonical),
        costMissing,
      });

      const duplicateKey = asin || row.supplier.barcodeCanonical || "";

      return {
        id: `${input.scanRunId}_${idx + 1}`,
        scanRunId: input.scanRunId,
        product: productTitle,
        asin,
        barcode: row.supplier.barcodeCanonical,
        barcodeRaw: row.supplier.barcodeRaw,
        bsr,
        bsrDrops90d,
        cost: row.supplier.cost,
        sellPrice,
        buyBox90dAvg,
        newOfferCount,
        amazonInStockPercent,
        referralFee: financials.referralFee,
        fbaFee: financials.fbaFee,
        maxBuyCost: financials.maxBuyCost,
        profit: financials.profit,
        roi: financials.roi,
        matchesCriteria: false,
        matchSource: effectiveMatchSource,
        matchConfidence: getMatchConfidence(effectiveMatchSource, liveMatchedBy),
        status: "",
        failReasons,
        duplicateKey,
        isDuplicate: false,
      } as Product;
    });

    const duplicateMap = new Map<string, number>();
    for (const row of provisional) {
      if (!row.duplicateKey) continue;
      duplicateMap.set(row.duplicateKey, (duplicateMap.get(row.duplicateKey) ?? 0) + 1);
    }

    return provisional.map((row) => {
      const isDuplicate = row.duplicateKey ? (duplicateMap.get(row.duplicateKey) ?? 0) > 1 : false;
      const failReasons = [...row.failReasons];
      if (isDuplicate) {
        failReasons.push("Duplicate identifier in input");
      }

      const matchesCriteria =
        input.scanInputMode !== "barcode_list" &&
        row.roi >= settings.minRoi &&
        row.profit >= settings.minProfit &&
        row.bsr > 0 &&
        row.bsr <= settings.maxBsr &&
        row.matchSource !== "unmatched" &&
        row.sellPrice > 0 &&
        !isDuplicate;

      const status = failReasons.length > 0 ? failReasons[0] : "Qualified";

      return {
        ...row,
        matchesCriteria,
        status,
        failReasons,
        isDuplicate,
      };
    });
  };

  const createRunSummary = (input: {
    scanRunId: string;
    startedAt: number;
    scanInputMode: ScanInputMode;
    modeLabelValue: string;
    finalized: Product[];
    summary: MatchSummary;
    inputQuality: InputQualityReport;
    estimatedApiCalls: number;
    actualApiCalls: number;
    token: TokenSnapshot;
    barcodeInputReport?: BarcodeInputReport;
  }): ScanRunSummary => ({
    id: input.scanRunId,
    createdAt: new Date(input.startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    scanInputMode: input.scanInputMode,
    modeLabel: input.modeLabelValue,
    marketplace: settings.marketplace,
    currency: settings.currency,
    supplierFileName:
      input.scanInputMode === "supplier_file" ? supplierFile?.name ?? supplierFileName : "",
    keepaExportFileName:
      input.scanInputMode === "supplier_file" ? keepaExportFile?.name ?? keepaExportFileName : "",
    totalRows: input.finalized.length,
    qualifiedRows: input.finalized.filter((row) => row.matchesCriteria).length,
    matchSummary: input.summary,
    inputQuality: input.inputQuality,
    tokenSnapshot: input.token,
    estimatedApiCalls: input.estimatedApiCalls,
    actualApiCalls: input.actualApiCalls,
    barcodeInputReport: input.barcodeInputReport,
    notes: "",
    tags: [],
  });

  const runScan = async () => {
    if (scanInputMode === "supplier_file" && !supplierFile) {
      setError("Please select a supplier file first.");
      return;
    }
    if (scanInputMode === "barcode_list" && barcodeListDiagnostics.finalCount === 0) {
      setError("Please provide at least one valid barcode to scan.");
      return;
    }

    const startedAt = Date.now();
    const scanRunId = crypto.randomUUID();

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
      deferredCandidates: 0,
      message: "Preparing queue...",
    });

    try {
      let supplierRows: SupplierRowNormalized[] = [];
      let qualityReport: InputQualityReport;
      let currentBarcodeInputReport: BarcodeInputReport | undefined;

      if (scanInputMode === "supplier_file") {
        setScanProgressText("Reading supplier file...");
        const supplierWorkbook = await parseWorkbookFromFile(supplierFile as File);
        const supplierSheet = supplierWorkbook.Sheets[supplierWorkbook.SheetNames[0]];
        supplierRows = parseSupplierRows(supplierSheet);
        qualityReport = computeInputQualityReport(supplierRows);
      } else {
        setScanProgressText("Parsing barcode list...");
        const validCodes = barcodeListParseResult.validCodes;
        currentBarcodeInputReport = {
          rawCount: barcodeListParseResult.rawCount,
          validCount: validCodes.length,
          invalidCount: barcodeListParseResult.invalidTokens.length,
          duplicatesRemoved: barcodeListParseResult.duplicatesRemoved,
          cappedCount: Math.max(0, validCodes.length - barcodeListRunCap),
        };

        supplierRows = validCodes.map((code, idx) => ({
          id: `barcode_${idx + 1}`,
          productTitle: `Barcode ${code}`,
          barcodeRaw: code,
          barcodeCanonical: code,
          asin: "",
          cost: 0,
          rowData: {
            barcode: code,
          },
        }));

        qualityReport = {
          supplierRows: supplierRows.length,
          missingIdentifierRows: 0,
          invalidAsinRows: 0,
          invalidBarcodeRows: currentBarcodeInputReport.invalidCount,
          duplicateAsinRows: 0,
          duplicateBarcodeRows: currentBarcodeInputReport.duplicatesRemoved,
        };
      }

      setBarcodeInputReport(currentBarcodeInputReport ?? null);
      setInputQualityReport(qualityReport);

      let keepaByAsin: Record<string, KeepaCsvRowNormalized> = {};
      let keepaByBarcode: Record<string, KeepaCsvRowNormalized> = {};

      if (scanInputMode === "supplier_file" && keepaExportFile) {
        setScanProgressText("Reading Keepa CSV...");
        const keepaWorkbook = await parseWorkbookFromFile(keepaExportFile);
        const keepaSheet = keepaWorkbook.Sheets[keepaWorkbook.SheetNames[0]];
        const keepaRows = parseKeepaCsvRows(keepaSheet);
        ({ keepaByAsin, keepaByBarcode } = buildKeepaCsvIndex(keepaRows));
      }

      setScanProgressText("Merging supplier rows...");
      const merged = supplierRows.map((supplier) => {
        if (scanInputMode === "barcode_list") {
          return {
            supplier,
            keepaCsv: undefined,
            matchSource: "unmatched" as MatchSource,
          };
        }

        let keepaCsvMatch: KeepaCsvRowNormalized | undefined;
        let matchSource: MatchSource = "unmatched";

        if (supplier.asin && keepaByAsin[supplier.asin]) {
          keepaCsvMatch = keepaByAsin[supplier.asin];
          matchSource = "keepa_csv_asin";
        }

        if (!keepaCsvMatch && supplier.barcodeCanonical) {
          for (const variant of barcodeVariants(supplier.barcodeCanonical)) {
            const candidate = keepaByBarcode[variant];
            if (candidate) {
              keepaCsvMatch = candidate;
              matchSource = "keepa_csv_barcode";
              break;
            }
          }
        }

        return {
          supplier,
          keepaCsv: keepaCsvMatch,
          matchSource,
        };
      });

      const unmatchedRows = merged.filter((row) => row.matchSource === "unmatched");
      const fallbackLimit =
        scanInputMode === "barcode_list" ? barcodeListRunCap : settings.maxLiveFallbackRows;
      const fallbackCandidates = unmatchedRows.slice(0, fallbackLimit);
      const fallbackCapped = Math.max(0, unmatchedRows.length - fallbackCandidates.length);
      const totalBatches = Math.ceil(
        fallbackCandidates.length / LIVE_FALLBACK_BATCH_SIZE,
      );
      const estimatedApiCalls = calcEstimatedApiCalls(fallbackCandidates.length);

      const liveByKey: Record<string, KeepaLiveEnriched> = {};
      let matchedLive = 0;
      let latestMetaText = "";
      let blockedByGuard = false;
      let deferredCandidates = fallbackCapped;
      let actualApiCalls = 0;
      let latestTokenSnapshot = EMPTY_TOKEN_SNAPSHOT;

      setQueueProgress({
        stage: "processing",
        totalCandidates: fallbackCandidates.length,
        processedCandidates: 0,
        totalBatches,
        completedBatches: 0,
        matchedLive: 0,
        deferredCandidates,
        message:
          fallbackCandidates.length > 0
            ? "Running live Keepa fallback queue..."
            : "No live fallback needed.",
      });

      for (let i = 0; i < fallbackCandidates.length; i += LIVE_FALLBACK_BATCH_SIZE) {
        const chunk = fallbackCandidates.slice(i, i + LIVE_FALLBACK_BATCH_SIZE);
        const fallbackAsins = Array.from(
          new Set(chunk.map((row) => row.supplier.asin).filter((asin) => isValidAsin(asin))),
        );
        const fallbackCodes = Array.from(
          new Set(chunk.map((row) => row.supplier.barcodeCanonical).filter(Boolean)),
        );

        if (fallbackAsins.length > 0 || fallbackCodes.length > 0) {
          const liveResult = await fetchLiveKeepa(fallbackAsins, fallbackCodes);

          if (liveResult.blockedByGuard) {
            blockedByGuard = true;
            deferredCandidates += fallbackCandidates.length - i;
            latestMetaText = "Keepa limit reached. Remaining rows deferred.";
            break;
          }

          if (liveResult.metaText) latestMetaText = liveResult.metaText;
          actualApiCalls += liveResult.apiCalls;
          latestTokenSnapshot = liveResult.tokenSnapshot;
          Object.assign(liveByKey, liveResult.byKey);

          for (const row of chunk) {
            const { match: hit } = findLiveMatchByIdentifiers(
              liveResult.byKey,
              row.supplier.asin,
              row.supplier.barcodeCanonical,
            );
            if (hit) matchedLive += 1;
          }
        }

        const processed = Math.min(fallbackCandidates.length, i + LIVE_FALLBACK_BATCH_SIZE);
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
          deferredCandidates,
          message: `Processed ${processed}/${fallbackCandidates.length} unmatched rows`,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      setTokenSnapshot(latestTokenSnapshot);
      setKeepaMetaText(latestMetaText);

      const finalized = finalizeProducts({
        scanRunId,
        scanInputMode,
        rows: merged,
        liveByKey,
      });

      const summary: MatchSummary = {
        total: finalized.length,
        csvAsin: finalized.filter((p) => p.matchSource === "keepa_csv_asin").length,
        csvBarcode: finalized.filter((p) => p.matchSource === "keepa_csv_barcode").length,
        live: finalized.filter((p) => p.matchSource === "live_keepa").length,
        unmatched: finalized.filter((p) => p.matchSource === "unmatched").length,
        fallbackAttempted: fallbackCandidates.length,
        fallbackCapped,
        fallbackDeferred: deferredCandidates,
      };

      const runSummary = createRunSummary({
        scanRunId,
        startedAt,
        scanInputMode,
        modeLabelValue: modeLabel,
        finalized,
        summary,
        inputQuality: qualityReport,
        estimatedApiCalls,
        actualApiCalls,
        token: latestTokenSnapshot,
        barcodeInputReport: currentBarcodeInputReport,
      });

      setProducts(finalized);
      setSelectedRowIds([]);
      setMatchSummary(summary);
      setScanRunSummary(runSummary);
      setQueueProgress({
        stage: "complete",
        totalCandidates: fallbackCandidates.length,
        processedCandidates: blockedByGuard
          ? fallbackCandidates.length - deferredCandidates + fallbackCapped
          : fallbackCandidates.length,
        totalBatches,
        completedBatches: blockedByGuard
          ? Math.max(0, Math.ceil((fallbackCandidates.length - deferredCandidates) / LIVE_FALLBACK_BATCH_SIZE))
          : totalBatches,
        matchedLive: finalized.filter((p) => p.matchSource === "live_keepa").length,
        deferredCandidates,
        message: blockedByGuard
          ? "Queue paused by Keepa limit. Resume from unmatched tab."
          : "Background queue complete.",
      });
      if (scanInputMode === "supplier_file") {
        setSupplierFileName((supplierFile as File).name);
        setKeepaExportFileName(keepaExportFile?.name ?? "");
      } else {
        setSupplierFileName(barcodeListFileName || "Pasted barcode list");
        setKeepaExportFileName("");
      }
      setLastRunModeLabel(modeLabel);
      setScanProgressText("Scan complete.");
      setScanModalOpen(false);

      if (settings.autoSaveServerHistory) {
        await persistServerRun(runSummary, compactProductsForSave(finalized));
        loadServerRuns();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setError(message);
      setScanProgressText("Scan failed.");
      setQueueProgress((prev) => ({
        ...prev,
        stage: "error",
        message,
      }));
    } finally {
      setLoading(false);
    }
  };

  const retryUnmatchedRows = async (targetIds?: string[]) => {
    const unmatched = products.filter(
      (product) =>
        product.matchSource === "unmatched" &&
        (targetIds ? targetIds.includes(product.id) : true),
    );

    if (unmatched.length === 0) {
      setSaveNotice("No unmatched rows selected for retry.");
      return;
    }

    const retryFallbackLimit =
      (scanRunSummary?.scanInputMode ?? scanInputMode) === "barcode_list"
        ? barcodeListRunCap
        : settings.maxLiveFallbackRows;
    const cappedUnmatched = unmatched.slice(0, retryFallbackLimit);
    const remainingDeferred = Math.max(0, unmatched.length - cappedUnmatched.length);

    setLoading(true);
    setError("");
    setQueueProgress({
      stage: "processing",
      totalCandidates: cappedUnmatched.length,
      processedCandidates: 0,
      totalBatches: Math.ceil(cappedUnmatched.length / LIVE_FALLBACK_BATCH_SIZE),
      completedBatches: 0,
      matchedLive: 0,
      deferredCandidates: remainingDeferred,
      message: "Retrying unmatched rows...",
    });

    try {
      let matchedLive = 0;
      let latestMetaText = "";
      let blockedByGuard = false;
      let actualApiCalls = 0;
      let latestTokenSnapshot = tokenSnapshot;

      const liveByProductId: Record<string, KeepaLiveEnriched> = {};

      for (let i = 0; i < cappedUnmatched.length; i += LIVE_FALLBACK_BATCH_SIZE) {
        const chunk = cappedUnmatched.slice(i, i + LIVE_FALLBACK_BATCH_SIZE);

        const asins = Array.from(
          new Set(
            chunk
              .map((row) => {
                const overrideAsin = manualOverrides[row.id]?.asin?.trim().toUpperCase();
                return overrideAsin || row.asin;
              })
              .filter((asin) => isValidAsin(asin)),
          ),
        );

        const codes = Array.from(
          new Set(
            chunk
              .map((row) => {
                const overrideBarcode = manualOverrides[row.id]?.barcode;
                return normalizeBarcode(overrideBarcode || row.barcode || row.barcodeRaw);
              })
              .filter(Boolean),
          ),
        );

        const liveResult = await fetchLiveKeepa(asins, codes);
        if (liveResult.blockedByGuard) {
          blockedByGuard = true;
          latestMetaText = "Keepa limit reached while retrying unmatched rows.";
          break;
        }

        actualApiCalls += liveResult.apiCalls;
        latestTokenSnapshot = liveResult.tokenSnapshot;
        if (liveResult.metaText) latestMetaText = liveResult.metaText;

        for (const row of chunk) {
          const overrideAsin = manualOverrides[row.id]?.asin?.trim().toUpperCase() || row.asin;
          const overrideBarcode = normalizeBarcode(
            manualOverrides[row.id]?.barcode || row.barcode || row.barcodeRaw,
          );
          const { match: hit } = findLiveMatchByIdentifiers(
            liveResult.byKey,
            overrideAsin,
            overrideBarcode,
          );
          if (hit) {
            matchedLive += 1;
            liveByProductId[row.id] = hit;
          }
        }

        const processed = Math.min(cappedUnmatched.length, i + LIVE_FALLBACK_BATCH_SIZE);
        const completedBatches = Math.ceil(processed / LIVE_FALLBACK_BATCH_SIZE);

        setQueueProgress((prev) => ({
          ...prev,
          processedCandidates: processed,
          completedBatches,
          matchedLive,
          message: `Retried ${processed}/${cappedUnmatched.length} unmatched rows`,
        }));
      }

      setKeepaMetaText(latestMetaText);
      setTokenSnapshot(latestTokenSnapshot);

      const keepaOnlyMode =
        (scanRunSummary?.scanInputMode ?? scanInputMode) === "barcode_list";

      const updated = products.map((product) => {
        const liveMatch = liveByProductId[product.id];
        if (!liveMatch) return product;

        const financials = calculateFinancials({
          sellPrice: liveMatch.sellPrice,
          cost: product.cost,
          bsr: liveMatch.bsr,
          matchSource: "live_keepa",
          forceCostMissing: keepaOnlyMode,
        });

        const failReasons = buildFailReasons({
          matchSource: "live_keepa",
          sellPrice: liveMatch.sellPrice,
          bsr: liveMatch.bsr,
          roi: financials.roi,
          profit: financials.profit,
          hasIdentifier: Boolean(product.asin || product.barcode),
          costMissing: keepaOnlyMode,
        });

        const matchesCriteria =
          !keepaOnlyMode &&
          financials.roi >= settings.minRoi &&
          financials.profit >= settings.minProfit &&
          liveMatch.bsr > 0 &&
          liveMatch.bsr <= settings.maxBsr;

        return {
          ...product,
          matchSource: "live_keepa" as MatchSource,
          matchConfidence: getMatchConfidence("live_keepa", product.asin ? "asin" : "barcode"),
          sellPrice: liveMatch.sellPrice,
          bsr: liveMatch.bsr,
          product: product.product || liveMatch.title || "Untitled",
          referralFee: financials.referralFee,
          fbaFee: financials.fbaFee,
          maxBuyCost: financials.maxBuyCost,
          profit: financials.profit,
          roi: financials.roi,
          matchesCriteria,
          status: failReasons.length > 0 ? failReasons[0] : "Qualified",
          failReasons,
        };
      });

      const nextSummary: MatchSummary = {
        total: updated.length,
        csvAsin: updated.filter((p) => p.matchSource === "keepa_csv_asin").length,
        csvBarcode: updated.filter((p) => p.matchSource === "keepa_csv_barcode").length,
        live: updated.filter((p) => p.matchSource === "live_keepa").length,
        unmatched: updated.filter((p) => p.matchSource === "unmatched").length,
        fallbackAttempted:
          (matchSummary?.fallbackAttempted ?? 0) + cappedUnmatched.length,
        fallbackCapped:
          (matchSummary?.fallbackCapped ?? 0) + Math.max(0, unmatched.length - cappedUnmatched.length),
        fallbackDeferred:
          (matchSummary?.fallbackDeferred ?? 0) +
          (blockedByGuard
            ? Math.max(0, cappedUnmatched.length - Object.keys(liveByProductId).length)
            : 0),
      };

      const nextRunSummary: ScanRunSummary | null = scanRunSummary
        ? {
            ...scanRunSummary,
            completedAt: new Date().toISOString(),
            durationMs: Math.max(
              scanRunSummary.durationMs,
              Date.now() - new Date(scanRunSummary.createdAt).getTime(),
            ),
            totalRows: updated.length,
            qualifiedRows: updated.filter((row) => row.matchesCriteria).length,
            matchSummary: nextSummary,
            tokenSnapshot: latestTokenSnapshot,
            actualApiCalls: scanRunSummary.actualApiCalls + actualApiCalls,
          }
        : null;

      setProducts(updated);
      setMatchSummary(nextSummary);
      if (nextRunSummary) setScanRunSummary(nextRunSummary);
      setQueueProgress((prev) => ({
        ...prev,
        stage: "complete",
        message: blockedByGuard
          ? "Keepa limit reached; some unmatched rows remain."
          : "Unmatched retry complete.",
      }));

      if (nextRunSummary && settings.autoSaveServerHistory) {
        await persistServerRun(nextRunSummary, compactProductsForSave(updated));
        loadServerRuns();
      }

      setSaveNotice(`Retried unmatched rows. Live matches: ${matchedLive}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unmatched retry failed";
      setError(message);
      setQueueProgress((prev) => ({
        ...prev,
        stage: "error",
        message,
      }));
    } finally {
      setLoading(false);
    }
  };

  const saveCurrentFilterPreset = () => {
    const name = presetName.trim().slice(0, 40);
    if (!name) return;

    const preset: DecisionFilterPreset = {
      id: `custom_${Date.now()}`,
      name,
      filters: decisionFilters,
    };

    setCustomFilterPresets((prev) => [preset, ...prev].slice(0, 20));
    setPresetName("");
  };

  const applyFilterPreset = (preset: DecisionFilterPreset) => {
    setDecisionFilters(preset.filters);
  };

  const clearFilters = () => {
    setDecisionFilters(DEFAULT_FILTERS);
  };

  const clearResults = () => {
    if (products.length === 0) return;
    const confirmed = window.confirm("Clear current results from this dashboard?");
    if (!confirmed) return;

    setProducts([]);
    setMatchSummary(null);
    setScanRunSummary(null);
    setInputQualityReport(null);
    setSelectedRowIds([]);
    setManualOverrides({});
    setQueueProgress({
      stage: "idle",
      totalCandidates: 0,
      processedCandidates: 0,
      totalBatches: 0,
      completedBatches: 0,
      matchedLive: 0,
      deferredCandidates: 0,
      message: "",
    });
    setTokenSnapshot(EMPTY_TOKEN_SNAPSHOT);
    setKeepaMetaText("");
    setScanProgressText("");
    setError("");
    setResultsTab("results");
    setCurrentPage(1);
    setSaveNotice("Cleared current results.");
  };

  const removeCustomPreset = (id: string) => {
    setCustomFilterPresets((prev) => prev.filter((preset) => preset.id !== id));
  };

  const downloadSelectedRows = () => {
    if (selectedProducts.length === 0) return;
    exportProductsToWorkbook(
      selectedProducts,
      `${makeSafeFileName(`selected-${new Date().toISOString()}`)}.xlsx`,
      settings.currency,
    );
  };

  const runSingleRowRetry = async (product: Product) => {
    await retryUnmatchedRows([product.id]);
  };

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          {activeView === "settings"
            ? "Dashboard Settings"
            : activeView === "saved"
              ? "Saved Scans"
              : "Dashboard"}
        </h1>
        <button
          type="button"
          role="switch"
          aria-checked={isLightMode}
          aria-label={`Switch to ${isLightMode ? "dark" : "light"} mode`}
          onClick={toggleTheme}
          className={`relative inline-flex h-8 w-16 items-center rounded-full border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
            isLightMode
              ? "justify-end border-blue-600 bg-zinc-100"
              : "justify-start border-zinc-500 bg-zinc-800"
          }`}
        >
          <span
            className={`mx-1 flex h-5 w-5 items-center justify-center rounded-full shadow-sm transition ${
              isLightMode ? "bg-white text-zinc-700" : "bg-zinc-700 text-zinc-200"
            }`}
          >
            <ThemeToggleIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
          </span>
        </button>
      </div>

      {activeView === "settings" ? (
        <DashboardSettingsPanel />
      ) : activeView === "saved" ? (
        <section className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div>
            <h2 className="mb-2 text-lg font-semibold">Local Saved Scans</h2>
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
                        {new Date(scan.createdAt).toLocaleString()} | {scan.products.length} rows |{" "}
                        {scan.modeLabel}
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
                        className={iconActionButtonClass}
                        aria-label={`Delete ${scan.name}`}
                        title="Delete scan"
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Server Scan History (Optional)</h2>
              <button type="button" onClick={loadServerRuns} className={compactActionButtonClass}>
                Refresh
              </button>
            </div>

            {serverCompare && (
              <div className="mb-3 rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                Compare latest two runs: ΔRows {serverCompare.deltaTotalRows >= 0 ? "+" : ""}
                {serverCompare.deltaTotalRows}, ΔQualified {serverCompare.deltaQualifiedRows >= 0 ? "+" : ""}
                {serverCompare.deltaQualifiedRows}, ΔAvg ROI {serverCompare.deltaAverageRoi >= 0 ? "+" : ""}
                {serverCompare.deltaAverageRoi.toFixed(2)}%, ΔAvg Profit {serverCompare.deltaAverageProfit >= 0 ? "+" : ""}
                {formatCurrency(serverCompare.deltaAverageProfit)}
              </div>
            )}

            {serverScans.length === 0 ? (
              <p className="text-sm text-zinc-400">No server scan history yet.</p>
            ) : (
              <div className="space-y-2">
                {serverScans.map((scan) => (
                  <div
                    key={scan.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-black px-3 py-2"
                  >
                    <div>
                      <p className="text-sm text-zinc-100">Run {scan.summary.id}</p>
                      <p className="text-xs text-zinc-400">
                        {new Date(scan.summary.completedAt).toLocaleString()} | {scan.summary.totalRows} rows | {scan.summary.qualifiedRows} qualified
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => loadServerScan(scan)}
                        className={compactActionButtonClass}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteServerScan(scan.id)}
                        disabled={deletingServerScanId === scan.id}
                        className={iconActionButtonClass}
                        aria-label={`Delete server run ${scan.summary.id}`}
                        title="Delete server run"
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        <>
          <p className="mb-4 inline-flex rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
            Mode: {displayModeLabel} | Marketplace: {marketplaceConfig.label}
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
              disabled={!canRunScan || loading}
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

          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total Rows" value={`${products.length}`} />
            <MetricCard
              label="Qualified"
              value={`${products.filter((product) => product.matchesCriteria).length}`}
            />
            <MetricCard
              label="Unmatched"
              value={`${products.filter((product) => product.matchSource === "unmatched").length}`}
            />
            <MetricCard
              label="API Calls"
              value={`${scanRunSummary?.actualApiCalls ?? 0} / ${scanRunSummary?.estimatedApiCalls ?? 0}`}
            />
          </div>

          <section className="mb-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-base font-semibold text-zinc-100">Scan Status</h2>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {error && (
                <StatusCard title="Error" className="md:col-span-2">
                  <p className="break-words text-sm text-red-300">{errorDisplay.summary}</p>
                  {errorDisplay.rawPayload && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setShowErrorPayload((prev) => !prev)}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 transition hover:bg-zinc-800"
                      >
                        {showErrorPayload ? "Hide details" : "Show details"}
                      </button>
                      {showErrorPayload && (
                        <pre className="mt-2 rounded-md border border-zinc-800 bg-black p-3 text-xs text-zinc-300 whitespace-pre-wrap break-all">
                          {errorDisplay.rawPayload}
                        </pre>
                      )}
                    </div>
                  )}
                </StatusCard>
              )}

              {hasScanInputDetails && (
                <StatusCard title="Scan input" className="md:col-span-2">
                  <div className="space-y-1 text-sm text-zinc-300">
                    {scanInputMode === "supplier_file" && (supplierFile || supplierFileName) && (
                      <p className="break-words">
                        Supplier: {supplierFile?.name ?? supplierFileName}
                      </p>
                    )}
                    {scanInputMode === "supplier_file" && (keepaExportFile || keepaExportFileName) && (
                      <p className="break-words">
                        Keepa CSV: {keepaExportFile?.name ?? keepaExportFileName}
                      </p>
                    )}
                    {scanInputMode === "barcode_list" && barcodeListFileName && (
                      <p className="break-words">Barcode list file: {barcodeListFileName}</p>
                    )}
                    {scanInputMode === "supplier_file" && keepaCsvStatus && (
                      <p className="break-words">{keepaCsvStatus}</p>
                    )}
                    {barcodeListStatus && <p className="break-words">{barcodeListStatus}</p>}
                  </div>
                </StatusCard>
              )}

              {keepaMetaText && (
                <StatusCard title="Keepa metadata" className="md:col-span-2">
                  <p className="break-words text-sm text-zinc-300">{keepaMetaText}</p>
                </StatusCard>
              )}

              {inputQualityReport && (
                <StatusCard title="Input quality">
                  <div className="flex flex-wrap gap-2">
                    <StatusChip label="Rows" value={`${inputQualityReport.supplierRows}`} />
                    <StatusChip
                      label="Missing IDs"
                      value={`${inputQualityReport.missingIdentifierRows}`}
                    />
                    <StatusChip
                      label="Invalid ASINs"
                      value={`${inputQualityReport.invalidAsinRows}`}
                    />
                    <StatusChip
                      label="Invalid barcodes"
                      value={`${inputQualityReport.invalidBarcodeRows}`}
                    />
                    <StatusChip
                      label="Duplicate ASIN rows"
                      value={`${inputQualityReport.duplicateAsinRows}`}
                    />
                    <StatusChip
                      label="Duplicate barcode rows"
                      value={`${inputQualityReport.duplicateBarcodeRows}`}
                    />
                  </div>
                </StatusCard>
              )}

              {barcodeInputReport && (
                <StatusCard title="Barcode input">
                  <div className="flex flex-wrap gap-2">
                    <StatusChip
                      label="Raw"
                      value={barcodeInputReport.rawCount.toLocaleString()}
                    />
                    <StatusChip
                      label="Valid"
                      value={barcodeInputReport.validCount.toLocaleString()}
                    />
                    <StatusChip
                      label="Invalid"
                      value={barcodeInputReport.invalidCount.toLocaleString()}
                    />
                    <StatusChip
                      label="Duplicates removed"
                      value={barcodeInputReport.duplicatesRemoved.toLocaleString()}
                    />
                    <StatusChip
                      label="Capped/deferred"
                      value={barcodeInputReport.cappedCount.toLocaleString()}
                    />
                  </div>
                </StatusCard>
              )}

              {scanRunSummary && (
                <StatusCard title="Run">
                  <div className="flex flex-wrap gap-2">
                    <StatusChip label="Run ID" value={scanRunSummary.id} />
                    <StatusChip
                      label="Duration"
                      value={`${(scanRunSummary.durationMs / 1000).toFixed(1)}s`}
                    />
                    <StatusChip
                      label="ASIN tokens"
                      value={`${tokenSnapshot.asinTokensLeft ?? "-"}`}
                    />
                    <StatusChip
                      label="Barcode tokens"
                      value={`${tokenSnapshot.codeTokensLeft ?? "-"}`}
                    />
                    <StatusChip
                      label="Refill"
                      value={`${tokenSnapshot.refillRate ?? "-"}/min`}
                    />
                  </div>
                </StatusCard>
              )}

              {queueProgress.totalCandidates > 0 && (
                <StatusCard title="Queue" className="md:col-span-2">
                  <div className="flex flex-wrap gap-2">
                    <StatusChip
                      label="Batches"
                      value={`${queueProgress.completedBatches}/${queueProgress.totalBatches}`}
                    />
                    <StatusChip
                      label="Rows"
                      value={`${queueProgress.processedCandidates}/${queueProgress.totalCandidates}`}
                    />
                    <StatusChip
                      label="Live matched"
                      value={`${queueProgress.matchedLive}`}
                    />
                    <StatusChip
                      label="Deferred"
                      value={`${queueProgress.deferredCandidates}`}
                    />
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded bg-zinc-800">
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
                  <p className="mt-2 break-words text-xs text-zinc-400">{queueProgress.message}</p>
                </StatusCard>
              )}

              {matchSummary && (
                <StatusCard title="Match summary">
                  <div className="flex flex-wrap gap-2">
                    <StatusChip label="Total" value={`${matchSummary.total}`} />
                    <StatusChip label="CSV ASIN" value={`${matchSummary.csvAsin}`} />
                    <StatusChip label="CSV barcode" value={`${matchSummary.csvBarcode}`} />
                    <StatusChip label="Live fallback" value={`${matchSummary.live}`} />
                    <StatusChip label="Unmatched" value={`${matchSummary.unmatched}`} />
                    <StatusChip
                      label="Fallback attempted"
                      value={`${matchSummary.fallbackAttempted}`}
                    />
                    <StatusChip label="Cap reached" value={`${matchSummary.fallbackCapped}`} />
                    <StatusChip
                      label="Deferred"
                      value={`${matchSummary.fallbackDeferred}`}
                    />
                  </div>
                </StatusCard>
              )}
            </div>
          </section>

          <section className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-100">Dashboard Filters</h2>
              <div className="flex items-center gap-2">
                <button type="button" onClick={clearFilters} className={compactActionButtonClass}>
                  Reset Filters
                </button>
                <button
                  type="button"
                  onClick={downloadSelectedRows}
                  disabled={selectedProducts.length === 0}
                  className={compactActionButtonClass}
                >
                  Export Selected ({selectedProducts.length})
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FilterInput
                label="Global Search"
                value={decisionFilters.search}
                onChange={(value) =>
                  setDecisionFilters((prev) => ({ ...prev, search: value }))
                }
                placeholder="Product, ASIN, barcode, status"
              />
              <FilterInput
                label="ASIN"
                value={decisionFilters.asin}
                onChange={(value) =>
                  setDecisionFilters((prev) => ({ ...prev, asin: value }))
                }
                placeholder="Exact or partial"
              />
              <FilterInput
                label="Barcode"
                value={decisionFilters.barcode}
                onChange={(value) =>
                  setDecisionFilters((prev) => ({ ...prev, barcode: value }))
                }
                placeholder="Digits"
              />
              <FilterInput
                label="Status contains"
                value={decisionFilters.status}
                onChange={(value) =>
                  setDecisionFilters((prev) => ({ ...prev, status: value }))
                }
                placeholder="qualified, no keepa..."
              />
              <FilterInput
                label="Min ROI (%)"
                value={decisionFilters.minRoi}
                onChange={(value) =>
                  setDecisionFilters((prev) => ({ ...prev, minRoi: value }))
                }
                placeholder="e.g. 30"
              />
              <FilterInput
                label="Min Profit"
                value={decisionFilters.minProfit}
                onChange={(value) =>
                  setDecisionFilters((prev) => ({ ...prev, minProfit: value }))
                }
                placeholder="e.g. 3"
              />
              <FilterInput
                label="Max BSR"
                value={decisionFilters.maxBsr}
                onChange={(value) =>
                  setDecisionFilters((prev) => ({ ...prev, maxBsr: value }))
                }
                placeholder="e.g. 150000"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(["keepa_csv_asin", "keepa_csv_barcode", "live_keepa", "unmatched"] as MatchSource[]).map(
                (source) => {
                  const active = decisionFilters.matchSources.includes(source);
                  return (
                    <button
                      key={source}
                      type="button"
                      onClick={() =>
                        setDecisionFilters((prev) => ({
                          ...prev,
                          matchSources: active
                            ? prev.matchSources.filter((item) => item !== source)
                            : [...prev.matchSources, source],
                        }))
                      }
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        active
                          ? "border-zinc-500 bg-zinc-700 text-zinc-100"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300"
                      }`}
                    >
                      {source}
                    </button>
                  );
                },
              )}
            </div>

            <div className="mt-4 rounded-lg border border-zinc-800 bg-black p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Save current filter as..."
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
                />
                <button type="button" onClick={saveCurrentFilterPreset} className={compactActionButtonClass}>
                  Save Preset
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {allFilterPresets.map((preset) => (
                  <div key={preset.id} className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => applyFilterPreset(preset)}
                      className={compactActionButtonClass}
                    >
                      {preset.name}
                    </button>
                    {preset.id.startsWith("custom_") && (
                      <button
                        type="button"
                        onClick={() => removeCustomPreset(preset.id)}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
                        aria-label={`Delete preset ${preset.name}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`rounded-md border px-3 py-1.5 text-sm ${
                resultsTab === "results"
                  ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
              }`}
              onClick={() => setResultsTab("results")}
            >
              Results ({visibleProducts.length})
            </button>
            <button
              type="button"
              className={`rounded-md border px-3 py-1.5 text-sm ${
                resultsTab === "unmatched"
                  ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
              }`}
              onClick={() => setResultsTab("unmatched")}
            >
              Unmatched Remediation ({unmatchedProducts.length})
            </button>
            <button
              type="button"
              onClick={clearResults}
              disabled={products.length === 0 || loading}
              className={iconActionButtonClass}
              aria-label="Clear current results"
              title="Clear current results"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
            {resultsTab === "unmatched" && (
              <button
                type="button"
                onClick={() => retryUnmatchedRows()}
                disabled={unmatchedProducts.length === 0 || loading}
                className={compactActionButtonClass}
              >
                Retry Unmatched Only
              </button>
            )}
          </div>

          {resultsTab === "unmatched" && unmatchedProducts.length > 0 && (
            <section className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <h3 className="mb-3 text-sm font-semibold text-zinc-100">Unmatched Suggestions</h3>
              <div className="space-y-3">
                {unmatchedProducts.slice(0, 50).map((product) => {
                  const suggestions = buildRemediationSuggestions(product);
                  const override = manualOverrides[product.id] ?? {
                    asin: product.asin,
                    barcode: product.barcode || product.barcodeRaw,
                  };

                  return (
                    <div
                      key={product.id}
                      className="rounded-md border border-zinc-800 bg-black px-3 py-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-zinc-100">{product.product}</p>
                        <button
                          type="button"
                          onClick={() => runSingleRowRetry(product)}
                          className={compactActionButtonClass}
                        >
                          Retry This Row
                        </button>
                      </div>
                      <p className="mb-2 text-xs text-zinc-400">Current status: {product.status}</p>
                      <p className="mb-2 text-xs text-zinc-300">Suggestions: {suggestions.join(" ")}</p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <input
                          type="text"
                          value={override.asin}
                          onChange={(e) =>
                            setManualOverrides((prev) => ({
                              ...prev,
                              [product.id]: {
                                asin: e.target.value,
                                barcode: override.barcode,
                              },
                            }))
                          }
                          placeholder="Override ASIN"
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
                        />
                        <input
                          type="text"
                          value={override.barcode}
                          onChange={(e) =>
                            setManualOverrides((prev) => ({
                              ...prev,
                              [product.id]: {
                                asin: override.asin,
                                barcode: e.target.value,
                              },
                            }))
                          }
                          placeholder="Override barcode"
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
                        />
                      </div>
                    </div>
                  );
                })}
                {unmatchedProducts.length > 50 && (
                  <p className="text-xs text-zinc-400">
                    Showing first 50 unmatched rows. Use filters to narrow further.
                  </p>
                )}
              </div>
            </section>
          )}

          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-black">
            <table className="w-full min-w-[2100px] table-fixed text-left">
              <thead className="bg-zinc-800/90">
                <tr>
                  <th className="w-[52px] p-4">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectPageRows}
                      aria-label="Select current page rows"
                    />
                  </th>
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
                {paginatedProducts.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-zinc-800 bg-black hover:bg-zinc-950/80"
                  >
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedIdSet.has(p.id)}
                        onChange={() => toggleSelectRow(p.id)}
                        aria-label={`Select ${p.product}`}
                      />
                    </td>
                    {visibleColumns.map((columnKey, idx) => {
                      const cellClass =
                        idx === 0
                          ? "p-4"
                          : "whitespace-nowrap border-l border-zinc-800 px-3 py-4";

                      if (columnKey === "product") {
                        return (
                          <td key={columnKey} className={`${cellClass} max-w-0`}>
                            {p.asin ? (
                              <a
                                href={`https://${marketplaceConfig.amazonHost}/dp/${p.asin}`}
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
                              title={p.failReasons.join(" | ") || p.status}
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
                          case "matchConfidence":
                            return `${(p.matchConfidence * 100).toFixed(0)}%`;
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

                      return (
                        <td key={columnKey} className={cellClass}>
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-black px-4 py-3 text-zinc-300">
            <p className="text-sm">
              {selectedProducts.length} of {sortedProducts.length} row(s) selected.
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={deleteSelectedRows}
                disabled={selectedProducts.length === 0}
                className={compactActionButtonClass}
              >
                Delete Selected
              </button>
              <button
                type="button"
                onClick={downloadSelectedRows}
                disabled={selectedProducts.length === 0}
                className={compactActionButtonClass}
              >
                Export Selected
              </button>
            </div>

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
                  <option value={40}>40</option>
                  <option value={80}>80</option>
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
                  {columnLayout.map((item, index) => {
                    const isLastVisibleColumn =
                      item.visible && columnLayout.filter((column) => column.visible).length === 1;

                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black px-3 py-2"
                      >
                        <div className="flex items-center gap-3 text-sm text-zinc-100">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={item.visible}
                            aria-label={`Toggle ${COLUMN_LABELS[item.key]} column visibility`}
                            onClick={() => toggleColumnVisibility(item.key)}
                            disabled={isLastVisibleColumn}
                            className="rounded-full outline-none ring-offset-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                                item.visible ? "bg-blue-500" : "bg-zinc-700"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                                  item.visible ? "translate-x-5" : "translate-x-0.5"
                                }`}
                              />
                            </span>
                          </button>
                          <span>{COLUMN_LABELS[item.key]}</span>
                        </div>

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
                    );
                  })}
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
                <h2 className="mb-4 text-xl font-semibold">Scan Files</h2>
                <p className="mb-4 text-sm text-zinc-300">
                  Choose a scan source and run Keepa matching.
                </p>

                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onScanInputModeChange("supplier_file")}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${
                      scanInputMode === "supplier_file"
                        ? "border-zinc-500 bg-zinc-700 text-zinc-100"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300"
                    }`}
                  >
                    Supplier File
                  </button>
                  <button
                    type="button"
                    onClick={() => onScanInputModeChange("barcode_list")}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${
                      scanInputMode === "barcode_list"
                        ? "border-zinc-500 bg-zinc-700 text-zinc-100"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300"
                    }`}
                  >
                    Barcode List
                  </button>
                </div>

                {scanInputMode === "supplier_file" ? (
                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-sm">Supplier File (.csv/.xlsx)</span>
                      <input
                        ref={supplierFileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={onSupplierFileChange}
                        className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-2 file:font-medium file:text-zinc-100 file:transition hover:file:bg-zinc-800"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-sm">Keepa Export CSV (optional)</span>
                      <input
                        ref={keepaFileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={onKeepaFileChange}
                        className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-2 file:font-medium file:text-zinc-100 file:transition hover:file:bg-zinc-800"
                      />
                    </label>

                    {(supplierFile || supplierFileName) && (
                      <p className="mt-1 text-sm text-zinc-300">
                        Supplier: {supplierFile?.name ?? supplierFileName}
                      </p>
                    )}
                    {(keepaExportFile || keepaExportFileName) && (
                      <p className="text-sm text-zinc-300">
                        Keepa CSV: {keepaExportFile?.name ?? keepaExportFileName}
                      </p>
                    )}
                    {keepaCsvStatus && (
                      <p className="mt-1 flex items-center gap-2 text-sm text-zinc-300">
                        {keepaCsvParsing ? <Spinner /> : null}
                        <span>{keepaCsvStatus}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-sm">
                        Paste UPC / EAN / GTIN codes (newline, comma, space, or semicolon separated)
                      </span>
                      <textarea
                        value={barcodeListInput}
                        onChange={(e) => onBarcodeListInputChange(e.target.value)}
                        rows={7}
                        placeholder={"e.g.\n5012345678901\n012345678905"}
                        className="block w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-sm">Upload barcode list (.txt/.csv)</span>
                      <input
                        ref={barcodeListFileInputRef}
                        type="file"
                        accept=".txt,.csv"
                        onChange={onBarcodeListFileChange}
                        className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-2 file:font-medium file:text-zinc-100 file:transition hover:file:bg-zinc-800"
                      />
                    </label>

                    {barcodeListFileName && (
                      <p className="text-sm text-zinc-300">File: {barcodeListFileName}</p>
                    )}
                    {barcodeListStatus && (
                      <p className="mt-1 flex items-center gap-2 text-sm text-zinc-300">
                        {barcodeListParsing ? <Spinner /> : null}
                        <span>{barcodeListStatus}</span>
                      </p>
                    )}

                    <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                      Raw: {barcodeListDiagnostics.rawCount.toLocaleString()} | Valid:{" "}
                      {barcodeListDiagnostics.validCount.toLocaleString()} | Invalid:{" "}
                      {barcodeListDiagnostics.invalidCount.toLocaleString()} | Duplicates removed:{" "}
                      {barcodeListDiagnostics.duplicatesRemoved.toLocaleString()} | Final count:{" "}
                      {barcodeListDiagnostics.finalCount.toLocaleString()} | Deferred by cap:{" "}
                      {barcodeListDiagnostics.cappedCount.toLocaleString()}
                    </div>
                    {barcodeListDiagnostics.invalidSample.length > 0 && (
                      <p className="text-xs text-zinc-400">
                        Invalid sample: {barcodeListDiagnostics.invalidSample.join(", ")}
                        {barcodeListDiagnostics.invalidCount >
                        barcodeListDiagnostics.invalidSample.length
                          ? " ..."
                          : ""}
                      </p>
                    )}
                    <p className="text-xs text-zinc-400">
                      Max {BARCODE_LIST_HARD_CAP.toLocaleString()} barcodes scanned per run in this mode.
                    </p>
                  </div>
                )}

                {scanProgressText && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-zinc-300">
                    {loading ? <Spinner /> : null}
                    <span>{scanProgressText}</span>
                  </p>
                )}

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={clearScanInputs}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 transition hover:bg-zinc-800"
                  >
                    Clear Files
                  </button>
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
                    disabled={!canRunScan || loading}
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-black px-3 py-2">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block space-y-1 text-xs text-zinc-300">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
      />
    </label>
  );
}

function StatusCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`rounded-lg border border-zinc-800 bg-black p-3 ${className}`.trim()}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h3>
      {children}
    </article>
  );
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-700 bg-black px-3 py-1 text-xs text-zinc-300">
      <span className="text-zinc-400">{label}:</span>
      <span className="break-all text-zinc-100">{value}</span>
    </span>
  );
}

function parseErrorDisplay(errorMessage: string): ErrorDisplayParts {
  const trimmed = errorMessage.trim();
  if (!trimmed) {
    return { summary: "", rawPayload: null };
  }

  const objectIndex = trimmed.indexOf("{");
  const arrayIndex = trimmed.indexOf("[");
  const payloadIndexCandidates = [objectIndex, arrayIndex].filter(
    (index) => index >= 0,
  );
  const payloadIndex =
    payloadIndexCandidates.length > 0 ? Math.min(...payloadIndexCandidates) : -1;

  if (payloadIndex >= 0) {
    const summaryPrefix = trimmed.slice(0, payloadIndex).replace(/[:\s]+$/, "").trim();
    const rawPayload = trimmed.slice(payloadIndex).trim();
    return {
      summary: summaryPrefix || "Request failed",
      rawPayload: rawPayload || null,
    };
  }

  const separatorIndex = trimmed.indexOf(": ");
  if (separatorIndex > 0 && separatorIndex < trimmed.length - 2) {
    const summary = trimmed.slice(0, separatorIndex).trim();
    const rawPayload = trimmed.slice(separatorIndex + 2).trim();
    if (summary && rawPayload) {
      return {
        summary,
        rawPayload,
      };
    }
  }

  return { summary: trimmed, rawPayload: null };
}
