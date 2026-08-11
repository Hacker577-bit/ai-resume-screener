# 🎯 AI Resume Screener

An intelligent, AI-powered resume screening system. Upload resumes (PDF / DOCX / TXT),
paste a job description, and get **extracted skills, transparent match scores, and a
ranked candidate list** — with an AI Score Dashboard and CSV/PDF export.

Built for **Task 1 — Intelligent Resume Screening System**. Demonstrates Python, NLP,
OCR-awareness, text processing, and AI pipelines.

![tiers](https://img.shields.io/badge/engine-tiered-6366f1) ![python](https://img.shields.io/badge/python-3.12%2B-3776ab) ![deploy](https://img.shields.io/badge/deploy-Vercel-black)

---

## ✨ Features

**Core**
- 📤 Resume upload — PDF, DOCX, TXT (drag & drop, multi-file)
- 📝 Text extraction — digital PDFs (pdfplumber), DOCX tables & paragraphs, with **OCR fallback**
- 🧠 Skill identification — curated 150+ skill taxonomy with alias & fuzzy matching
- 📊 Resume scoring — transparent composite of skill coverage + TF-IDF similarity + keywords
- 🎯 Job matching — required-skill coverage and matched/missing breakdown
- 🏆 Candidate ranking — sorted, ranked table with per-signal detail

**Upgrades**
- 🤖 NLP-based skill extraction (spaCy noun-chunks when available)
- 🔍 Keyword matching (TF-IDF salient terms)
- 📈 AI Score Dashboard (score distribution + signal-breakdown charts)
- 💾 Export results — CSV and styled PDF report
- 🧩 Optional **LLM enhancement** (Groq / Claude) — semantic scoring + written rationale

---

## 🏗️ Tiered AI engine

The engine detects its capabilities **at runtime** and degrades gracefully — one codebase
runs fully locally *and* deploys slim to serverless.

| Tier | Requires | Adds |
|------|----------|------|
| **1 · Baseline** | always on | taxonomy + fuzzy skill match, hand-rolled TF-IDF cosine, keyword match |
| **2 · Rich offline** | `spacy` / `scikit-learn` importable | spaCy phrase extraction, sklearn TF-IDF |
| **3 · LLM** | `GROQ_API_KEY` (primary) or `ANTHROPIC_API_KEY` | semantic score, matched/missing skills, rationale |

No keys? It still works — Tiers 1–2 run offline. Add a `GROQ_API_KEY` and every candidate
gets an AI rationale and a blended score.

---

## 🚀 Quick start (local)

> Use **Python 3.13** locally for the full rich-offline stack (spaCy wheels aren't
> reliably available on 3.14 yet).

```bash
# 1. Create the venv (Windows: py -3.13 ; macOS/Linux: python3.13)
py -3.13 -m venv .venv
source .venv/Scripts/activate      # Windows Git Bash
# source .venv/bin/activate        # macOS/Linux

# 2. Install the full local stack
pip install -r requirements-local.txt
python -m spacy download en_core_web_sm   # optional — enables Tier 2 phrases

# 3. Configure secrets
cp .env.example .env
# edit .env and set GROQ_API_KEY=... (optional; leave blank to run fully offline)

# 4. Run
uvicorn app.main:app --reload
```

Open **http://127.0.0.1:8000** → paste a JD (or click *Load sample JD*), drop in the
sample resumes from `tests/fixtures/`, and hit **Screen Candidates**.

Check active tiers any time: **http://127.0.0.1:8000/api/health**

---

## 🧪 Tests

```bash
pip install pytest
pytest
```

Covers extraction, taxonomy/fuzzy skill matching, scoring math, and end-to-end ranking
(all offline — no API key required).

---

## ☁️ Deploy to Vercel

`vercel.json` routes everything to the FastAPI ASGI app in `api/index.py`. Vercel installs
the **slim** `requirements.txt` (no spaCy/sklearn) so the bundle stays small — the app runs
Tier 1 + Tier 3 (Groq) in production.

```bash
npm i -g vercel          # or use npx
vercel                   # preview deploy
vercel env add GROQ_API_KEY   # set the key as an encrypted env var
vercel --prod            # production deploy
```

---

## 📁 Project structure

```
app/            FastAPI backend
  config.py     settings + runtime tier detection
  extraction.py PDF/DOCX/TXT text extraction + OCR fallback
  skills.py     taxonomy + fuzzy + spaCy skill extraction
  scoring.py    TF-IDF cosine, skill coverage, keyword, composite
  engine.py     orchestrator: extract → score → (LLM) → rank
  ai_groq.py    Groq LLM (primary Tier 3)
  ai_claude.py  Claude LLM (optional Tier 3)
  export.py     CSV + PDF export
  data/skills.json   curated skill taxonomy
api/index.py    Vercel serverless entrypoint (re-exports app)
web/            static frontend (drag-drop, dashboard, table, export)
tests/          pytest suite + sample fixtures
```

---

## 🔐 A note on secrets & OCR

- **Never commit `.env`.** It's git-ignored; only `.env.example` is tracked. Set keys as
  encrypted env vars on Vercel.
- **OCR** for scanned/image PDFs needs the system **Tesseract** binary plus
  `pytesseract` + `pdf2image` (commented in `requirements-local.txt`). Without them, the app
  detects a scanned PDF and returns a clear warning instead of failing.

## 🛠️ Skills demonstrated

`Python` · `NLP` · `OCR-awareness` · `Text Processing` · `AI Pipelines` · `FastAPI` · `TF-IDF` · `LLM integration`
