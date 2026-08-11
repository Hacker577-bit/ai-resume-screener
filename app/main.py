"""FastAPI application — routes for screening, export, and health.

Serves the static web/ frontend at / and the JSON API under /api. Uploads are
processed entirely in memory so this runs on Vercel's read-only filesystem.
"""
from __future__ import annotations

import io

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, engine, export
from .config import get_settings
from .models import ExportRequest, HealthResponse, ScreenResponse

app = FastAPI(
    title="AI Resume Screener",
    version=__version__,
    description="Intelligent resume screening: extract, score, match, and rank candidates.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_ALLOWED_EXT = (".pdf", ".docx", ".txt", ".md")


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        capabilities=get_settings().capabilities(),
    )


@app.post("/api/screen", response_model=ScreenResponse)
async def screen(
    job_description: str = Form(...),
    files: list[UploadFile] = File(...),
) -> ScreenResponse:
    if not job_description.strip():
        raise HTTPException(status_code=400, detail="Job description is required.")
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one resume.")

    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024

    payloads: list[tuple[str, bytes]] = []
    for upload in files:
        name = upload.filename or "resume"
        if not name.lower().endswith(_ALLOWED_EXT):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {name}. Allowed: PDF, DOCX, TXT.",
            )
        data = await upload.read()
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"{name} exceeds the {settings.max_upload_mb} MB limit.",
            )
        payloads.append((name, data))

    return engine.screen_all(payloads, job_description)


@app.post("/api/export")
def export_endpoint(req: ExportRequest) -> StreamingResponse:
    if not req.candidates:
        raise HTTPException(status_code=400, detail="No candidates to export.")
    try:
        content, filename, media_type = export.export_results(
            req.candidates, req.format, req.job_title
        )
    except ImportError as exc:
        raise HTTPException(
            status_code=501,
            detail=f"Export dependency missing: {exc}. PDF export needs reportlab.",
        ) from exc

    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Static frontend ----------------------------------------------------------
# Mounted last so it doesn't shadow /api routes. In the Vercel deployment the
# static files are served by the platform, but this makes local dev a one-liner.
import os  # noqa: E402

_WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
if os.path.isdir(_WEB_DIR):
    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(os.path.join(_WEB_DIR, "index.html"))

    app.mount("/", StaticFiles(directory=_WEB_DIR, html=True), name="web")
