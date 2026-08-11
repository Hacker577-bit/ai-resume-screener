"""Skill identification.

Tier 1: curated taxonomy match (regex whole-word + rapidfuzz fuzzy for typos).
Tier 2: spaCy noun-chunk / entity extraction to surface skill-like phrases that
        aren't in the taxonomy (surfaced separately, lower confidence).

The taxonomy also drives job-description parsing: which skills a JD *requires*.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache

from .config import SKILLS_FILE, get_settings
from .models import SkillHit


@lru_cache(maxsize=1)
def _load_taxonomy() -> dict:
    with open(SKILLS_FILE, encoding="utf-8") as fh:
        raw = json.load(fh)
    return raw["categories"]


@lru_cache(maxsize=1)
def _alias_index() -> list[tuple[str, str, str]]:
    """Flattened list of (alias_lower, canonical, category), longest alias first.

    Longest-first ordering means we match "machine learning" before "learning"
    and ".net" before "net".
    """
    index: list[tuple[str, str, str]] = []
    for category, skills in _load_taxonomy().items():
        for canonical, aliases in skills.items():
            for alias in [canonical, *aliases]:
                index.append((alias.lower(), canonical, category))
    index.sort(key=lambda t: len(t[0]), reverse=True)
    return index


def _compile_alias_pattern(alias: str) -> re.Pattern:
    """Whole-token match tolerant of symbols like C++, C#, .NET, Node.js."""
    escaped = re.escape(alias)
    # Use lookarounds instead of \b because \b misbehaves next to +, #, .
    return re.compile(rf"(?<![A-Za-z0-9+#.]){escaped}(?![A-Za-z0-9+#])", re.IGNORECASE)


@lru_cache(maxsize=1)
def _compiled_index() -> list[tuple[re.Pattern, str, str]]:
    return [(_compile_alias_pattern(a), canon, cat) for a, canon, cat in _alias_index()]


def canonical_category() -> dict[str, str]:
    """Map canonical skill name -> category."""
    out: dict[str, str] = {}
    for category, skills in _load_taxonomy().items():
        for canonical in skills:
            out[canonical] = category
    return out


def extract_taxonomy_skills(text: str) -> list[SkillHit]:
    """Tier 1 — exact/alias matches from the curated taxonomy."""
    found: dict[str, SkillHit] = {}
    for pattern, canonical, category in _compiled_index():
        if canonical in found:
            continue
        if pattern.search(text):
            found[canonical] = SkillHit(name=canonical, category=category, source="taxonomy")
    return list(found.values())


def extract_fuzzy_skills(text: str, threshold: int = 90) -> list[SkillHit]:
    """Catch near-misspellings of canonical skills using rapidfuzz token matching.

    Conservative (high threshold) to avoid false positives. Only adds skills not
    already found exactly.
    """
    try:
        from rapidfuzz import fuzz
    except ImportError:
        return []

    cat = canonical_category()
    canon_lower = {c.lower(): c for c in cat}
    tokens = set(re.findall(r"[A-Za-z][A-Za-z+#.]{2,}", text.lower()))
    hits: dict[str, SkillHit] = {}
    for token in tokens:
        for cl, canonical in canon_lower.items():
            if len(cl) < 4:  # skip very short skills — too many false matches
                continue
            if canonical in hits:
                continue
            if fuzz.ratio(token, cl) >= threshold and token != cl:
                hits[canonical] = SkillHit(
                    name=canonical, category=cat[canonical], source="fuzzy"
                )
    return list(hits.values())


def extract_spacy_phrases(text: str, limit: int = 15) -> list[SkillHit]:
    """Tier 2 — spaCy noun chunks / proper-noun entities as candidate skills.

    These are lower-confidence, taxonomy-external phrases (e.g. a niche tool the
    taxonomy doesn't list). Returns [] if spaCy or its model is unavailable.
    """
    settings = get_settings()
    if not settings.has_spacy:
        return []
    nlp = _load_spacy()
    if nlp is None:
        return []

    doc = nlp(text[:100_000])  # cap for performance
    known = {c.lower() for c in canonical_category()}
    candidates: dict[str, int] = {}

    for chunk in doc.noun_chunks:
        phrase = chunk.text.strip()
        low = phrase.lower()
        if (
            2 <= len(phrase) <= 40
            and low not in known
            and not any(ch.isdigit() for ch in phrase)
            and len(phrase.split()) <= 3
        ):
            candidates[phrase] = candidates.get(phrase, 0) + 1

    ranked = sorted(candidates.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return [SkillHit(name=p, category="Detected", source="spacy") for p, _ in ranked]


@lru_cache(maxsize=1)
def _load_spacy():
    try:
        import spacy

        try:
            return spacy.load("en_core_web_sm", disable=["lemmatizer"])
        except OSError:
            # Model not downloaded — fall back to a blank pipeline with a
            # sentencizer so noun_chunks at least doesn't crash. (Returns few
            # chunks, but keeps the tier from erroring.)
            return None
    except ImportError:
        return None


def extract_skills(text: str, include_phrases: bool = True) -> list[SkillHit]:
    """Full skill extraction: taxonomy + fuzzy, plus spaCy phrases when available."""
    hits: dict[str, SkillHit] = {}
    for hit in extract_taxonomy_skills(text):
        hits[hit.name] = hit
    for hit in extract_fuzzy_skills(text):
        hits.setdefault(hit.name, hit)
    if include_phrases:
        for hit in extract_spacy_phrases(text):
            hits.setdefault(hit.name, hit)
    return list(hits.values())


def parse_required_skills(job_text: str) -> list[str]:
    """Which taxonomy skills the job description mentions (its 'required' set)."""
    return [h.name for h in extract_taxonomy_skills(job_text)]
