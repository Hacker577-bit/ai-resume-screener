"""Shared pytest fixtures."""
import pathlib

import pytest

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def _read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture
def job_text() -> str:
    return _read("job_description.txt")


@pytest.fixture
def alice() -> str:
    return _read("alice_chen.txt")


@pytest.fixture
def bob() -> str:
    return _read("bob_martinez.txt")


@pytest.fixture
def carol() -> str:
    return _read("carol_okafor.txt")
