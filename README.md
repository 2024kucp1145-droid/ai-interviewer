<div align="center">

# RoundOne AI

**Autonomous Technical Screening Platform for High-Velocity Engineering Teams**

*Conversational Voice AI • 4,111+ Sandboxed Coding Problems • Multi-Factor Proctoring • Evidence-Backed Reports*

[![Live Website](https://img.shields.io/badge/Live_Website-adivy.tech-2563eb?style=for-the-badge)](https://www.adivy.tech)
[![Node.js](https://img.shields.io/badge/Node.js-22+-10b981?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/SQLite_%2B_PostgreSQL-Supabase-3b82f6?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![MCP](https://img.shields.io/badge/MCP-Server_Ready-8b5cf6?style=for-the-badge)](./mcp)

</div>

---

## 🌐 Overview

**RoundOne AI** automates first-round technical screening for software engineering teams. Companies can register their organization, create custom interview rounds, invite candidates via email/WhatsApp/QR or a branded Careers Portal, and receive **evidence-backed evaluation reports** with zero bias.

- **Live Platform**: [https://www.adivy.tech](https://www.adivy.tech)
- **Recruiter Dashboard & Landing**: `/` ([`index.html`](frontend/public/index.html))
- **Candidate Interview Room**: `/interview.html?token=<token>` ([`interview.html`](frontend/public/interview.html))
- **Results & Merit Rankings**: `/results.html?job=<jobId>` ([`results.html`](frontend/public/results.html))
- **Public Branded Careers Portal**: `/careers.html` ([`careers.html`](frontend/public/careers.html))
- **Shareable Candidate Report**: `/share.html` ([`share.html`](frontend/public/share.html))
- **Pricing & Plans**: `/pricing.html` ([`pricing.html`](frontend/public/pricing.html))
- **Engineering Blog**: `/blog.html` ([`blog.html`](frontend/public/blog.html))
- **Admin Console**: `/admin.html` ([`admin.html`](frontend/public/admin.html))

---

## 🚀 Key Platform Features

### 1. Autonomous Voice AI & Hinglish Support
- **Indian Accent & Hinglish-Friendly**: Web Speech API configured for `en-IN` paired with Edge TTS (`node-edge-tts`) and live accessibility subtitles.
- **Push-to-Talk & Live Preview**: Candidates can review and edit transcribed answers before submitting, with a **100% Keyboard / Typing fallback** if no microphone is available.
- **Adaptive Interview Engine**: Dynamic follow-up questioning based on candidate responses, resume parsing (`pdf-parse`), and selected difficulty level.

### 2. Sandboxed Code Runner & 4,111+ Question Bank
- **Multi-Language Execution**: Supports JavaScript, Python, SQL, C++, Java, and more with configurable time/memory limits (`dsa_time_limit_ms`, `dsa_memory_limit_mb`).
- **Dual Assessment Modes**: **Complete Solution** (`solve`) and **Fix Buggy Code** (`fix_bug`) workflows, plus custom organization-authored coding & SQL problems (`/org/problems`).
- **Server-Side Evaluation**: Verifies test cases, runtime, and memory metrics directly in the candidate scorecard.

### 3. Multi-Factor Anti-Cheat & Forensic Proctoring
- **Continuous Camera Timeline**: Captures baseline identity and periodic heartbeat snapshots.
- **Automated Violation Detection**: Flags phone/electronic device detection, multiple persons, candidate absence, tab-switching/screen exit, DevTools attempts, and paste bursts.
- **Proctoring Integrity Trust Score**: Computes a 0–100 integrity rating with a filterable snapshot lightbox in the audit modal.

### 4. Evidence-Backed Reports (Anti-Hallucination)
- **Quote-Verified Scoring**: Every skill rating (1–5) links to the exact candidate quote and turn index from the transcript.
- **On-the-Fly Auto-Recovery**: Completed interviews automatically generate missing evaluation reports when viewed (`GET /interviews/:id/report`).
- **Human-in-the-Loop Guardrail**: Auto-rejection is disabled; recruiters control final `selected` / `borderline` / `rejected` cutoffs and export rosters to **CSV**, **JSON**, or printable **PDF**.

### 5. Company Branding, Team RBAC & Webhooks
- **Organization Onboarding & Profile**: Companies register with their brand name, website, and industry—displayed across candidate invites, proctoring rooms, results headers, and audit reports.
- **Role-Based Access Control (RBAC)**: Invite team members as `owner`, `recruiter`, or `reviewer`.
- **Outbound Webhooks**: Real-time event delivery with delivery logs and testing.
- **Expiring Share Links**: Generate time-limited public links to share candidate scorecards with hiring panels.

### 6. Security, BYOK & DPDP Act 2023 Compliance
- **Modern Authentication**: Supports **Supabase OAuth**, **Passkeys**, **Magic Link**, Email/Password, and **CAPTCHA protection** alongside a **Dual-Theme (Dark / Light) UI**.
- **AES-256-GCM BYOK Vault**: Bring Your Own Google Gemini API key—encrypted at rest; only the last 4 masked characters (`****...1234`) are ever exposed.
- **Hybrid Persistence**: Local SQLite (`better-sqlite3`, 29 tables) with 2-way live synchronization to **Supabase** (Auth, PostgreSQL, Storage, OAuth).
- **DPDP Act 2023 Ready**: Explicit candidate consent logging prior to interview start, zero raw audio storage, and one-click Right to Erasure (`DELETE /candidates/:id`).

### 7. Flexible Billing & MCP Integration
- **Plans**: 10 Free Trials, Pay-As-You-Go ($0.50 / ₹42 per interview), Starter ($49 / ₹4,100), and Enterprise tiers with Stripe, Razorpay, and direct 0%-fee UPI/Bank Transfer support.
- **Model Context Protocol (MCP) Server**: Exposes platform capabilities to AI agents via stdio (`npm run mcp`) or HTTP (`npm run mcp:http`).

---

## 📁 Project Structure

```text
ai-interviewer/
├── backend/
│   └── src/
│       ├── admin/         # Platform admin console APIs & metrics
│       ├── ai/            # Google Gemini adapter + adaptive fallback engine
│       ├── auth/          # JWT, bcrypt, OTP & Supabase OAuth integration
│       ├── billing/       # Stripe, Razorpay & UPI/Bank credit management
│       ├── db/            # SQLite schema (29 tables) & Postgres migration scripts
│       ├── interview/     # State machine & adaptive interview orchestration
│       ├── keys/          # AES-256-GCM BYOK encryption vault
│       ├── middleware/    # Auth, RBAC & security guards
│       ├── reports/       # Report generator & anti-hallucination quote validator
│       ├── services/      # Supabase 2-way live sync, email & dispatch services
│       ├── usage/         # Credit & usage tracking
│       └── server.js      # Express REST API & static asset server
├── frontend/
│   └── public/
│       ├── css/           # Shared stylesheets & themes
│       ├── img/           # Illustrations & UI assets
│       ├── js/            # Dashboard, interview, voice & proctoring controllers
│       ├── index.html     # Landing page & Recruiter Dashboard
│       ├── interview.html # Candidate interview, voice & coding room
│       ├── results.html   # Merit rankings, custom cutoffs & AI audit modal
│       ├── careers.html   # Public branded company careers portal
│       ├── share.html     # Expiring shareable candidate report view
│       ├── pricing.html   # Plans & checkout page
│       ├── blog.html      # Engineering blog & content hub
│       ├── admin.html     # Admin management console
│       ├── privacy.html   # Privacy & DPDP compliance notice
│       └── terms.html     # Terms of service
├── mcp/                   # Model Context Protocol (MCP) server
├── prompts/               # Interviewer & structured report system prompts
├── scripts/               # Utility & maintenance scripts
├── tests/                 # Automated test suite (Vault, DB, Validator, AI, MCP, PG)
├── Dockerfile             # Production container image (Node 22 Bookworm Slim)
└── package.json
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js 20+** (Node 22 recommended)
- **npm**

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy `.env.example` to `.env` and update values as needed:
```bash
cp .env.example .env
```

Key variables (see [`.env.example`](.env.example) for the full list):
```env
PORT=3001
JWT_SECRET=your_jwt_secret
ENCRYPTION_MASTER_KEY=e83a9f1b4c7d0e2f5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f
GEMINI_API_KEY=your_optional_gemini_key

# Optional: Supabase & PostgreSQL
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Optional: Email (Gmail SMTP or Resend) & Payments (Stripe / Razorpay / UPI)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
```

### 4. Run Automated Tests
```bash
npm test
```

### 5. Start the Server
```bash
npm start
```
*(For development with hot-reload: `npm run dev`)*

---

## 📜 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm start` | Start the production Express server (`backend/src/server.js`) |
| `npm run dev` | Start the server with Node `--watch` mode |
| `npm test` | Run core test suite (Encryption Vault, SQLite Schema, Evidence Validator, AI Engine) |
| `npm run mcp` | Start the MCP server in stdio mode |
| `npm run mcp:http` | Start the MCP server in HTTP mode |
| `npm run mcp:test` | Run MCP server tests |
| `npm run db:migrate:pg` | Migrate SQLite schema & data to PostgreSQL |
| `npm run db:test:pg` | Run PostgreSQL connectivity & schema tests |

---

## 🐳 Docker Deployment

```bash
docker build -t roundone-ai .
docker run -p 3001:3001 --env-file .env roundone-ai
```

Access locally:
- **Recruiter Dashboard**: [http://localhost:3001](http://localhost:3001)
- **Health Check**: [http://localhost:3001/health](http://localhost:3001/health)
