"""Tests for skill extraction and taxonomy matching."""
from app.skills import (
    extract_taxonomy_skills,
    extract_fuzzy_skills,
    parse_required_skills,
)


def _names(hits):
    return {h.name for h in hits}


def test_taxonomy_finds_core_skills(alice):
    names = _names(extract_taxonomy_skills(alice))
    for expected in ["Python", "spaCy", "PyTorch", "FastAPI", "Docker", "AWS"]:
        assert expected in names, f"missing {expected}"


def test_special_char_skills_do_not_bleed():
    # "C" should not match inside "CI/CD" or random words; C++ should match.
    names = _names(extract_taxonomy_skills("Experienced in C++ and modern CI/CD."))
    assert "C++" in names
    assert "CI/CD" in names


def test_multiword_skill_priority():
    names = _names(extract_taxonomy_skills("Deep experience in machine learning."))
    assert "Machine Learning" in names


def test_fuzzy_catches_typo():
    # "pythn" is a near-miss for python.
    names = _names(extract_fuzzy_skills("Strong pythn developer", threshold=85))
    assert "Python" in names


def test_parse_required_skills_from_jd(job_text):
    required = parse_required_skills(job_text)
    assert "Python" in required
    assert "FastAPI" in required
    assert "PostgreSQL" in required
