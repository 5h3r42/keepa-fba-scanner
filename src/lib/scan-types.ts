import type { CurrencyCode, Marketplace } from "@/lib/marketplace";

export type MatchSource =
  | "keepa_csv_asin"
  | "keepa_csv_barcode"
  | "live_keepa"
  | "unmatched";

export type Product = {
  id: string;
  scanRunId: string;
  product: string;
  asin: string;
  barcode: string;
  barcodeRaw: string;
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
  matchConfidence: number;
  status: string;
  failReasons: string[];
  duplicateKey: string;
  isDuplicate: boolean;
};

export type MatchSummary = {
  total: number;
  csvAsin: number;
  csvBarcode: number;
  live: number;
  unmatched: number;
  fallbackAttempted: number;
  fallbackCapped: number;
  fallbackDeferred: number;
};

export type TokenBudgetMode = "off" | "warn" | "hard_stop";

export type InputQualityReport = {
  supplierRows: number;
  missingIdentifierRows: number;
  invalidAsinRows: number;
  invalidBarcodeRows: number;
  duplicateAsinRows: number;
  duplicateBarcodeRows: number;
};

export type TokenSnapshot = {
  asinTokensLeft: number | null;
  codeTokensLeft: number | null;
  refillRate: number | null;
};

export type ScanInputMode = "supplier_file" | "barcode_list";

export type BarcodeInputReport = {
  rawCount: number;
  validCount: number;
  invalidCount: number;
  duplicatesRemoved: number;
  cappedCount: number;
};

export type ScanRunSummary = {
  id: string;
  createdAt: string;
  completedAt: string;
  durationMs: number;
  scanInputMode: ScanInputMode;
  modeLabel: string;
  marketplace: Marketplace;
  currency: CurrencyCode;
  supplierFileName: string;
  keepaExportFileName: string;
  totalRows: number;
  qualifiedRows: number;
  matchSummary: MatchSummary;
  inputQuality: InputQualityReport;
  tokenSnapshot: TokenSnapshot;
  estimatedApiCalls: number;
  actualApiCalls: number;
  barcodeInputReport?: BarcodeInputReport;
  notes: string;
  tags: string[];
};

export type KeepaRequestCostMeta = {
  requestId: string;
  marketplace: Marketplace;
  requestedAsins: number;
  requestedCodes: number;
  apiCalls: number;
  durationMs: number;
  startedAt: string;
  blockedByGuard: boolean;
};

export type KeepaResponseMeta = {
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
  requestCost?: KeepaRequestCostMeta;
};

export type KeepaProduct = {
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

export type KeepaResponse = {
  products?: KeepaProduct[];
  keepaMeta?: KeepaResponseMeta;
  error?: string | { message?: string };
};

export type ScanHistoryRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  summary: ScanRunSummary;
  products: Product[];
};

export type ScanCompareResult = {
  baseScanId: string;
  targetScanId: string;
  deltaTotalRows: number;
  deltaQualifiedRows: number;
  deltaAverageRoi: number;
  deltaAverageProfit: number;
};
