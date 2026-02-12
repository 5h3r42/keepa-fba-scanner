"use client";

import { ChangeEvent, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useDashboardSettings } from "@/lib/dashboard-settings";
import { DashboardSettingsPanel } from "@/components/dashboard-settings-panel";

interface Product {
  product: string;
  asin: string;
  barcode: string;
  rawCost: number;
  cost: number;
  calcCost: number;
  bsr: number;
  sellPrice: number;
  referralFee: number;
  fbaFee: number;
  prepFee: number;
  storageFee: number;
  profit: number;
  roi: number;
  matchesCriteria: boolean;
}

type SheetRow = Record<string, string | number | null | undefined>;

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
const COST_EX_VAT_KEYS = ["costexvat", "costwithoutvat", "exvatcost"];
const COST_GROSS_KEYS = COST_KEYS.filter(
  (key) => !COST_EX_VAT_KEYS.includes(key),
);
const BSR_KEYS = ["bsr", "salesrank", "rank"];

type KeepaEnriched = {
  asin: string;
  sellPrice: number;
  title: string;
  bsr: number;
};

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

const toNumber = (value: unknown): number => {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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

const normalizeBarcode = (value: unknown): string => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^[0-9]{8,14}$/.test(digits) ? digits : "";
};

const findNumber = (row: SheetRow, keys: string[]): number => {
  const normalized = normalizeRow(row);
  for (const key of keys) {
    const value = normalized[normalizeKey(key)];
    const num = toNumber(value);
    if (num > 0) {
      return num;
    }
  }
  return 0;
};

const findNumberFromNormalized = (
  normalized: Record<string, unknown>,
  keys: string[],
): number => {
  for (const key of keys) {
    const value = normalized[normalizeKey(key)];
    const num = toNumber(value);
    if (num > 0) {
      return num;
    }
  }
  return 0;
};

const resolveCost = (row: SheetRow): { displayCost: number; calcCost: number } => {
  const normalized = normalizeRow(row);

  // If sheet has explicit ex-VAT cost, use it directly.
  const exVatCost = findNumberFromNormalized(normalized, COST_EX_VAT_KEYS);
  if (exVatCost > 0) {
    return { displayCost: exVatCost, calcCost: exVatCost };
  }

  // Default behavior: treat entered cost as calculation-ready (ex-VAT for VAT sellers).
  const grossCost = findNumberFromNormalized(normalized, COST_GROSS_KEYS);
  if (grossCost > 0) {
    return { displayCost: grossCost, calcCost: grossCost };
  }

  return { displayCost: 0, calcCost: 0 };
};

const isSupplierSeparatorRow = (values: string[]): boolean => {
  const trimmed = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (trimmed.length < 3) return false;
  return new Set(trimmed).size === 1;
};

const parseSheetRows = (sheet: XLSX.WorkSheet): SheetRow[] => {
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

const extractProductCodes = (product: KeepaProduct): string[] => {
  const codeCandidates = [
    ...(product.eanList ?? []),
    ...(product.upcList ?? []),
    product.ean,
    product.upc,
    product.gtin,
  ];
  const uniqueCodes = new Set<string>();
  for (const candidate of codeCandidates) {
    const normalized = normalizeBarcode(candidate);
    if (normalized) {
      uniqueCodes.add(normalized);
    }
  }
  return Array.from(uniqueCodes);
};

const extractSellPrice = (product: KeepaProduct): number | null => {
  if (typeof product.buyBoxPrice === "number" && product.buyBoxPrice > 0) {
    return product.buyBoxPrice / 100;
  }

  const candidates = product.stats?.current;
  if (!candidates || !Array.isArray(candidates)) {
    return null;
  }

  const preferredIndexes = [18, 1, 7, 0, 10, 3, 8];
  for (const index of preferredIndexes) {
    const value = candidates[index];
    if (typeof value === "number" && value > 0) {
      return value / 100;
    }
  }

  return null;
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

export default function Page() {
  const { settings, activeView } = useDashboardSettings();
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [keepaByKey, setKeepaByKey] = useState<Record<string, KeepaEnriched>>({});
  const [keepaMetaText, setKeepaMetaText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const formatCurrency = (value: number) => `£${value.toFixed(2)}`;

  const fetchKeepaData = async (asins: string[], barcodes: string[]) => {
    if (asins.length === 0 && barcodes.length === 0) {
      setKeepaByKey({});
      return;
    }

    setLoading(true);
    setError("");
    setKeepaMetaText("");

    try {
      const response = await fetch("/api/keepa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asins, codes: barcodes }),
      });

      const payload = (await response.json()) as KeepaResponse;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Keepa request failed");
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
      setKeepaMetaText(metaParts.join(" | "));

      const nextByKey: Record<string, KeepaEnriched> = {};
      for (const item of payload.products ?? []) {
        const asin = item.asin?.trim().toUpperCase();
        if (!asin) continue;
        const enriched: KeepaEnriched = {
          asin,
          sellPrice: extractSellPrice(item) ?? 0,
          title: item.title?.trim() ?? "",
          bsr: extractBsr(item),
        };
        nextByKey[asin] = enriched;

        const matchedCode = normalizeBarcode(item.matchedCode);
        if (matchedCode) {
          nextByKey[matchedCode] = enriched;
        }

        for (const code of extractProductCodes(item)) {
          nextByKey[code] = enriched;
        }
      }

      setKeepaByKey(nextByKey);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch Keepa data";
      setError(message);
      setKeepaByKey({});
      setKeepaMetaText("");
    } finally {
      setLoading(false);
    }
  };

  const products: Product[] = useMemo(() => {
    return rows.map((row) => {
      const asinFromRow = findString(row, ASIN_KEYS).toUpperCase();
      const barcode = normalizeBarcode(findString(row, BARCODE_KEYS));
      const keepa =
        (asinFromRow ? keepaByKey[asinFromRow] : undefined) ||
        (barcode ? keepaByKey[barcode] : undefined);
      const asin = asinFromRow || keepa?.asin || "";
      const product = findString(row, PRODUCT_KEYS) || keepa?.title || "Untitled";
      const rawCost = findNumber(row, COST_KEYS);
      const csvBsr = findNumber(row, BSR_KEYS);
      const bsr = csvBsr || keepa?.bsr || 0;

      const vatRate = settings.vatRatePercent / 100;
      const { displayCost: cost, calcCost } = resolveCost(row);
      const sellPrice = keepa?.sellPrice ?? 0;

      if (!sellPrice || calcCost <= 0) {
        return {
          product,
          asin,
          barcode,
          rawCost,
          cost,
          calcCost,
          bsr,
          sellPrice: 0,
          referralFee: 0,
          fbaFee: 0,
          prepFee: settings.prepFee,
          storageFee: settings.storageFee,
          profit: 0,
          roi: 0,
          matchesCriteria: false,
        };
      }

      const referralFee = sellPrice * (settings.referralRatePercent / 100);
      const fbaFee = settings.fulfilmentFee;
      const amazonFeeBase =
        referralFee +
        settings.perItemFee +
        settings.variableClosingFee +
        settings.fulfilmentFee;
      const digitalServicesFee =
        amazonFeeBase * (settings.digitalServicesFeePercent / 100);
      const amazonFeesTotal = amazonFeeBase + digitalServicesFee;
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
      const passesRoi = roi >= settings.minRoi;
      const passesProfit = profit >= settings.minProfit;
      const passesBsr = bsr > 0 && bsr <= settings.maxBsr;
      const matchesCriteria = passesRoi && passesProfit && passesBsr;

      return {
        product,
        asin,
        barcode,
        rawCost,
        cost,
        calcCost,
        bsr,
        sellPrice,
        referralFee,
        fbaFee,
        prepFee: settings.prepFee,
        storageFee: settings.storageFee,
        profit,
        roi,
        matchesCriteria,
      };
    });
  }, [rows, keepaByKey, settings]);

  const visibleProducts = settings.onlyShowQualified
    ? products.filter((product) => product.matchesCriteria)
    : products;

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError("");

    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const workbook = isCsv
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = parseSheetRows(sheet);
    setRows(jsonData);

    const asins = Array.from(
      new Set(
        jsonData
          .map((row) => findString(row, ASIN_KEYS).toUpperCase())
          .filter(Boolean),
      ),
    );
    const barcodes = Array.from(
      new Set(
        jsonData
          .map((row) => normalizeBarcode(findString(row, BARCODE_KEYS)))
          .filter(Boolean),
      ),
    );
    await fetchKeepaData(asins, barcodes);
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
          <div className="flex gap-4 mb-6">
            <label className="bg-gray-600 px-6 py-3 rounded cursor-pointer">
              {loading ? "Loading..." : "Choose File"}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {fileName && <p className="mb-4 text-gray-300">Selected: {fileName}</p>}
          {keepaMetaText && <p className="mb-4 text-blue-200">{keepaMetaText}</p>}
          {error && <p className="mb-4 text-red-300">{error}</p>}

          <div className="bg-[#1f2e45] rounded overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left table-fixed">
              <thead className="bg-[#26364f]">
                <tr>
                  <th className="p-4 w-[42%]">Product</th>
                  <th className="px-3 py-4 w-[11%]">ASIN</th>
                  <th className="px-3 py-4 w-[7%]">BSR</th>
                  <th className="px-3 py-4 w-[8%]">Cost</th>
                  <th className="px-3 py-4 w-[9%]">Sell Price</th>
                  <th className="px-3 py-4 w-[9%]">Referral Fee</th>
                  <th className="px-3 py-4 w-[8%]">Profit</th>
                  <th className="px-3 py-4 w-[8%]">ROI</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((p, index) => (
                  <tr key={index} className="border-t border-gray-600">
                    <td className="p-4 max-w-0">
                      <span className="block truncate" title={p.product}>
                        {p.product}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 border-l border-[#314562]">
                      {p.asin}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">{p.bsr || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-4">{formatCurrency(p.cost)}</td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {p.sellPrice ? formatCurrency(p.sellPrice) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {p.referralFee ? formatCurrency(p.referralFee) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {p.sellPrice ? formatCurrency(p.profit) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {p.sellPrice && p.calcCost > 0 ? `${p.roi.toFixed(1)}%` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
