"""Tests for scoring, ranking, and the end-to-end offline engine."""
from app.engine import screen_all, build_job_spec
from app.scoring import (
    similarity_score,
    skill_coverage,
    keyword_score,
    composite_score,
    _cosine_manual,
)


def test_similarity_identical_is_high(job_text):
    assert similarity_score(job_text, job_text) > 95


def test_similarity_unrelated_is_low():
    assert similarity_score("I love baking sourdough bread", "Kubernetes AWS Docker") < 20


def test_manual_cosine_bounds():
    assert 0.0 <= _cosine_manual("python java", "python go") <= 1.0


def test_skill_coverage_matched_and_missing():
    score, matched, missing = skill_coverage(
        ["Python", "Docker"], ["Python", "Docker", "AWS", "SQL"]
    )
    assert score == 50.0
    assert set(matched) == {"Python", "Docker"}
    assert set(missing) == {"AWS", "SQL"}


def test_keyword_score_range(job_text):
    from app.scoring import top_keywords
    kws = top_keywords(job_text)
    assert 0 <= keyword_score("python fastapi nlp docker aws sql", kws) <= 100


def test_composite_is_weighted():
    # With defaults 0.5/0.3/0.2, all-100 => 100.
    assert composite_score(100, 100, 100) == 100.0
    assert composite_score(0, 0, 0) == 0.0


def test_engine_ranks_best_fit_first(job_text, alice, bob, carol):
    files = [
        ("bob_martinez.txt", bob.encode("utf-8")),
        ("alice_chen.txt", alice.encode("utf-8")),
        ("carol_okafor.txt", carol.encode("utf-8")),
    ]
    resp = screen_all(files, job_text)
    assert resp.count == 3
    # Alice is the clear best match for an AI/NLP Python role.
    assert resp.candidates[0].filename == "alice_chen.txt"
    assert resp.candidates[0].rank == 1
    # Scores are sorted descending.
    scores = [c.score for c in resp.candidates]
    assert scores == sorted(scores, reverse=True)
    # Alice should have matched skills and the JD required set is populated.
    assert resp.candidates[0].matched_skills
    assert resp.job.required_skills


def test_job_spec_extracts_requirements(job_text):
    spec = build_job_spec(job_text)
    assert "Python" in spec.required_skills
    assert spec.keywords
