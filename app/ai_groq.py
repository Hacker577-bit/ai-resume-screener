"""Tier 3 (primary) — Groq LLM enhancement.

Uses the official `groq` SDK (OpenAI-compatible surface). Given a resume and a job
description, returns structured JSON: extracted skills, a 0-100 match score,
matched/missing skills, and a short written rationale.

All failures degrade to `None` so the caller can fall back to offline scoring.
"""
from __future__ import annotations

import json

from .config import get_settings

_SYSTEM = (
    "You are an expert technical recruiter and resume screener. You evaluate how "
    "well a candidate's resume matches a job description. Be objective, evidence-based, "
    "and concise. Always respond with a single valid JSON object and nothing else."
)

_SCHEMA_HINT = {
    "match_score": "integer 0-100, how well the resume matches the job",
    "matched_skills": ["skills from the job the candidate clearly has"],
    "missing_skills": ["important skills from the job the candidate lacks"],
    "extracted_skills": ["all notable skills/technologies found in the resume"],
    "rationale": "2-4 sentence justification of the score, citing specifics",
    "seniority": "one of: junior, mid, senior, lead, unknown",
}


def _build_prompt(resume_text: str, job_text: str, required_skills: list[str]) -> str:
    resume_clip = resume_text[:12000]
    job_clip = job_text[:6000]
    req = ", ".join(required_skills) if required_skills else "(infer from the job description)"
    return (
        "Evaluate the candidate against the job.\n\n"
        f"REQUIRED SKILLS (detected): {req}\n\n"
        f"=== JOB DESCRIPTION ===\n{job_clip}\n\n"
        f"=== RESUME ===\n{resume_clip}\n\n"
        "Respond with a JSON object using exactly these keys: "
        f"{json.dumps(list(_SCHEMA_HINT.keys()))}. "
        "match_score must be an integer 0-100. Keep rationale under 60 words."
    )


def score_with_groq(resume_text: str, job_text: str, required_skills: list[str]) -> dict | None:
    """Return the parsed LLM evaluation dict, or None on any failure."""
    settings = get_settings()
    if not settings.has_groq:
        return None
    try:
        from groq import Groq
    except ImportError:
        return None

    try:
        client = Groq(api_key=settings.groq_api_key)
        resp = client.chat.completions.create(
            model=settings.groq_model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": _build_prompt(resume_text, job_text, required_skills)},
            ],
            temperature=0.2,
            max_tokens=800,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content
        return _normalize(json.loads(content))
    except Exception:
        return None


def _normalize(raw: dict) -> dict:
    """Coerce the LLM output into the shape the engine expects."""
    def as_list(v) -> list[str]:
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        if isinstance(v, str) and v.strip():
            return [s.strip() for s in v.split(",") if s.strip()]
        return []

    try:
        score = float(raw.get("match_score", 0))
    except (TypeError, ValueError):
        score = 0.0
    score = max(0.0, min(100.0, score))

    return {
        "match_score": round(score, 1),
        "matched_skills": as_list(raw.get("matched_skills")),
        "missing_skills": as_list(raw.get("missing_skills")),
        "extracted_skills": as_list(raw.get("extracted_skills")),
        "rationale": str(raw.get("rationale", "")).strip(),
        "seniority": str(raw.get("seniority", "unknown")).strip().lower(),
    }
