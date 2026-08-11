/* ============================================================
   AI Resume Screener — frontend logic
   Vanilla JS. Talks to /api/screen, /api/export, /api/health.
   ============================================================ */

const state = {
  files: [],          // File[]
  results: null,      // ScreenResponse
  sortKey: "score",
  sortDir: -1,
  distChart: null,
  breakdownChart: null,
};

const $ = (id) => document.getElementById(id);

// ---------- Health / tier badges ----------
async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    renderTiers(data.capabilities);
  } catch {
    /* health is best-effort; UI still works */
  }
}

function renderTiers(cap) {
  if (!cap) return;
  const box = $("tier-badges");
  const items = [
    { on: cap.tier1_baseline, label: "Baseline NLP" },
    { on: cap.tier2_rich_offline, label: "Rich Offline" },
    {
      on: cap.tier3_llm,
      label: cap.primary_llm
        ? `LLM · ${cap.primary_llm}`
        : "LLM (off)",
    },
  ];
  box.innerHTML = items
    .map(
      (t) =>
        `<span class="badge ${t.on ? "on" : ""}"><span class="dot"></span>${t.label}</span>`
    )
    .join("");
}

// ---------- File handling ----------
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ALLOWED = [".pdf", ".docx", ".txt", ".md"];
function isAllowed(name) {
  return ALLOWED.some((ext) => name.toLowerCase().endsWith(ext));
}

function addFiles(fileList) {
  for (const f of fileList) {
    if (!isAllowed(f.name)) continue;
    if (state.files.some((x) => x.name === f.name && x.size === f.size)) continue;
    state.files.push(f);
  }
  renderFileList();
  updateScreenBtn();
}

function renderFileList() {
  const ul = $("file-list");
  ul.innerHTML = state.files
    .map(
      (f, i) => `
      <li>
        <span>📄 ${escapeHtml(f.name)} <span class="fsize">${humanSize(f.size)}</span></span>
        <button class="remove" data-i="${i}" title="Remove">✕</button>
      </li>`
    )
    .join("");
  ul.querySelectorAll(".remove").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.files.splice(Number(btn.dataset.i), 1);
      renderFileList();
      updateScreenBtn();
    })
  );
}

function updateScreenBtn() {
  const ready = state.files.length > 0 && $("jd").value.trim().length > 0;
  $("screen-btn").disabled = !ready;
}

// ---------- Screening ----------
async function runScreen() {
  showError("");
  const jd = $("jd").value.trim();
  if (!jd || state.files.length === 0) return;

  const form = new FormData();
  form.append("job_description", jd);
  for (const f of state.files) form.append("files", f, f.name);

  setLoading(true, `Analyzing ${state.files.length} resume${state.files.length > 1 ? "s" : ""}…`);
  try {
    const res = await fetch("/api/screen", { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error (${res.status})`);
    }
    state.results = await res.json();
    renderTiers(state.results.tiers);
    renderResults();
  } catch (e) {
    showError(e.message || "Screening failed.");
  } finally {
    setLoading(false);
  }
}

function setLoading(on, text) {
  $("loading").hidden = !on;
  if (text) $("loading-text").textContent = text;
  if (on) $("results").hidden = true;
}

function showError(msg) {
  const box = $("error-box");
  box.hidden = !msg;
  box.textContent = msg;
}

// ---------- Rendering results ----------
function scoreClass(s) {
  return s >= 70 ? "good" : s >= 45 ? "mid" : "bad";
}

function renderResults() {
  const r = state.results;
  if (!r) return;
  $("results").hidden = false;
  $("result-count").textContent = `${r.count} candidate${r.count !== 1 ? "s" : ""}`;

  renderStatCards(r);
  renderTable();
  renderCharts(r);
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderStatCards(r) {
  const scores = r.candidates.map((c) => c.score);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const top = r.candidates[0];
  const strong = scores.filter((s) => s >= 70).length;

  const cards = [
    { k: "Candidates", v: r.count, grad: false },
    { k: "Top Score", v: top ? top.score.toFixed(0) : "—", grad: true },
    { k: "Average", v: avg.toFixed(0), grad: false },
    { k: "Strong Fits (≥70)", v: strong, grad: false },
  ];
  $("stat-cards").innerHTML = cards
    .map(
      (c) =>
        `<div class="stat-card"><div class="k">${c.k}</div><div class="v ${c.grad ? "grad" : ""}">${c.v}</div></div>`
    )
    .join("");
}

function sortedCandidates() {
  const arr = [...state.results.candidates];
  const key = state.sortKey;
  arr.sort((a, b) => {
    let av = a[key], bv = b[key];
    if (typeof av === "string") { av = av || ""; bv = bv || ""; return state.sortDir * av.localeCompare(bv); }
    return state.sortDir * ((av || 0) - (bv || 0));
  });
  return arr;
}

function renderTable() {
  const body = $("rank-body");
  const rows = sortedCandidates();
  body.innerHTML = rows.map(candidateRow).join("");
  body.querySelectorAll(".detail-btn").forEach((btn) =>
    btn.addEventListener("click", () => openModal(btn.dataset.file))
  );
}

function candidateRow(c) {
  const rankCls = c.rank <= 3 ? `r${c.rank}` : "";
  const total = c.matched_skills.length + c.missing_skills.length;
  const pct = total ? Math.round((c.matched_skills.length / total) * 100) : 0;
  const matchedChips = c.matched_skills.slice(0, 4).map((s) => `<span class="chip match">${escapeHtml(s)}</span>`).join("");
  const missChips = c.missing_skills.slice(0, 2).map((s) => `<span class="chip miss">${escapeHtml(s)}</span>`).join("");
  const moreN = total - Math.min(4, c.matched_skills.length) - Math.min(2, c.missing_skills.length);
  const more = moreN > 0 ? `<span class="chip more">+${moreN}</span>` : "";
  const engineTag = c.engine !== "offline" ? `<span class="cand-engine ${c.engine}">AI · ${c.engine}</span>` : "";
  const warn = c.warnings && c.warnings.length ? `<div class="warn-flag">⚠ ${escapeHtml(c.warnings[0])}</div>` : "";

  return `
    <tr>
      <td><span class="rank-badge ${rankCls}">${c.rank}</span></td>
      <td>
        <div class="cand-name">${escapeHtml(c.candidate_name || c.filename)}${engineTag}</div>
        <div class="cand-file">${escapeHtml(c.filename)}</div>
        ${warn}
      </td>
      <td>
        <div class="score-cell">
          <span class="score-num ${scoreClass(c.score)}">${c.score.toFixed(0)}</span>
        </div>
      </td>
      <td>
        <div class="skill-bar">
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="chips">${matchedChips}${missChips}${more}</div>
        </div>
      </td>
      <td><button class="detail-btn" data-file="${escapeHtml(c.filename)}">View</button></td>
    </tr>`;
}

// ---------- Charts ----------
// Read a CSS custom property so charts follow the active (light/dark) palette.
const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function renderCharts(r) {
  if (typeof Chart === "undefined") return; // CDN blocked — skip gracefully
  const top = r.candidates.slice(0, 8);

  // Distribution buckets
  const buckets = [0, 0, 0, 0, 0]; // 0-20,20-40,40-60,60-80,80-100
  for (const c of r.candidates) buckets[Math.min(4, Math.floor(c.score / 20))]++;

  if (state.distChart) state.distChart.destroy();
  state.distChart = new Chart($("dist-chart"), {
    type: "bar",
    data: {
      labels: ["0–20", "20–40", "40–60", "60–80", "80–100"],
      datasets: [{
        data: buckets,
        backgroundColor: [
          cssVar("--dist-1"), cssVar("--dist-2"), cssVar("--dist-3"),
          cssVar("--dist-4"), cssVar("--dist-5"),
        ],
        borderRadius: 6,
      }],
    },
    options: chartOpts("Candidates"),
  });

  if (state.breakdownChart) state.breakdownChart.destroy();
  state.breakdownChart = new Chart($("breakdown-chart"), {
    type: "bar",
    data: {
      labels: top.map((c) => truncate(c.candidate_name || c.filename, 14)),
      datasets: [
        ds("Skills", top.map((c) => c.breakdown.skills), cssVar("--series-1")),
        ds("Similarity", top.map((c) => c.breakdown.similarity), cssVar("--series-2")),
        ds("Keywords", top.map((c) => c.breakdown.keywords), cssVar("--series-3")),
      ],
    },
    options: { ...chartOpts("Score"), scales: stackScales() },
  });
}

function ds(label, data, color) {
  return { label, data, backgroundColor: color, borderRadius: 4 };
}
function chartOpts(yTitle) {
  const grid = cssVar("--chart-grid");
  const tick = cssVar("--chart-tick");
  return {
    responsive: true,
    plugins: { legend: { display: yTitle === "Score", labels: { color: tick, boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: tick }, grid: { color: grid } },
      y: { beginAtZero: true, ticks: { color: tick }, grid: { color: grid } },
    },
  };
}
function stackScales() {
  const grid = cssVar("--chart-grid");
  const tick = cssVar("--chart-tick");
  return {
    x: { ticks: { color: tick }, grid: { color: grid } },
    y: { beginAtZero: true, max: 100, ticks: { color: tick }, grid: { color: grid } },
  };
}

// ---------- Modal ----------
function openModal(filename) {
  const c = state.results.candidates.find((x) => x.filename === filename);
  if (!c) return;
  const b = c.breakdown;
  const skillsByCat = {};
  for (const s of c.all_skills) (skillsByCat[s.category] ||= []).push(s.name);

  $("modal-body").innerHTML = `
    <h2>${escapeHtml(c.candidate_name || c.filename)}</h2>
    <p class="muted">${escapeHtml(c.filename)} · Rank #${c.rank} · Score
      <strong class="${scoreClass(c.score)}">${c.score.toFixed(0)}</strong>
      ${c.engine !== "offline" ? `· <span class="cand-engine ${c.engine}">AI · ${c.engine}</span>` : ""}
    </p>

    ${c.rationale ? `<div class="modal-section"><h4>AI Rationale</h4><div class="rationale">${escapeHtml(c.rationale)}</div></div>` : ""}

    <div class="modal-section">
      <h4>Score Breakdown</h4>
      <div class="mini-breakdown">
        <div class="mini-stat"><div class="k">Skill Coverage</div><div class="v">${b.skills.toFixed(0)}</div></div>
        <div class="mini-stat"><div class="k">Similarity</div><div class="v">${b.similarity.toFixed(0)}</div></div>
        <div class="mini-stat"><div class="k">Keywords</div><div class="v">${b.keywords.toFixed(0)}</div></div>
        <div class="mini-stat"><div class="k">${b.llm !== null ? "LLM Score" : "Offline Composite"}</div><div class="v">${(b.llm !== null ? b.llm : b.offline_composite).toFixed(0)}</div></div>
      </div>
    </div>

    <div class="modal-section">
      <h4>Matched Skills (${c.matched_skills.length})</h4>
      <div class="chips">${c.matched_skills.map((s) => `<span class="chip match">${escapeHtml(s)}</span>`).join("") || '<span class="muted">None</span>'}</div>
    </div>
    <div class="modal-section">
      <h4>Missing Skills (${c.missing_skills.length})</h4>
      <div class="chips">${c.missing_skills.map((s) => `<span class="chip miss">${escapeHtml(s)}</span>`).join("") || '<span class="muted">None</span>'}</div>
    </div>
    <div class="modal-section">
      <h4>All Detected Skills</h4>
      ${Object.entries(skillsByCat).map(([cat, list]) =>
        `<div style="margin-bottom:8px"><div class="muted" style="font-size:12px">${escapeHtml(cat)}</div><div class="chips">${list.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join("")}</div></div>`
      ).join("") || '<span class="muted">None detected</span>'}
    </div>
    ${c.warnings && c.warnings.length ? `<div class="modal-section"><h4>Warnings</h4>${c.warnings.map((w) => `<div class="warn-flag">⚠ ${escapeHtml(w)}</div>`).join("")}</div>` : ""}
  `;
  $("modal").hidden = false;
}

// ---------- Export ----------
async function exportResults(fmt) {
  if (!state.results) return;
  const body = {
    format: fmt,
    job_title: (state.results.job.text || "Job Description").slice(0, 60),
    candidates: state.results.candidates,
  };
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Export failed.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fmt === "pdf" ? "screening_report.pdf" : "screening_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showError(e.message);
  }
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const SAMPLE_JD = `Senior Python Engineer — AI / NLP

We are hiring a Senior Python Engineer to build AI-powered document processing systems.

Requirements:
- 5+ years of Python development
- Strong experience with NLP and machine learning (spaCy, scikit-learn, PyTorch)
- Building and consuming REST APIs (FastAPI or Flask)
- Experience with LLMs and prompt engineering
- Familiarity with Docker, AWS, and CI/CD pipelines
- SQL and PostgreSQL
- Excellent communication and teamwork

Nice to have: TypeScript, React, Kubernetes, data engineering (Airflow, Spark).`;

// ---------- Wire up ----------
function init() {
  loadHealth();

  const dz = $("dropzone");
  const fi = $("file-input");
  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fi.click(); });
  fi.addEventListener("change", () => addFiles(fi.files));
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  $("jd").addEventListener("input", () => {
    $("jd-count").textContent = `${$("jd").value.length} chars`;
    updateScreenBtn();
  });
  $("sample-jd").addEventListener("click", () => {
    $("jd").value = SAMPLE_JD;
    $("jd").dispatchEvent(new Event("input"));
  });

  $("screen-btn").addEventListener("click", runScreen);
  $("clear-btn").addEventListener("click", () => {
    state.files = []; state.results = null;
    renderFileList(); updateScreenBtn();
    $("results").hidden = true; showError("");
  });

  $("export-csv").addEventListener("click", () => exportResults("csv"));
  $("export-pdf").addEventListener("click", () => exportResults("pdf"));

  $("modal-close").addEventListener("click", () => ($("modal").hidden = true));
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });

  // Sortable columns
  document.querySelectorAll(".rank-table th[data-sort]").forEach((th) =>
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = key === "candidate_name" ? 1 : -1; }
      if (state.results) renderTable();
    })
  );

  // Recolor charts when the OS light/dark preference changes.
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener?.("change", () => {
    if (state.results) renderCharts(state.results);
  });
}

document.addEventListener("DOMContentLoaded", init);
