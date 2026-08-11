"""Pydantic schemas for API requests and responses."""
from __future__ import annotations

from pydantic import BaseModel, Field


class SkillHit(BaseModel):
    """A single skill detected in a resume."""

    name: str
    category: str = "Other"
    source: str = "taxonomy"  # taxonomy | spacy | llm


class ScoreBreakdown(BaseModel):
    """Transparent per-signal breakdown of a candidate's composite score."""

    skills: float = Field(0.0, description="Required-skill coverage score, 0-100")
    similarity: float = Field(0.0, description="TF-IDF cosine similarity, 0-100")
    keywords: float = Field(0.0, description="Keyword-presence score, 0-100")
    llm: float | None = Field(None, description="LLM semantic score, 0-100, if available")
    offline_composite: float = Field(0.0, description="Weighted offline score, 0-100")


class CandidateResult(BaseModel):
    """One screened resume."""

    filename: str
    candidate_name: str | None = None
    score: float = Field(0.0, description="Final composite score 0-100")
    rank: int = 0
    breakdown: ScoreBreakdown
    matched_skills: list[str] = []
    missing_skills: list[str] = []
    all_skills: list[SkillHit] = []
    rationale: str | None = None
    engine: str = "offline"  # offline | groq | anthropic
    warnings: list[str] = []
    char_count: int = 0


class JobSpec(BaseModel):
    """Parsed view of the job description."""

    text: str
    required_skills: list[str] = []
    keywords: list[str] = []


class ScreenResponse(BaseModel):
    """Full response for POST /api/screen."""

    job: JobSpec
    candidates: list[CandidateResult]
    tiers: dict
    count: int


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    capabilities: dict


class ExportRequest(BaseModel):
    """Body for POST /api/export — the client echoes back the results it received."""

    format: str = Field("csv", description="csv | pdf")
    job_title: str = "Job Description"
    candidates: list[CandidateResult]
