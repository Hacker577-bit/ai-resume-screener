"""Tier 3 (optional) — Claude enhancement via the Anthropic SDK.

Only used when ANTHROPIC_API_KEY is set. Mirrors ai_groq's contract so the engine
can treat either LLM interchangeably. Uses the current Anthropic API shapes:
`claude-opus-5`, adaptive thinking, and structured output via `messages.parse()`
with a Pydantic schema (falls back to json_object parsing if parse() is absent).

All failures degrade to `None`.
"""
from __future__ import annotations

import json

from pydantic import BaseModel, Field

from .config import get_settings

_SYSTEM = (
    "You are an expert technical recruiter and resume screener. Evaluate how well a "
    "candidate's resume matches a job description. Be objective and evidence-based."
)


class _LLMEval(BaseModel):
    match_score: int = Field(ge=0, le=100)
    matched_skills: list[str] = []
    missing_skills: list[str] = []
    extracted_skills: list[str] = []
    rationale: str = ""
    seniority: str = "unknown"


def _build_prompt(resume_text: str, job_text: str, required_skills: list[str]) -> str:
    req = ", ".join(required_skills) if required_skills else "(infer from the job description)"
    return (
        "Evaluate the candidate against the job.\n\n"
        f"REQUIRED SKILLS (detected): {req}\n\n"
        f"=== JOB DESCRIPTION ===\n{job_text[:6000]}\n\n"
        f"=== RESUME ===\n{resume_text[:12000]}\n\n"
        "Score 0-100. Keep rationale under 60 words."
    )


def score_with_claude(resume_text: str, job_text: str, required_skills: list[str]) -> dict | None:
    settings = get_settings()
    if not settings.has_anthropic:
        return None
    try:
        import anthropic
    except ImportError:
        return None

    prompt = _build_prompt(resume_text, job_text, required_skills)
    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

        # Preferred path: structured output via messages.parse() with a schema.
        parse = getattr(client.messages, "parse", None)
        if callable(parse):
            msg = parse(
                model=settings.anthropic_model,
                max_tokens=1200,
                thinking={"type": "adaptive"},
                system=_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
                response_format=_LLMEval,
            )
            parsed = getattr(msg, "parsed_content", None) or getattr(msg, "parsed", None)
            if parsed is not None:
                data = parsed.model_dump() if hasattr(parsed, "model_dump") else dict(parsed)
                return _normalize(data)

        # Fallback: plain message, ask for JSON, parse text.
        msg = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1200,
            thinking={"type": "adaptive"},
            system=_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": prompt
                    + '\n\nRespond with ONLY a JSON object with keys: '
                    'match_score, matched_skills, missing_skills, extracted_skills, '
                    'rationale, seniority.',
                }
            ],
        )
        if getattr(msg, "stop_reason", None) == "refusal":
            return None
        text = "".join(
            block.text for block in msg.content if getattr(block, "type", None) == "text"
        )
        return _normalize(json.loads(_extract_json(text)))
    except Exception:
        return None


def _extract_json(text: str) -> str:
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if start != -1 and end != -1 else "{}"


def _normalize(raw: dict) -> dict:
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
