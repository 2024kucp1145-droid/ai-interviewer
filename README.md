# AI Interviewer SaaS

> **Automated first-round technical screening for junior software developers (C++, Java, Python, SQL) with evidence-backed reports for recruiters. Built on a zero-cost stack with Indian accent / Hinglish support.**

---

## 🚀 Key Features

1. **Evidence-Backed Reports (Anti-Hallucination)**
   - Every skill rating (1-5) links to the exact candidate quote and turn number.
   - Built-in validation algorithm verifies quotes exist in the transcript before rendering.
   - "Human-in-the-loop" guardrail: Auto-rejection is strictly disabled; final hiring calls belong to the human recruiter.

2. **Indian Accent & Hinglish-Friendly Voice Layer**
   - Web Speech API configured for `en-IN`.
   - Push-to-Talk and live candidate answer preview with text editing before submission.
   - 100% Keyboard / Typing fallback if microphone is noisy or unsupported.
   - Speech synthesis for AI questions with live on-screen accessibility subtitles.

3. **Customer-Owned Key (BYOK) & Zero-Cost Architecture**
   - AES-256-GCM encryption vault for Google Gemini API keys. Keys never leak to frontend (only masked `****...1234` returned).
   - Zero-cost local development using SQLite, seamlessly deployable to Postgres (Supabase/Neon) for production.

4. **DPDP Act 2023 Compliance**
   - Explicit candidate notice and consent audit logging prior to interview start.
   - Minimal data retention: no raw audio files are stored, only text transcripts.
   - One-click Candidate Right to Erasure (`DELETE /candidates/:id`) with audit logs.

---

## 📁 Project Structure

```
ai-interviewer/
├── backend/
│   ├── src/
│   │   ├── ai/            # Gemini adapter + intelligent fallback simulator
│   │   ├── auth/          # JWT & bcrypt authentication
│   │   ├── db/            # SQLite schema (10 tables matching Section 5.3)
│   │   ├── interview/     # State machine & adaptive interview engine
│   │   ├── keys/          # AES-256-GCM encryption vault
│   │   ├── reports/       # Report generator & evidence validator
│   │   └── server.js      # Express REST API & static server
├── frontend/
│   └── public/
│       ├── index.html     # Recruiter dashboard & landing page
│       ├── interview.html # Candidate interview room & consent portal
│       └── js/            # Client controllers & voice manager
├── prompts/
│   ├── interviewer.txt    # English technical interviewer system prompt
│   └── report.txt         # JSON schema hiring report prompt
├── tests/
│   ├── mock_transcripts.json
│   └── run_tests.js       # Automated test suite
└── package.json
```

---

## ⚡ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional)
Check `.env` (a default secure master encryption key is already configured):
```env
PORT=3001
JWT_SECRET=your_jwt_secret
ENCRYPTION_MASTER_KEY=e83a9f1b4c7d0e2f5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f
GEMINI_API_KEY=your_optional_gemini_key
```

### 3. Run Tests
```bash
npm test
```

### 4. Start the Application
```bash
npm start
```

Access the application in your browser:
- **Recruiter Dashboard**: [http://localhost:3001](http://localhost:3001)
- **Candidate Room**: generated securely via Recruiter Dashboard (e.g. `http://localhost:3001/interview.html?token=...`)
- **Health Check**: [http://localhost:3001/health](http://localhost:3001/health)
