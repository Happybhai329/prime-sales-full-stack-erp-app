# The Prime Classes - Sales & Management Full-Stack ERP

A modern, high-performance, mobile-first full-stack web application transforming Google Apps Script spreadsheets into a responsive ERP control panel.

Built with **React 18 + Vite (SPA)**, **Express.js (Node.js)**, **PostgreSQL (Supabase)** with local **SQLite3 fallback**, and two-way **Google Sheets API v4** synchronization.

---

## Key Features

1. **Dual Database Architecture (Supabase PostgreSQL + SQLite3)**
   - Connects to Supabase PostgreSQL via connection pooling with SSL.
   - Automatically falls back to local SQLite3 (`./data/sales_dashboard.db`) if offline or unreachable.
   - Pre-indexed relational tables for sub-50ms search and filter response times.

2. **Lightning-Fast Inbound & Outbound Sync Engine**
   - High-speed chunked multi-row batch ingestion (`1,000` rows/batch) syncing active admissions, prospective enquiries, cancelled records, and master programs/fee heads in seconds.
   - Lead-to-Admission conversion matching algorithm cross-referencing normalized Student ID, 10-digit mobile, and student name.
   - Background 15-minute scheduled sync + manual instant sync (`POST /api/sync/trigger`).
   - Asynchronous outbox queue for optimistic sub-30ms local edits with background Google Sheets write-backs.

3. **Institutional Fee Breakup & Voucher Engine**
   - Exact mathematical calculation of Registration Fee, Tuition Fee, Other Fees (JSON), Discount (%), Scholarship, GST (%), and Final Payable Amount.
   - High-resolution A4 Institutional Voucher PDF generation with official "The Prime Classes" branding, itemized breakup, installment schedule, and signature block.
   - Direct Google Drive upload to institutional voucher folder and automatic `VoucherStatus` (`Given` / `Not Given`) updates in Google Sheets.

4. **Mobile-First Institutional UI**
   - Rich crimson/burgundy institutional design (`#b3132a`, `#c1121f`, `#8f1024`) with gold accents (`#f4c76c`) and glassmorphic cards.
   - Horizontal touch scrolling (`-webkit-overflow-scrolling: touch;`) with sticky headers and sticky action columns.
   - Visual JSON Form Builders for adding dynamic fee heads and scheduled installments without raw JSON editing.
   - Zero text overlap or overflow clipping on viewports down to 375px mobile screens.

---

## Directory Structure

```text
prime-sales-full-stack-erp-app/
├── public/
│   └── tpc-logo.jpg                # Official institutional logo
├── server/
│   ├── assets/
│   │   └── tpc-logo.jpg            # High-res logo for server-side PDF generator
│   ├── db.js                       # Dual PostgreSQL & SQLite database layer
│   ├── googleSheets.js             # Google Sheets API v4 & Drive connector
│   ├── syncEngine.js               # Multi-row batch sync & lead conversion matcher
│   ├── voucherGenerator.js         # Mathematical fee engine & PDF generator
│   └── index.js                    # Express REST API & SPA static server
├── src/
│   ├── components/
│   │   ├── TopNavbar.jsx           # Brand header, live sync badge & quick actions
│   │   ├── StatsOverview.jsx       # 4 Interactive KPI cards (Inquiries, Admissions, etc.)
│   │   ├── FilterControls.jsx      # Search, time filter, programs & date range pickers
│   │   ├── RecordsTable.jsx        # Touch table with sticky actions & JSON cards
│   │   ├── EditRecordModal.jsx     # Record editor with visual JSON builders
│   │   ├── VoucherModal.jsx        # Interactive fee breakup preview & PDF generator
│   │   └── SetupModal.jsx          # Academic Programs & Fee Types master modal
│   ├── styles/
│   │   └── main.css                # Mobile-first responsive CSS styling
│   ├── App.jsx                     # Root application state & toast alerts
│   └── main.jsx                    # React DOM bootstrap
├── .env.example                    # Environment configuration template
├── render.yaml                     # Render deployment blueprint
├── package.json                    # ES Modules dependencies and scripts
└── vite.config.js                  # Vite configuration & dev API proxy
```

---

## Environment Variables Configuration

Copy `.env.example` to `.env` and configure:

```env
NODE_ENV=production
PORT=10000

# Supabase PostgreSQL connection string
DATABASE_URL=postgresql://postgres.jgckdllcffnzacacqjzp:8x.3wcN%2FV9Q9Yvf@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres

# Google Sheets Spreadsheet IDs
ADMISSION_DB_ID=1StEreMtS9_mbt4Np-T0J4WK5ILwDqyxmtqwxw8ZebOA
INQUIRY_DB_ID=1Ddk1iVPuvYJehDIh3HRIIqqdc2QwJiGoq0LLmp4R_7c
VOUCHER_FOLDER_ID=1kfTAPzMOi8wM8o4AmgUrbQm8AqTAH7cN
VOUCHER_LOGO_DRIVE_FILE_ID=1esJQL-6fNQRAHdd9NWQB0lgTP7xyTx3r

# Google Cloud Service Account Credentials
GOOGLE_SERVICE_ACCOUNT_EMAIL=eod-bod-backend@standard-gcp-project-485906.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

---

## Local Development & Running

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build frontend assets:**
   ```bash
   npm run build
   ```

3. **Start the application:**
   ```bash
   npm start
   ```
   Open `http://localhost:10000` in your browser.

---

## Deploying to Render

This repository includes a pre-configured `render.yaml` blueprint.

1. Connect your repository (`Happybhai329/prime-sales-full-stack-erp-app`) on [Render](https://dashboard.render.com).
2. Create a new **Web Service**.
3. Set the following settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
4. In the **Environment Variables** tab, add your `DATABASE_URL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
5. Deploy! Render will build the Vite SPA and launch the Express server serving both the API and the front-end SPA on a single unified URL.
