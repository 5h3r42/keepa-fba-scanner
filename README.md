# Keepa FBA Scanner

A Next.js app for wholesale sourcing decisions with:
- Supplier file ingestion (`.csv`, `.xlsx`)
- Barcode-list ingestion (paste or `.txt`/`.csv` upload)
- Keepa CSV merge + live Keepa fallback
- Marketplace-aware lookups (UK/US/EU)
- Profit/ROI scoring with configurable fee and VAT settings
- Decision console filters, presets, row selection, and bulk export
- Unmatched remediation with retry and manual identifier overrides
- Local saved scans and optional server-backed scan history

## Tech Stack
- Next.js App Router
- React + TypeScript
- Tailwind CSS
- `xlsx` for spreadsheet parsing/export

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure env in `.env.local`:
   ```bash
   KEEPA_API_KEY=your_keepa_key

   # Optional: secure proxy routes with a shared token
   KEEPA_PROXY_TOKEN=your_internal_proxy_token

   # Optional: allow browser client to send token to /api/keepa
   NEXT_PUBLIC_KEEPA_PROXY_TOKEN=your_internal_proxy_token

   # Optional: Keepa proxy requests per minute per client
   KEEPA_PROXY_RPM=40
   ```
3. Start dev server:
   ```bash
   npm run dev
   ```

## Key Features

### 1) Scan Modes
- **CSV-first + live fallback queue**: uses Keepa CSV first, then live API for unmatched rows
- **Live-only**: no Keepa CSV provided, uses live lookups
- **Barcode list live scan**: paste/upload UPC/EAN/GTIN list and run direct live Keepa lookup (up to 2,500 per run)

### 2) Token-Aware Queue Controls
- Configurable max live fallback rows (`maxLiveFallbackRows`)
- Token budget modes: `off`, `warn`, `hard_stop`
- Hard stop threshold (`tokenHardLimit`) to defer remaining rows

### 3) Decision Console
- Global search/filter across product, ASIN, barcode, status
- Numeric thresholds: min ROI, min profit, max BSR
- Match source chips (`keepa_csv_asin`, `keepa_csv_barcode`, `live_keepa`, `unmatched`)
- Saved custom filter presets
- Row selection and bulk export of selected rows

### 4) Unmatched Remediation
- Dedicated unmatched tab
- Suggestions for identifier issues
- Manual ASIN/barcode override per row
- Retry unmatched rows only

### 5) Marketplace Support
- Marketplace setting drives:
  - Keepa domain
  - Amazon product link host
  - Currency formatting defaults

### 6) Persistence
- **Local browser storage**:
  - Current scan snapshot
  - Saved scans
  - Column layout
  - Custom filter presets
- **Optional server-backed history** (`/api/scans`):
  - Save scan runs with summary and compacted rows
  - Fetch/open previous runs
  - Compare two runs (`/api/scans?compare=<id1>,<id2>`)

## API Routes

### `POST /api/keepa`
Proxy to Keepa with protections:
- optional token auth (`x-keepa-proxy-token`)
- per-client rate limiting
- payload size limits
- timeout + retry + backoff
- basic circuit breaker

Body:
```json
{
  "asins": ["B000000000"],
  "codes": ["5012345678901"],
  "marketplace": "UK",
  "tokenGuard": {
    "mode": "hard_stop",
    "hardLimit": 100
  }
}
```

### `GET /api/keepa`
Query equivalent for debugging:
- `asin`, `code`, `marketplace`, `tokenMode`, `tokenHardLimit`

### `GET /api/scans`
- List server-backed scans
- `includeProducts=1` to include row payloads
- `compare=<id1>,<id2>` for run delta summary

### `POST /api/scans`
Persist scan summary + products.

### `GET /api/scans/[id]`
Load a specific persisted scan.

### `PATCH /api/scans/[id]`
Update scan notes/tags.

## Development Commands
```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Notes
- Keepa token usage is variable and depends on request patterns and upstream behavior.
- Server-backed scan history is file-based in `.data/scan-history.json` for lightweight local deployment.
- For production, use durable storage (database/object store) and stronger auth.
