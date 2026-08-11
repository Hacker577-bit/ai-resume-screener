"""Vercel serverless entrypoint.

Vercel's Python runtime looks for an ASGI app named `app` in this module. We
re-export the FastAPI app from the `app` package. The `web/` static files are
served directly by Vercel (see vercel.json), so serverless invocations only
handle /api/* routes.
"""
import os
import sys

# Ensure the project root is importable when Vercel runs this file.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402

# Vercel's ASGI adapter uses this symbol.
handler = app
