"use client";

import { ChangeEvent, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { calcFeesUK, type FeeCategory } from "@/lib/fees";
import { useDashboardSettings } from "@/lib/dashboard-settings";
import { DashboardSettingsPanel } from "@/components/dashboard-settings-panel";

interface Product {
  product: string;
  asin: string;
  rawCost: number;
  cost: number;
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
  title?: string;
  stats?: {
    current?: Array<number | null>;
  };
  salesRanks?: Record<string, number[]>;
  buyBoxPrice?: number;
};

type KeepaResponse = {
  products?: KeepaProduct[];
  error?: {
    message?: string;
  };
};

const CATEGORY: FeeCategory = "OTHER";
const PRODUCT_KEYS = [
  "product",
  "productname",
  "title",
  "name",
  "itemname",
  "description",
];
const ASIN_KEYS = ["asin"];
const COST_KEYS = [
  "cost",
  "costprice",
  "suppliercost",
  "buyprice",
  "costexvat",
  "buycost",
  "purchaseprice",
  "unitcost",
];
const BSR_KEYS = ["bsr", "salesrank", "rank"];

type KeepaEnriched = {
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
  const salesRanks = product.salesRanks;
  if (!salesRanks) return 0;

  const ranks = Object.values(salesRanks).flat();
  const valid = ranks.filter((rank) => typeof rank === "number" && rank > 0);
  if (valid.length === 0) return 0;
  return Math.min(...valid);
};

export default function Page() {
  const { settings, activeView } = useDashboardSettings();
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [keepaByAsin, setKeepaByAsin] = useState<Record<string, KeepaEnriched>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const formatCurrency = (value: number) => `£${value.toFixed(2)}`;

  const fetchKeepaData = async (asins: string[]) => {
    if (asins.length === 0) {
      setKeepaByAsin({});
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/keepa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asins }),
      });

      const payload = (await response.json()) as KeepaResponse;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Keepa request failed");
      }

      const nextByAsin: Record<string, KeepaEnriched> = {};
      for (const item of payload.products ?? []) {
        if (!item.asin) continue;
        nextByAsin[item.asin] = {
          sellPrice: extractSellPrice(item) ?? 0,
          title: item.title?.trim() ?? "",
          bsr: extractBsr(item),
        };
      }

      setKeepaByAsin(nextByAsin);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch Keepa data";
      setError(message);
      setKeepaByAsin({});
    } finally {
      setLoading(false);
    }
  };

  const products: Product[] = useMemo(() => {
    return rows.map((row) => {
      const asin = findString(row, ASIN_KEYS).toUpperCase();
      const keepa = keepaByAsin[asin];
      const product = findString(row, PRODUCT_KEYS) || keepa?.title || "Untitled";
      const rawCost = findNumber(row, COST_KEYS);
      const csvBsr = findNumber(row, BSR_KEYS);
      const bsr = csvBsr || keepa?.bsr || 0;

      const vatRate = settings.vatRatePercent / 100;
      const cost = settings.vatRegistered ? rawCost / (1 + vatRate) : rawCost;
      const sellPrice = keepa?.sellPrice ?? 0;

      if (!sellPrice || cost <= 0) {
        return {
          product,
          asin,
          rawCost,
          cost,
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

      const feeBreakdown = calcFeesUK({
        sellPriceGross: sellPrice,
        category: CATEGORY,
        prepFee: settings.prepFee,
        inboundFee: settings.inboundFee,
        vat: {
          vatRegistered: settings.vatRegistered,
          vatRate,
        },
      });

      const referralFee = settings.vatRegistered
        ? feeBreakdown.referralFeeExVat
        : feeBreakdown.referralFeeGross;
      const fbaFee = settings.vatRegistered
        ? feeBreakdown.amazonFeesExVat
        : feeBreakdown.amazonFeesGross;
      const revenue = settings.vatRegistered ? feeBreakdown.sellPriceNet : sellPrice;
      const totalCost =
        cost + fbaFee + settings.prepFee + settings.inboundFee + settings.storageFee;
      const profit = revenue - totalCost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;
      const passesRoi = roi >= settings.minRoi;
      const passesProfit = profit >= settings.minProfit;
      const passesBsr = bsr > 0 && bsr <= settings.maxBsr;
      const matchesCriteria = passesRoi && passesProfit && passesBsr;

      return {
        product,
        asin,
        rawCost,
        cost,
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
  }, [rows, keepaByAsin, settings]);

  const visibleProducts = settings.onlyShowQualified
    ? products.filter((product) => product.matchesCriteria)
    : products;

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError("");

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<SheetRow>(sheet);
    setRows(jsonData);

    const asins = Array.from(
      new Set(
        jsonData
          .map((row) => findString(row, ASIN_KEYS).toUpperCase())
          .filter(Boolean),
      ),
    );
    await fetchKeepaData(asins);
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
          <p className="mb-6 text-gray-300">
            Active filters: ROI &gt;= {settings.minRoi.toFixed(1)}%, Profit &gt;= £
            {settings.minProfit.toFixed(2)}, BSR &lt;= {settings.maxBsr.toLocaleString()}
          </p>

          <div className="flex gap-4 mb-6">
            <label className="bg-gray-600 px-6 py-3 rounded cursor-pointer">
              {loading ? "Loading..." : "Choose File"}
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {fileName && <p className="mb-4 text-gray-300">Selected: {fileName}</p>}
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
                      {p.sellPrice && p.cost > 0 ? `${p.roi.toFixed(1)}%` : "-"}
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
