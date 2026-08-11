"""Resume scoring against a job description.

Composite score (0-100) blends three transparent signals:
  1. skills     — weighted coverage of the JD's required skills (fuzzy-aware)
  2. similarity — TF-IDF cosine between resume text and JD text
  3. keywords   — presence of salient JD keywords in the resume

TF-IDF uses scikit-learn when available (Tier 2), otherwise a dependency-free
hand-rolled implementation (Tier 1). Both return a value in [0, 1].
"""
from __future__ import annotations

import math
import re
from collections import Counter

from .config import get_settings

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9+#.]*")

_STOPWORDS = {
    "the", "and", "for", "with", "you", "your", "our", "are", "has", "have",
    "will", "this", "that", "from", "who", "all", "can", "not", "but", "job",
    "role", "work", "team", "years", "year", "experience", "including", "etc",
    "a", "an", "to", "of", "in", "on", "as", "is", "be", "or", "we", "at", "by",
    "it", "their", "they", "them", "using", "use", "used", "strong", "ability",
    "plus", "must", "should", "responsibilities", "requirements", "candidate",
}


def _tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1]


# --- Similarity ---------------------------------------------------------------

def _cosine_sklearn(resume: str, job: str) -> float | None:
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity
    except ImportError:
        return None
    try:
        vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=1)
        matrix = vec.fit_transform([resume, job])
        return float(cosine_similarity(matrix[0:1], matrix[1:2])[0][0])
    except Exception:
        return None


def _cosine_manual(resume: str, job: str) -> float:
    """Dependency-free TF-IDF cosine over a 2-document corpus."""
    ra, ja = _tokenize(resume), _tokenize(job)
    if not ra or not ja:
        return 0.0
    ca, cj = Counter(ra), Counter(ja)
    vocab = set(ca) | set(cj)

    # IDF over the 2-doc corpus: terms in both docs get lower weight.
    def idf(term: str) -> float:
        df = (1 if term in ca else 0) + (1 if term in cj else 0)
        return math.log((1 + 2) / (1 + df)) + 1.0

    def vec(counter: Counter) -> dict[str, float]:
        total = sum(counter.values()) or 1
        return {t: (counter[t] / total) * idf(t) for t in vocab if counter.get(t)}

    va, vj = vec(ca), vec(cj)
    dot = sum(va.get(t, 0.0) * vj.get(t, 0.0) for t in vocab)
    na = math.sqrt(sum(v * v for v in va.values()))
    nj = math.sqrt(sum(v * v for v in vj.values()))
    if na == 0 or nj == 0:
        return 0.0
    return dot / (na * nj)


def similarity_score(resume: str, job: str) -> float:
    """Cosine similarity in [0, 100]. Uses sklearn if present, else manual."""
    settings = get_settings()
    val = _cosine_sklearn(resume, job) if settings.has_sklearn else None
    if val is None:
        val = _cosine_manual(resume, job)
    return round(max(0.0, min(1.0, val)) * 100, 1)


# --- Skill coverage -----------------------------------------------------------

def skill_coverage(candidate_skills: list[str], required_skills: list[str]) -> tuple[float, list[str], list[str]]:
    """Fraction of required skills the candidate has (case-insensitive).

    Returns (score_0_100, matched, missing).
    """
    if not required_skills:
        # No explicit requirements → reward breadth modestly (cap so it can't
        # dominate a JD that simply lists no taxonomy skills).
        score = min(len(candidate_skills) * 8.0, 100.0)
        return round(score, 1), list(candidate_skills), []

    have = {s.lower() for s in candidate_skills}
    matched = [r for r in required_skills if r.lower() in have]
    missing = [r for r in required_skills if r.lower() not in have]
    score = len(matched) / len(required_skills) * 100
    return round(score, 1), matched, missing


# --- Keyword presence ---------------------------------------------------------

def top_keywords(job_text: str, k: int = 20) -> list[str]:
    """Most salient JD tokens by frequency (excluding stopwords)."""
    counts = Counter(_tokenize(job_text))
    return [w for w, _ in counts.most_common(k)]


def keyword_score(resume: str, keywords: list[str]) -> float:
    """Fraction of the JD's top keywords present in the resume, in [0, 100]."""
    if not keywords:
        return 0.0
    resume_tokens = set(_tokenize(resume))
    present = sum(1 for kw in keywords if kw in resume_tokens)
    return round(present / len(keywords) * 100, 1)


# --- Composite ----------------------------------------------------------------

def composite_score(skills: float, similarity: float, keywords: float) -> float:
    """Weighted blend of the three offline signals, normalized weights."""
    ws, wsim, wk = get_settings().normalized_weights
    return round(skills * ws + similarity * wsim + keywords * wk, 1)


def blend_llm(offline: float, llm: float | None) -> float:
    """Blend offline composite with the LLM score per LLM_BLEND (0..1)."""
    if llm is None:
        return offline
    blend = get_settings().llm_blend
    blend = max(0.0, min(1.0, blend))
    return round(offline * (1 - blend) + llm * blend, 1)
