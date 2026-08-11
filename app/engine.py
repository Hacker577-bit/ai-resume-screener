"""Orchestration engine — turns raw uploads into ranked, scored candidates.

Pipeline per resume:
    extract text  ->  extract skills (offline)  ->  offline scoring
                  ->  optional LLM evaluation    ->  blend + merge
Then rank all candidates by final score.

The engine is tier-aware: it always produces an offline result and only layers
LLM output on top when a key is configured. Every candidate carries a transparent
`breakdown` so the UI can show *why* a score is what it is.
"""
from __future__ import annotations

from . import ai_claude, ai_groq, scoring, skills
from .config import get_settings
from .extraction import extract_text, guess_candidate_name
from .models import (
    CandidateResult,
    JobSpec,
    ScoreBreakdown,
    ScreenResponse,
    SkillHit,
)


def build_job_spec(job_text: str) -> JobSpec:
    required = skills.parse_required_skills(job_text)
    keywords = scoring.top_keywords(job_text, k=20)
    return JobSpec(text=job_text, required_skills=required, keywords=keywords)


def _llm_evaluate(resume_text: str, job: JobSpec) -> tuple[dict | None, str]:
    """Try the primary LLM, then the optional one. Returns (result, engine_name)."""
    settings = get_settings()
    if settings.has_groq:
        res = ai_groq.score_with_groq(resume_text, job.text, job.required_skills)
        if res is not None:
            return res, "groq"
    if settings.has_anthropic:
        res = ai_claude.score_with_claude(resume_text, job.text, job.required_skills)
        if res is not None:
            return res, "anthropic"
    return None, "offline"


def screen_one(filename: str, data: bytes, job: JobSpec) -> CandidateResult:
    """Screen a single resume file against the job spec."""
    extraction = extract_text(filename, data)
    text = extraction.text
    warnings = list(extraction.warnings)

    # --- Offline skill extraction ---
    skill_hits = skills.extract_skills(text) if text else []
    skill_names = [h.name for h in skill_hits]

    # --- Offline scoring ---
    cov_score, matched, missing = scoring.skill_coverage(skill_names, job.required_skills)
    sim_score = scoring.similarity_score(text, job.text) if text else 0.0
    kw_score = scoring.keyword_score(text, job.keywords) if text else 0.0
    offline_composite = scoring.composite_score(cov_score, sim_score, kw_score)

    # --- Optional LLM layer ---
    llm_result, engine = _llm_evaluate(text, job) if text else (None, "offline")
    llm_score = llm_result["match_score"] if llm_result else None
    rationale = llm_result["rationale"] if llm_result else None

    # Merge LLM-found skills into the display set (marked as source=llm).
    if llm_result:
        existing = {h.name.lower() for h in skill_hits}
        for s in llm_result.get("extracted_skills", []):
            if s.lower() not in existing:
                skill_hits.append(SkillHit(name=s, category="LLM", source="llm"))
                existing.add(s.lower())
        # Prefer the LLM's matched/missing when it returned them.
        if llm_result.get("matched_skills"):
            matched = llm_result["matched_skills"]
        if llm_result.get("missing_skills"):
            missing = llm_result["missing_skills"]

    final_score = scoring.blend_llm(offline_composite, llm_score)

    if not text:
        warnings.append("No extractable text — resume scored 0.")

    breakdown = ScoreBreakdown(
        skills=cov_score,
        similarity=sim_score,
        keywords=kw_score,
        llm=llm_score,
        offline_composite=offline_composite,
    )

    return CandidateResult(
        filename=filename,
        candidate_name=guess_candidate_name(text, filename),
        score=final_score,
        breakdown=breakdown,
        matched_skills=matched,
        missing_skills=missing,
        all_skills=skill_hits,
        rationale=rationale,
        engine=engine,
        warnings=warnings,
        char_count=extraction.char_count,
    )


def screen_all(files: list[tuple[str, bytes]], job_text: str) -> ScreenResponse:
    """Screen every resume, rank by final score (desc), assign ranks."""
    job = build_job_spec(job_text)
    results = [screen_one(name, data, job) for name, data in files]

    results.sort(key=lambda c: c.score, reverse=True)
    for i, cand in enumerate(results, start=1):
        cand.rank = i

    return ScreenResponse(
        job=job,
        candidates=results,
        tiers=get_settings().capabilities(),
        count=len(results),
    )
