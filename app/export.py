"""Export screening results to CSV or PDF.

Both return raw bytes plus a suggested filename + media type, so the API layer
can stream them without touching disk (Vercel-friendly).
"""
from __future__ import annotations

import csv
import io

from .models import CandidateResult


def to_csv(candidates: list[CandidateResult]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Rank",
            "Candidate",
            "Filename",
            "Score",
            "Skill Coverage",
            "Similarity",
            "Keywords",
            "LLM Score",
            "Engine",
            "Matched Skills",
            "Missing Skills",
            "Rationale",
        ]
    )
    for c in candidates:
        writer.writerow(
            [
                c.rank,
                c.candidate_name or "",
                c.filename,
                c.score,
                c.breakdown.skills,
                c.breakdown.similarity,
                c.breakdown.keywords,
                "" if c.breakdown.llm is None else c.breakdown.llm,
                c.engine,
                "; ".join(c.matched_skills),
                "; ".join(c.missing_skills),
                (c.rationale or "").replace("\n", " "),
            ]
        )
    return buf.getvalue().encode("utf-8-sig")  # BOM so Excel reads UTF-8


def to_pdf(candidates: list[CandidateResult], job_title: str = "Job Description") -> bytes:
    """Render a ranked-candidate report PDF. Requires reportlab."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        title="Resume Screening Report",
    )
    styles = getSampleStyleSheet()
    accent = colors.HexColor("#4f46e5")
    title_style = ParagraphStyle(
        "TitleX", parent=styles["Title"], textColor=accent, fontSize=20, spaceAfter=4
    )
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)
    cell = ParagraphStyle("Cell", parent=styles["Normal"], fontSize=8, leading=10)

    story = [
        Paragraph("Resume Screening Report", title_style),
        Paragraph(f"Position: {job_title}", styles["Normal"]),
        Paragraph(f"Candidates evaluated: {len(candidates)}", small),
        Spacer(1, 8 * mm),
    ]

    header = ["#", "Candidate", "Score", "Skills", "Sim.", "Kw.", "Matched / Missing"]
    rows = [header]
    for c in candidates:
        matched = ", ".join(c.matched_skills[:6]) or "—"
        missing = ", ".join(c.missing_skills[:6]) or "—"
        rows.append(
            [
                str(c.rank),
                Paragraph(f"<b>{_esc(c.candidate_name or c.filename)}</b><br/>"
                          f"<font size=6 color='#888'>{_esc(c.filename)}</font>", cell),
                f"{c.score:.0f}",
                f"{c.breakdown.skills:.0f}",
                f"{c.breakdown.similarity:.0f}",
                f"{c.breakdown.keywords:.0f}",
                Paragraph(
                    f"<font color='#16a34a'>✓ {_esc(matched)}</font><br/>"
                    f"<font color='#dc2626'>✗ {_esc(missing)}</font>",
                    cell,
                ),
            ]
        )

    table = Table(rows, colWidths=[8 * mm, 45 * mm, 14 * mm, 14 * mm, 12 * mm, 12 * mm, 65 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), accent),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (2, 0), (5, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(table)

    # Rationale section (only for candidates that have one).
    rationaled = [c for c in candidates if c.rationale]
    if rationaled:
        story.append(Spacer(1, 8 * mm))
        story.append(Paragraph("AI Rationale", ParagraphStyle(
            "H2X", parent=styles["Heading2"], textColor=accent)))
        for c in rationaled:
            story.append(Paragraph(
                f"<b>{_esc(c.candidate_name or c.filename)}</b> "
                f"<font color='#888'>({c.engine}, score {c.score:.0f})</font>: "
                f"{_esc(c.rationale)}", cell))
            story.append(Spacer(1, 2 * mm))

    doc.build(story)
    return buf.getvalue()


def _esc(text: str | None) -> str:
    if not text:
        return ""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def export_results(candidates: list[CandidateResult], fmt: str, job_title: str) -> tuple[bytes, str, str]:
    """Return (bytes, filename, media_type) for the requested format."""
    fmt = (fmt or "csv").lower()
    if fmt == "pdf":
        return to_pdf(candidates, job_title), "screening_report.pdf", "application/pdf"
    return to_csv(candidates), "screening_results.csv", "text/csv"
