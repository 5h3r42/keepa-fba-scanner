"use client";

import { ChangeEvent, useMemo, useState } from "react";
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

type MatchSummary = {
  total: number;
  csvAsin: number;
  csvBarcode: number;
  live: number;
  unmatched: number;
  fallbackAttempted: number;
  fallbackCapped: number;
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

export default function Page() {
  const { settings, activeView, scanModalOpen, setScanModalOpen } =
    useDashboardSettings();

  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [keepaExportFile, setKeepaExportFile] = useState<File | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
  const [keepaMetaText, setKeepaMetaText] = useState("");
  const [keepaCsvStatus, setKeepaCsvStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const formatCurrency = (value: number) => `£${value.toFixed(2)}`;

  const modeLabel = keepaExportFile
    ? "CSV-first + live fallback (cap 100)"
    : "Live-only (no Keepa CSV provided)";

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
    if (!supplierFile) return;

    setLoading(true);
    setError("");
    setKeepaMetaText("");
    setProducts([]);
    setMatchSummary(null);

    try {
      const supplierWorkbook = await parseWorkbookFromFile(supplierFile);
      const supplierSheet = supplierWorkbook.Sheets[supplierWorkbook.SheetNames[0]];
      const supplierRows = parseSupplierRows(supplierSheet);

      let keepaByAsin: Record<string, KeepaCsvRowNormalized> = {};
      let keepaByBarcode: Record<string, KeepaCsvRowNormalized> = {};

      if (keepaExportFile) {
        const keepaWorkbook = await parseWorkbookFromFile(keepaExportFile);
        const keepaSheet = keepaWorkbook.Sheets[keepaWorkbook.SheetNames[0]];
        const keepaRows = parseKeepaCsvRows(keepaSheet);
        ({ keepaByAsin, keepaByBarcode } = buildKeepaCsvIndex(keepaRows));
      }

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
      const fallbackCandidates = unmatchedRows.slice(0, 100);
      const fallbackCapped = Math.max(0, unmatchedRows.length - fallbackCandidates.length);

      const fallbackAsins = Array.from(
        new Set(
          fallbackCandidates
            .map((row) => row.supplier.asin)
            .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)),
        ),
      );
      const fallbackCodes = Array.from(
        new Set(
          fallbackCandidates
            .map((row) => row.supplier.barcodeCanonical)
            .filter(Boolean),
        ),
      );

      const liveResult = await fetchLiveKeepa(fallbackAsins, fallbackCodes);
      setKeepaMetaText(liveResult.metaText);

      const finalized = merged.map((row) => {
        const liveMatch =
          row.matchSource === "unmatched"
            ? liveResult.byKey[row.supplier.asin] ||
              liveResult.byKey[row.supplier.barcodeCanonical]
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
      setScanModalOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setError(message);
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
  };

  const onKeepaFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setKeepaExportFile(file);
    setKeepaCsvStatus("");
    if (!file) return;

    try {
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
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">
        {activeView === "settings"
          ? "Dashboard Settings"
          : "Amazon FBA ROI Dashboard (UK Accurate Fees)"}
      </h1>

      {activeView === "settings" ? (
        <DashboardSettingsPanel />
      ) : (
        <>
          <p className="mb-3 text-sm text-blue-200">Mode: {modeLabel}</p>

          <div className="mb-4">
            <button
              type="button"
              onClick={() => setScanModalOpen(true)}
              className="bg-blue-600 px-5 py-3 rounded"
            >
              Open Scan Window
            </button>
          </div>

          {supplierFile && (
            <p className="mb-1 text-gray-300">Supplier: {supplierFile.name}</p>
          )}
          {keepaExportFile && (
            <p className="mb-1 text-gray-300">Keepa CSV: {keepaExportFile.name}</p>
          )}
          {keepaCsvStatus && <p className="mb-1 text-blue-200">{keepaCsvStatus}</p>}
          {keepaMetaText && <p className="mb-3 text-blue-200">{keepaMetaText}</p>}
          {error && <p className="mb-3 text-red-300">{error}</p>}

          {matchSummary && (
            <div className="mb-4 rounded border border-[#2b4569] bg-[#173259] px-4 py-3 text-sm">
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

          <div className="bg-[#1f2e45] rounded overflow-x-auto">
            <table className="w-full min-w-[1900px] text-left table-fixed">
              <thead className="bg-[#26364f]">
                <tr>
                  <th className="p-4 w-[20%]">
                    <SortHeader label="Product" icon={sortIcon("product")} onClick={() => toggleSort("product")} />
                  </th>
                  <th className="px-3 py-4 w-[9%] border-l border-[#3a4f6f]">
                    <SortHeader label="Barcode" icon={sortIcon("barcode")} onClick={() => toggleSort("barcode")} />
                  </th>
                  <th className="px-3 py-4 w-[8%] border-l border-[#3a4f6f]">
                    <SortHeader label="ASIN" icon={sortIcon("asin")} onClick={() => toggleSort("asin")} />
                  </th>
                  <th className="px-3 py-4 w-[10%] border-l border-[#3a4f6f]">
                    <SortHeader label="Match Source" icon={sortIcon("matchSource")} onClick={() => toggleSort("matchSource")} />
                  </th>
                  <th className="px-3 py-4 w-[11%] border-l border-[#3a4f6f]">
                    <SortHeader label="Status" icon={sortIcon("status")} onClick={() => toggleSort("status")} />
                  </th>
                  <th className="px-3 py-4 w-[5%] border-l border-[#3a4f6f]">
                    <SortHeader label="BSR" icon={sortIcon("bsr")} onClick={() => toggleSort("bsr")} />
                  </th>
                  <th className="px-3 py-4 w-[6%] border-l border-[#3a4f6f]">
                    <SortHeader label="BSR Drops 90d" icon={sortIcon("bsrDrops90d")} onClick={() => toggleSort("bsrDrops90d")} />
                  </th>
                  <th className="px-3 py-4 w-[5%] border-l border-[#3a4f6f]">
                    <SortHeader label="Cost" icon={sortIcon("cost")} onClick={() => toggleSort("cost")} />
                  </th>
                  <th className="px-3 py-4 w-[6%] border-l border-[#3a4f6f]">
                    <SortHeader label="Sell Price" icon={sortIcon("sellPrice")} onClick={() => toggleSort("sellPrice")} />
                  </th>
                  <th className="px-3 py-4 w-[6%] border-l border-[#3a4f6f]">
                    <SortHeader label="Buy Box 90d Avg" icon={sortIcon("buyBox90dAvg")} onClick={() => toggleSort("buyBox90dAvg")} />
                  </th>
                  <th className="px-3 py-4 w-[6%] border-l border-[#3a4f6f]">
                    <SortHeader label="New Offers" icon={sortIcon("newOfferCount")} onClick={() => toggleSort("newOfferCount")} />
                  </th>
                  <th className="px-3 py-4 w-[6%] border-l border-[#3a4f6f]">
                    <SortHeader label="Amazon In Stock %" icon={sortIcon("amazonInStockPercent")} onClick={() => toggleSort("amazonInStockPercent")} />
                  </th>
                  <th className="px-3 py-4 w-[6%] border-l border-[#3a4f6f]">
                    <SortHeader label="Referral Fee" icon={sortIcon("referralFee")} onClick={() => toggleSort("referralFee")} />
                  </th>
                  <th className="px-3 py-4 w-[5%] border-l border-[#3a4f6f]">
                    <SortHeader label="FBA Fee" icon={sortIcon("fbaFee")} onClick={() => toggleSort("fbaFee")} />
                  </th>
                  <th className="px-3 py-4 w-[6%] border-l border-[#3a4f6f]">
                    <SortHeader label="Max Buy Cost" icon={sortIcon("maxBuyCost")} onClick={() => toggleSort("maxBuyCost")} />
                  </th>
                  <th className="px-3 py-4 w-[5%] border-l border-[#3a4f6f]">
                    <SortHeader label="Profit" icon={sortIcon("profit")} onClick={() => toggleSort("profit")} />
                  </th>
                  <th className="px-3 py-4 w-[5%] border-l border-[#3a4f6f]">
                    <SortHeader label="ROI" icon={sortIcon("roi")} onClick={() => toggleSort("roi")} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((p, index) => (
                  <tr key={`${p.barcode}-${p.asin}-${index}`} className="border-t border-gray-600">
                    <td className="p-4 max-w-0">
                      <span className="block truncate" title={p.product}>
                        {p.product}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">{p.barcode || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">{p.asin || "-"}</td>
                    <td className="px-3 py-4 border-l border-[#314562]">
                      <span className="block truncate" title={p.matchSource}>
                        {p.matchSource}
                      </span>
                    </td>
                    <td className="px-3 py-4 border-l border-[#314562]">
                      <span className="block truncate" title={p.status}>
                        {p.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">{p.bsr || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">{p.bsrDrops90d || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">{formatCurrency(p.cost)}</td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.sellPrice ? formatCurrency(p.sellPrice) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.buyBox90dAvg ? formatCurrency(p.buyBox90dAvg) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.newOfferCount || "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.amazonInStockPercent ? `${p.amazonInStockPercent.toFixed(0)}%` : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.referralFee ? formatCurrency(p.referralFee) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.fbaFee ? formatCurrency(p.fbaFee) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.maxBuyCost ? formatCurrency(p.maxBuyCost) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.sellPrice ? formatCurrency(p.profit) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.sellPrice && p.cost > 0 ? `${p.roi.toFixed(1)}%` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {scanModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
              <div className="w-full max-w-xl rounded-xl border border-[#2c4467] bg-[#132b50] p-6 shadow-2xl">
                <h2 className="text-xl font-semibold mb-4">Scan Files</h2>
                <p className="text-sm text-blue-200 mb-4">
                  Add supplier and Keepa files, then run scan.
                </p>

                <div className="space-y-3">
                  <label className="block">
                    <span className="block text-sm mb-1">Supplier File (.csv/.xlsx)</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={onSupplierFileChange}
                      className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-[#2f4b72] file:px-3 file:py-2 file:text-white"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-sm mb-1">Keepa Export CSV (optional)</span>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={onKeepaFileChange}
                      className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-[#2f4b72] file:px-3 file:py-2 file:text-white"
                    />
                  </label>
                </div>

                {supplierFile && (
                  <p className="mt-3 text-sm text-gray-300">Supplier: {supplierFile.name}</p>
                )}
                {keepaExportFile && (
                  <p className="text-sm text-gray-300">Keepa CSV: {keepaExportFile.name}</p>
                )}
                {keepaCsvStatus && <p className="mt-2 text-sm text-blue-200">{keepaCsvStatus}</p>}

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setScanModalOpen(false)}
                    className="rounded bg-[#253f64] px-4 py-2 text-sm"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={runScan}
                    disabled={!supplierFile || loading}
                    className="rounded bg-blue-600 px-4 py-2 text-sm disabled:bg-blue-900 disabled:cursor-not-allowed"
                  >
                    {loading ? "Scanning..." : "Run Scan"}
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
      className="w-full flex items-center justify-between gap-2 text-left"
    >
      <span>{label}</span>
      <span className="text-[12px] text-[#b7c6db]">{icon}</span>
    </button>
  );
}
