"""Configuration & runtime capability detection.

The screener runs in three tiers that are detected at import time:

    Tier 1 (baseline) — always available. Pure-Python skill matching + a
        hand-rolled TF-IDF cosine similarity. No heavy deps.
    Tier 2 (rich offline) — enabled when spaCy and/or scikit-learn import
        successfully. Adds linguistic skill extraction + a real TF-IDF vectorizer.
    Tier 3 (LLM) — enabled when GROQ_API_KEY (primary) or ANTHROPIC_API_KEY
        (optional) is present. Adds semantic scoring + written rationale.

Nothing here raises if an optional dependency is missing; callers read the
boolean flags and degrade gracefully. This is what lets one codebase run fully
locally (Python 3.13, all tiers) and slim on Vercel (Tier 1 + Tier 3).
"""
from __future__ import annotations

import importlib.util
import os
from functools import lru_cache
from pathlib import Path

try:  # Load .env if python-dotenv is installed (local dev). Harmless if absent.
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:  # pragma: no cover - dotenv is optional
    pass


def _module_available(name: str) -> bool:
    """True if `name` can be imported without actually importing it."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):  # pragma: no cover
        return False


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


class Settings:
    """Resolved configuration + capability flags (singleton via get_settings)."""

    def __init__(self) -> None:
        # --- Keys (Tier 3) ---
        self.groq_api_key: str = os.environ.get("GROQ_API_KEY", "").strip()
        self.groq_model: str = os.environ.get("GROQ_MODEL", "").strip() or "llama-3.3-70b-versatile"
        self.anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        self.anthropic_model: str = os.environ.get("ANTHROPIC_MODEL", "").strip() or "claude-opus-5"

        # --- Scoring weights ---
        self.weight_skills: float = _env_float("WEIGHT_SKILLS", 0.5)
        self.weight_similarity: float = _env_float("WEIGHT_SIMILARITY", 0.3)
        self.weight_keywords: float = _env_float("WEIGHT_KEYWORDS", 0.2)
        self.llm_blend: float = _env_float("LLM_BLEND", 0.5)

        # --- Server ---
        self.max_upload_mb: int = _env_int("MAX_UPLOAD_MB", 10)

        # --- Capability detection ---
        self.has_spacy: bool = _module_available("spacy")
        self.has_sklearn: bool = _module_available("sklearn")
        self.has_groq: bool = bool(self.groq_api_key) and _module_available("groq")
        self.has_anthropic: bool = bool(self.anthropic_api_key) and _module_available("anthropic")
        # OCR needs both the python wrapper and the system tesseract binary.
        self.has_ocr: bool = _module_available("pytesseract") and _module_available("pdf2image")

    # --- Derived views -----------------------------------------------------
    @property
    def llm_active(self) -> bool:
        return self.has_groq or self.has_anthropic

    @property
    def primary_llm(self) -> str | None:
        if self.has_groq:
            return "groq"
        if self.has_anthropic:
            return "anthropic"
        return None

    @property
    def normalized_weights(self) -> tuple[float, float, float]:
        """Skills/similarity/keywords weights normalized to sum to 1.0."""
        total = self.weight_skills + self.weight_similarity + self.weight_keywords
        if total <= 0:
            return (0.5, 0.3, 0.2)
        return (
            self.weight_skills / total,
            self.weight_similarity / total,
            self.weight_keywords / total,
        )

    def capabilities(self) -> dict:
        """Machine-readable tier report for /api/health and the dashboard."""
        return {
            "tier1_baseline": True,
            "tier2_rich_offline": self.has_spacy or self.has_sklearn,
            "tier3_llm": self.llm_active,
            "detail": {
                "spacy": self.has_spacy,
                "sklearn": self.has_sklearn,
                "groq": self.has_groq,
                "anthropic": self.has_anthropic,
                "ocr": self.has_ocr,
            },
            "primary_llm": self.primary_llm,
            "models": {
                "groq": self.groq_model if self.has_groq else None,
                "anthropic": self.anthropic_model if self.has_anthropic else None,
            },
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


# Path to bundled data.
DATA_DIR = Path(__file__).resolve().parent / "data"
SKILLS_FILE = DATA_DIR / "skills.json"
