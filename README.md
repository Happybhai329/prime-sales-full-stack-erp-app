# 💼 The Prime Classes — Sales & Admissions ERP Platform (`prime-sales-full-stack-erp-app`)

> **An enterprise-grade, full-stack Sales ERP, Admissions Pipeline, and Google Sheets Migration Suite** engineered for **The Prime Classes** to replace legacy Google Apps Script workflows with a high-performance **PostgreSQL**, **Prisma**, **Express**, and **React 19** architecture.

<div align="center">

[![Node.js](https://img.shields.io/badge/Node.js-%3E=20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.19-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.12-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.1-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Swagger](https://img.shields.io/badge/Swagger-OpenAPI_3.0-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)](https://swagger.io/)

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Database Schema & Entity Relationships](#-database-schema--entity-relationships)
- [Sequential Student ID Engine](#-sequential-student-id-engine)
- [Google Sheets to PostgreSQL ETL Migration](#-google-sheets-to-postgresql-etl-migration)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Getting Started & Installation](#-getting-started--installation)
- [Environment Variables](#-environment-variables)
- [Running the Application](#-running-the-application)
- [API Documentation & Swagger](#-api-documentation--swagger)
- [Contributing](#-contributing)
- [License](#-license)
- [Author](#-author)

---

## 🌟 Overview

**The Prime Classes Sales ERP** is a full-stack platform designed to modernize the institutional sales, admission intake, inquiry management, and tuition fee processing for **The Prime Classes** coaching institute (specializing in **RIMC**, **RMS**, and **AISSEE Sainik School** entrance coaching).

Historically reliant on slow, fragile Google Sheets and Google Apps Script triggers that suffered from race conditions, cell limits, and lack of relational integrity, this project rebuilds the foundation from scratch:
- **Relational PostgreSQL Engine**: Backed by **Prisma ORM** with 11 domain models, atomic transactions, and strict foreign keys.
- **Transactional ETL Migration Pipeline**: Zero-data-loss migration script that imports existing records from Google Sheets with schema validation, duplicate detection, and detailed JSON reporting.
- **Modern React 19 Frontend**: Fast, responsive sales agent workspace built with **Vite 8**, **TanStack Table**, and **TanStack Query**.
- **Financial & Installment Processing**: Handles multi-component fees (registration, tuition, GST, scholarships, discounts), automated payment installment schedules, and PDF voucher generation.

---

## 🚀 Key Features

### 🎓 Admissions & Enrollment Management
- **Complete Biographical Capture**: Detailed student records, target academic program, parent contact info, defense service status, category/caste, and verification document links.
- **Sequential Student ID Generation**: Concurrency-safe atomic student ID counter generating standardized institutional registration numbers (`YYMMCCXXXX`).
- **Student Status Transitions**: Manage `ACTIVE` and `CANCELLED` student states with full audit trail logging.

### 📞 Sales Inquiry & Lead Funnel
- **Inquiry Capture**: Log incoming student leads, mobile numbers, and target programs.
- **Conversion Tracking**: Transition qualified inquiries directly into full admissions.

### 💳 Financial & Installment Engine
- **Flexible Fee Components**: Dynamic fee breakdown including Registration Fee, Tuition Fee, GST %, Scholarships, and Concession Discounts.
- **Installment Schedules**: Automated installment schedule generation (`PENDING` / `PAID`) linked directly to student admissions.
- **Payment Reconciliation**: Log payment transactions across multiple payment modes (CASH, UPI, CHEQUE, BANK_TRANSFER) with reference numbers and receipt tracking.
- **PDF Admission Vouchers**: Dynamic vector PDF generation for admission receipts and student vouchers via **PDFKit**.

### 👥 Role-Based Access Control (RBAC) & Security
- **4 Granular Roles**: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, and `SALES`.
- **Stateless JWT Flow**: Dual-token authentication (Access Token + rotating Refresh Tokens stored in PostgreSQL).
- **Hardened Security**: Helmet security headers, CORS origin whitelisting, Winston JSON logging, and Express Rate Limiter.

### 🔄 Google Sheets Migration & Sync Engine
- **Transactional Migration (`scripts/import-google-sheets.ts`)**: Imports historical admissions and inquiries with dry-run verification mode and `migration-report.json` auditing.
- **Incremental Sync (`scripts/sync-google-sheets.ts`)**: Bi-directional data sync keeping Google Sheets updated with PostgreSQL changes.
- **Automated Database Backup (`scripts/backup.ts`)**: Single-command database snapshot and export tool.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Clients["Frontend Clients"]
        AgentUI["Sales Agent Portal (React 19 + Vite 8)"]
        SwaggerDoc["Swagger UI Documentation (/api-docs)"]
    end

    subgraph Server["Express 4 REST Backend (:5000)"]
        Security["Helmet • CORS • Rate Limiter • Winston"]
        AuthMiddleware["JWT Auth Guard & RBAC (Role Enums)"]
        Validation["Zod Request Payload Validators"]
        
        subgraph Controllers["API Domain Controllers"]
            AdmissionCtrl["Admissions & Student ID Generator"]
            InquiryCtrl["Inquiries & Lead Funnel"]
            FeeCtrl["Fee Structure & Installments"]
            PaymentCtrl["Payment Reconciliation"]
            VoucherCtrl["PDF Voucher Generator (PDFKit)"]
        end
    end

    subgraph Data["Database & Migration Layer"]
        PrismaORM["Prisma ORM 5.12"]
        Postgres[("PostgreSQL 16 Database")]
        ETLWorker["ETL Import Worker (scripts/import-google-sheets.ts)"]
    end

    subgraph Legacy["Google Cloud / Workspace"]
        GSheets[("Google Spreadsheets\n(Admissions & Inquiries)")]
    end

    AgentUI -->|HTTPS / REST| Security
    SwaggerDoc -->|Inspect Endpoints| Security
    Security --> AuthMiddleware
    AuthMiddleware --> Validation
    Validation --> Controllers

    Controllers --> PrismaORM
    PrismaORM --> Postgres

    ETLWorker -->|Service Account JWT| GSheets
    ETLWorker -->|Batch Inserts| Postgres
```

---

## 🛠️ Tech Stack

| Domain | Technology | Version | Purpose |
|---|---|---|---|
| **Backend Framework** | [Express.js](https://expressjs.com/) | `^4.19.2` | REST API routing, controllers, and middleware |
| **Runtime & Language** | [Node.js](https://nodejs.org/) & [TypeScript](https://www.typescriptlang.org/) | `>= 20.x` / `5.4.5` | Strict static typing and modern ES execution |
| **ORM** | [Prisma](https://www.prisma.io/) | `^5.12.1` | Type-safe queries, migrations, and schema modeling |
| **Database** | [PostgreSQL](https://www.postgresql.org/) | `16` | Relational database with transactional consistency |
| **Validation** | [Zod](https://zod.dev/) | `^3.22.4` | Runtime schema validation for request payloads |
| **Authentication** | [jsonwebtoken](https://jwt.io/) & [bcrypt](https://github.com/kelektiv/node.bcrypt.js) | `^9.0.2` / `^5.1.1` | Salted password hashing & dual-token JWT auth |
| **Frontend Framework** | [React 19](https://react.dev/) + [Vite 8](https://vitejs.dev/) | `^19.2.7` / `^8.1.1` | High-performance SPA frontend (located in `client/`) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) | `^4.3.2` | Utility-first CSS engine with `@tailwindcss/vite` |
| **State & Tables** | TanStack Query 5 & TanStack Table 8 | `^5.101` / `^8.21` | Server-state caching and high-density data tables |
| **PDF Generation** | [PDFKit](https://pdfkit.org/) | `^0.19.1` | Vector PDF generation for admission receipts & vouchers |
| **API Docs** | [Swagger UI Express](https://swagger.io/) | `^5.0.0` | Interactive OpenAPI 3.0 documentation |
| **Google Cloud** | [googleapis](https://github.com/googleapis/google-api-nodejs-client) | `^140.0.1` | Google Sheets API v4 ETL data ingestion |
| **Logging** | [Winston](https://github.com/winstonjs/winston) | `^3.13.0` | Structured JSON application & error logging |

---

## 🗄️ Database Schema & Entity Relationships

The Prisma schema defines 11 interconnected relational models:

```
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│     Program      │◄──────│    Admission     │──────►│   Installment    │
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (UUID)        │       │ id (UUID)        │       │ id (UUID)        │
│ name             │       │ studentId (uniq) │       │ admissionId      │
└────────┬─────────┘       │ studentName      │       │ dueDate          │
         │                 │ mobileNumber     │       │ amount           │
         │                 │ dateOfApplication│       │ status (PEND/PD) │
         ▼                 │ registrationFee  │       └──────────────────┘
┌──────────────────┐       │ tuitionFee       │       ┌──────────────────┐
│     Enquiry      │       │ discountPercent  │──────►│     Voucher      │
├──────────────────┤       │ scholarshipAmount│       ├──────────────────┤
│ id (UUID)        │       │ gstPercent       │       │ id (UUID)        │
│ studentName      │       │ finalCost        │       │ admissionId      │
│ mobileNumber     │       │ status (ACT/CAN) │       │ pdfUrl           │
│ academicProgramId│       └────────┬─────────┘       │ status (GIV/NOT) │
└──────────────────┘                │                 └──────────────────┘
                                    ├────────────────►┌──────────────────┐
                                    │                 │     Payment      │
                                    ▼                 ├──────────────────┤
                           ┌──────────────────┐       │ id (UUID)        │
                           │   AdmissionFee   │       │ admissionId      │
                           ├──────────────────┤       │ amount           │
                           │ admissionId      │       │ paymentMethod    │
                           │ feeTypeId        │       │ referenceNo      │
                           │ amount           │       │ receiptUrl       │
                           └────────┬─────────┘       └──────────────────┘
                                    ▼
                           ┌──────────────────┐
                           │     FeeType      │
                           ├──────────────────┤
                           │ id (UUID)        │
                           │ name             │
                           │ defaultAmount    │
                           └──────────────────┘
```

---

## 🔢 Sequential Student ID Engine

Student IDs are automatically formatted according to the institutional pattern:

$$\text{Student ID} = \text{YY} + \text{MM} + \text{CC} + \text{XXXX}$$

- $\text{YY}$: Current two-digit year (e.g. `26` for 2026)
- $\text{MM}$: Current two-digit month (e.g. `07` for July)
- $\text{CC}$: Institute Campus/Center Code (`00` for Head Office)
- $\text{XXXX}$: Atomic 4-digit sequential zero-padded counter (`0001`, `0002`, ...)

Maintained atomically using the `StudentIdCounter` model to prevent collisions during concurrent admissions.

---

## 🔄 Google Sheets to PostgreSQL ETL Migration

The repository includes a production-ready, transactional ETL pipeline ([`scripts/import-google-sheets.ts`](scripts/import-google-sheets.ts)):

### 1. Configure Credentials
Place your Google Cloud Service Account JSON key in the root directory (e.g. `service-account.json`) and share your target Google Sheets with the service account email.

### 2. Run Dry-Run Verification
Tests connectivity, downloads spreadsheet ranges, validates data constraints, and outputs a diagnostic summary without making database changes:

```bash
npm run migrate -- --dry-run
```

### 3. Execute Production Migration
Applies transactions and loads all historical programs, admissions, inquiries, and fee records into PostgreSQL:

```bash
npm run migrate
```

### 4. Migration Report (`migration-report.json`)
The script generates a comprehensive migration audit report detailing:
- Total programs and fee types registered.
- Total admissions imported (active vs. cancelled).
- Total inquiries loaded.
- Duplicate and skipped row count.
- Detailed validation failure log (row numbers and specific field errors).

---

## 📂 Project Structure

```text
prime-sales-full-stack-erp-app/
├── client/                              # React 19 + Vite 8 Sales Frontend
│   ├── src/                             # React components, hooks, and API clients
│   │   ├── components/                  # Tables, modals, filters, and form inputs
│   │   └── App.tsx                      # Main frontend entrypoint
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
├── prisma/
│   ├── migrations/                      # Prisma PostgreSQL migration history
│   └── schema.prisma                    # Complete 11-model relational schema
├── scripts/
│   ├── backup.ts                        # Automated database backup utility
│   ├── import-google-sheets.ts          # Google Sheets to PostgreSQL ETL migration
│   └── sync-google-sheets.ts            # Incremental bi-directional sync worker
├── src/                                 # Express Backend Source Code
│   ├── config/                          # Database connection, logger, and env config
│   ├── controllers/                     # Admissions, Inquiries, Payments, Auth controllers
│   ├── middleware/                      # Auth guards, role checks, error handlers, rate limiters
│   ├── routes/                          # REST API versioned endpoints (/api/v1)
│   ├── services/                        # Business logic, student ID counter, PDF generation
│   ├── utils/                           # Formatters, Zod schemas, and response helpers
│   ├── app.ts                           # Express app configuration & middleware
│   └── server.ts                        # Server entry point & port binding
├── .env.example                         # Environment configuration template
├── migration-report.json                # Migration execution metrics report
├── package.json                         # Backend dependencies & npm scripts
├── tsconfig.json                        # TypeScript configuration
└── README.md                            # Comprehensive project documentation
```

---

## 📋 Prerequisites

Before running the platform locally, ensure you have:

- **Node.js**: `>= 20.0.0` (LTS recommended)
- **npm**: `>= 9.0.0` (or `pnpm` / `bun`)
- **PostgreSQL**: `v15` or `v16` (local instance or cloud database such as [Supabase](https://supabase.com/) / [Neon](https://neon.tech/))
- *(Optional)* **Google Cloud Service Account**: Required only if running Google Sheets ETL migration scripts.

---

## ⚙️ Getting Started & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/Happybhai329/prime-sales-full-stack-erp-app.git
cd prime-sales-full-stack-erp-app
```

### 2. Install Backend Dependencies
```bash
npm install
```

### 3. Install Frontend Dependencies
```bash
cd client
npm install
cd ..
```

### 4. Configure Environment Variables
Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

---

## 🔧 Environment Variables

Configure `.env` with your database and authentication secrets:

```env
# Application Settings
NODE_ENV=development
PORT=5000
API_PREFIX=/api/v1

# PostgreSQL Database (Prisma)
DATABASE_URL="postgresql://postgres:password@localhost:5432/sales_erp?schema=public"

# JWT Authentication Secrets
JWT_ACCESS_SECRET="your_secure_access_token_secret_min_32_chars"
JWT_REFRESH_SECRET="your_secure_refresh_token_secret_min_32_chars"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# Google Cloud Service Account (For Migration ETL)
GOOGLE_SERVICE_ACCOUNT_KEY_PATH="service-account.json"
ADMISSION_SPREADSHEET_ID="your_admissions_google_sheet_id"
INQUIRY_SPREADSHEET_ID="your_inquiries_google_sheet_id"

# SMTP Configuration (Optional for email alerts)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=notifications@primeclasses.in
SMTP_PASS=your_app_password
```

---

## 🏃 Running the Application

### 1. Generate Prisma Client & Run Migrations
```bash
npm run prisma:generate
npm run prisma:migrate
```

### 2. Start Backend Server
```bash
npm run dev
```
The Express API will start on **[http://localhost:5000](http://localhost:5000)**.

### 3. Start Frontend Client
In a second terminal:
```bash
cd client
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser.

### 4. Open Prisma Studio (Database GUI)
```bash
npm run prisma:studio
```
Access Prisma Studio at **[http://localhost:5555](http://localhost:5555)**.

---

## 📡 API Documentation & Swagger

Interactive OpenAPI 3.0 documentation is available when running locally:

```
http://localhost:5000/api-docs
```

### Core API Endpoints (`/api/v1`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Authenticate sales representative / admin |
| `POST` | `/api/v1/auth/refresh` | Rotate refresh token and issue new access token |
| `GET` | `/api/v1/admissions` | List admissions with filters, search, and pagination |
| `POST` | `/api/v1/admissions` | Create a new student admission & generate sequential ID |
| `GET` | `/api/v1/admissions/:id` | Fetch full admission details, fees, and installments |
| `GET` | `/api/v1/admissions/:id/voucher` | Generate downloadable PDF admission voucher |
| `GET` | `/api/v1/inquiries` | List all student leads and inquiries |
| `POST` | `/api/v1/inquiries` | Record a new student inquiry |
| `POST` | `/api/v1/payments` | Record a fee payment transaction |

---

## 🤝 Contributing

Contributions and enhancements are welcome!

1. Fork the Repository
2. Create a Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: Add amazing feature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Proprietary — Developed for **The Prime Classes**. All rights reserved.

---

---

## 👤 Author & Maintainer

**Happy Bhasin**  
*Full Stack & AI Engineer* | Amity University Madhya Pradesh (B.Tech CSE with Minor in AI/ML)  

- 🌐 **GitHub:** [@Happybhai329](https://github.com/Happybhai329)  
- 💼 **LinkedIn:** [Happy Bhasin](https://www.linkedin.com/in/happy-bhasin-908191267)  
- 📧 **Email:** [bhasinhappy0506@gmail.com](mailto:bhasinhappy0506@gmail.com)  
- 📱 **Phone:** +91 9220553665  
- 📍 **Location:** India (Open to Remote & Global Relocation)  

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
