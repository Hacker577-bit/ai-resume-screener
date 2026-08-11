"""Tests for text extraction."""
from app.extraction import extract_text, guess_candidate_name


def test_extract_txt_bytes(alice):
    result = extract_text("alice_chen.txt", alice.encode("utf-8"))
    assert result.char_count > 100
    assert "Machine Learning" in result.text or "machine learning" in result.text.lower()
    assert result.warnings == []


def test_extract_unsupported_doc():
    result = extract_text("old_resume.doc", b"\xd0\xcf\x11\xe0garbage")
    assert result.char_count == 0
    assert any("not supported" in w.lower() for w in result.warnings)


def test_guess_candidate_name_from_text(alice):
    name = guess_candidate_name(alice, "alice_chen.txt")
    assert name is not None
    assert "Alice" in name


def test_guess_candidate_name_falls_back_to_filename():
    name = guess_candidate_name("", "john_doe_resume.pdf")
    assert name is not None
    assert "John" in name
