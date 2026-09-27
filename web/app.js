/* ============================================================
   AI Resume Screener — SPA Dashboard Logic (fully wired)
   ============================================================ */

const state = {
  activeTab: "create",
  jobTitle: "Senior Frontend Developer",
  jobDescription: "",
  files: [],
  results: null,
  skillsChart: null,
  // Per-candidate status: filename -> 'shortlisted' | 'rejected' | null
  candidateStatus: {},
  // Saved jobs from localStorage
  savedJobs: [],
  // Active filter for candidates view
  candidateFilter: "all",   // all | shortlisted | rejected
  searchQuery: "",
};

const $ = (id) => document.getElementById(id);

// ---------- Notifications (simple toast) ----------
function toast(msg, type = "info") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ---------- Tab Navigation ----------
function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll(".nav-item[data-tab]").forEach(el => {
    el.classList.toggle("active", el.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-pane").forEach(el => {
    el.classList.toggle("active", el.id === `tab-${tabId}`);
  });

  if (tabId === "analytics" && state.results) renderAnalytics(state.results);
  if (tabId === "dashboard") renderDashboard();
  if (tabId === "candidates") renderCandidates();
}

// ---------- File Handling ----------
const ALLOWED = [".pdf", ".docx", ".txt", ".md"];
function isAllowed(name) { return ALLOWED.some(ext => name.toLowerCase().endsWith(ext)); }
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function addFiles(fileList) {
  for (const f of fileList) {
    if (!isAllowed(f.name)) { toast(`"${f.name}" is not supported. Use PDF, DOCX, or TXT.`, "error"); continue; }
    if (state.files.some(x => x.name === f.name && x.size === f.size)) continue;
    state.files.push(f);
  }
  renderFileList();
  updateScreenBtn();
}

function renderFileList() {
  const ul = $("file-list");
  if (state.files.length === 0) { ul.innerHTML = ""; return; }
  ul.innerHTML = state.files.map((f, i) => `
    <li>
      <span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        ${escapeHtml(f.name)}
        <span class="muted" style="font-size:11px; margin-left:8px;">${humanSize(f.size)}</span>
      </span>
      <button class="remove" data-i="${i}" title="Remove file">✕</button>
    </li>`
  ).join("");

  ul.querySelectorAll(".remove").forEach(btn =>
    btn.addEventListener("click", () => {
      state.files.splice(Number(btn.dataset.i), 1);
      renderFileList();
      updateScreenBtn();
    })
  );
}

function updateScreenBtn() {
  const btn = $("screen-btn");
  if (!state.jobDescription.trim()) {
    btn.disabled = true;
    btn.textContent = "Add Job Description First";
  } else if (state.files.length === 0) {
    btn.disabled = true;
    btn.textContent = "Upload Resumes First";
  } else {
    btn.disabled = false;
    btn.textContent = `Screen ${state.files.length} Resume${state.files.length > 1 ? "s" : ""}`;
  }
}

// ---------- Screening API ----------
function showError(msg) {
  const box = $("error-box");
  box.hidden = !msg;
  box.textContent = msg;
}

function setLoading(on) {
  $("loading").hidden = !on;
  document.querySelectorAll(".tab-pane").forEach(el => {
    el.style.display = on ? "none" : "";
  });
  if (!on) switchTab(state.activeTab); // restore proper visibility
}

async function runScreen() {
  showError("");
  if (!state.jobDescription.trim() || state.files.length === 0) return;

  const form = new FormData();
  form.append("job_description", state.jobDescription);
  for (const f of state.files) form.append("files", f, f.name);

  setLoading(true);
  try {
    const res = await fetch("/api/screen", { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error (${res.status})`);
    }
    state.results = await res.json();
    state.candidateStatus = {}; // reset statuses for new run
    state.candidateFilter = "all";
    setLoading(false);
    toast(`Screened ${state.results.count} candidates successfully.`, "success");
    switchTab("candidates");
    renderCandidates();
  } catch (e) {
    showError(e.message || "Screening failed. Please try again.");
    setLoading(false);
  }
}

// ---------- Candidate Status (Shortlist / Reject) ----------
function setStatus(filename, status) {
  // Toggle off if already that status
  if (state.candidateStatus[filename] === status) {
    state.candidateStatus[filename] = null;
    toast(`Status cleared for ${filename}.`);
  } else {
    state.candidateStatus[filename] = status;
    toast(`${filename} marked as ${status}.`, status === "shortlisted" ? "success" : "error");
  }
  renderCandidates();
}

// ---------- Render Candidates ----------
function getInitials(name) {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getFilteredCandidates() {
  if (!state.results) return [];
  let list = state.results.candidates;

  // Apply status filter
  if (state.candidateFilter !== "all") {
    list = list.filter(c => state.candidateStatus[c.filename] === state.candidateFilter);
  }

  // Apply search filter
  const q = state.searchQuery.toLowerCase();
  if (q) {
    list = list.filter(c =>
      (c.candidate_name || c.filename).toLowerCase().includes(q) ||
      [...c.matched_skills, ...c.missing_skills].some(s => s.toLowerCase().includes(q))
    );
  }
  return list;
}

function renderCandidates() {
  if (!state.results) {
    $("cand-count").textContent = "No results yet";
    $("candidates-list").innerHTML = `<p class="muted">Run AI Screening first from the Upload Resumes tab.</p>`;
    return;
  }

  const list = getFilteredCandidates();
  const total = state.results.candidates.length;
  const shortlisted = Object.values(state.candidateStatus).filter(s => s === "shortlisted").length;
  const rejected = Object.values(state.candidateStatus).filter(s => s === "rejected").length;

  $("cand-count").textContent = `${list.length} of ${total} candidates`;
  $("cand-stats-row").innerHTML = `
    <span>${total} Total</span>
    <span style="color:var(--good)">${shortlisted} Shortlisted</span>
    <span style="color:var(--bad)">${rejected} Rejected</span>
  `;

  const container = $("candidates-list");
  if (list.length === 0) {
    container.innerHTML = `<p class="muted">No candidates match the current filter.</p>`;
    return;
  }

  container.innerHTML = list.map(c => {
    const total = c.matched_skills.length + c.missing_skills.length;
    const matchPct = total ? Math.round((c.matched_skills.length / total) * 100) : 0;
    const status = state.candidateStatus[c.filename] || null;

    const matches = c.matched_skills.slice(0, 4).map(s => `<span class="tag match">${escapeHtml(s)}</span>`);
    const misses = c.missing_skills.slice(0, 2).map(s => `<span class="tag miss">${escapeHtml(s)}</span>`);
    const scoreColor = c.score >= 70 ? "var(--good)" : c.score >= 45 ? "#ca8a04" : "var(--bad)";
    const statusBadge = status === "shortlisted"
      ? `<span class="status-badge shortlisted">Shortlisted</span>`
      : status === "rejected"
      ? `<span class="status-badge rejected">Rejected</span>`
      : "";

    return `
    <div class="cand-card ${status || ""}" data-filename="${escapeHtml(c.filename)}">
      <div class="cand-avatar">${getInitials(c.candidate_name || c.filename)}</div>
      <div class="cand-info">
        <div class="cand-header">
          <div>
            <h3 class="cand-name">${escapeHtml(c.candidate_name || c.filename)} ${statusBadge}</h3>
            <p class="cand-role">${escapeHtml(c.filename)}</p>
          </div>
          <div class="match-box">
            <span class="match-pct" style="color:${scoreColor}">${c.score.toFixed(0)}% Match</span>
            <div class="match-bar-bg"><div class="match-bar-fill" style="width:${c.score}%; background:${scoreColor}"></div></div>
          </div>
        </div>

        <div class="tags">${matches.join("")}${misses.join("")}</div>

        <div class="cand-meta">
          <span>${matchPct}% Skill Match</span>
          <span>Score: ${c.score.toFixed(1)}/100</span>
          ${c.engine !== "offline" ? `<span>AI: ${c.engine}</span>` : ""}
        </div>

        <div class="cand-actions">
          <button class="action-btn view-btn" data-file="${escapeHtml(c.filename)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            View Resume
          </button>
          <button class="action-btn shortlist-btn ${status === 'shortlisted' ? 'active' : ''}" data-file="${escapeHtml(c.filename)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            ${status === "shortlisted" ? "Shortlisted" : "Shortlist"}
          </button>
          <button class="action-btn reject-btn ${status === 'rejected' ? 'active-bad' : ''}" data-file="${escapeHtml(c.filename)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            ${status === "rejected" ? "Rejected" : "Reject"}
          </button>
        </div>
      </div>
    </div>`;
  }).join("");

  // Wire buttons
  container.querySelectorAll(".view-btn").forEach(btn =>
    btn.addEventListener("click", () => openModal(btn.dataset.file))
  );
  container.querySelectorAll(".shortlist-btn").forEach(btn =>
    btn.addEventListener("click", () => setStatus(btn.dataset.file, "shortlisted"))
  );
  container.querySelectorAll(".reject-btn").forEach(btn =>
    btn.addEventListener("click", () => setStatus(btn.dataset.file, "rejected"))
  );
}

// ---------- Dashboard ----------
function renderDashboard() {
  const dash = $("dashboard-content");
  if (!state.results) {
    dash.innerHTML = `<p class="muted">No screening results yet. Go to <a href="#" data-tab-link="create">Create Job</a> to get started.</p>`;
    dash.querySelector("[data-tab-link]")?.addEventListener("click", e => { e.preventDefault(); switchTab("create"); });
    return;
  }
  const r = state.results;
  const scores = r.candidates.map(c => c.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const shortlisted = Object.values(state.candidateStatus).filter(s => s === "shortlisted").length;
  const rejected = Object.values(state.candidateStatus).filter(s => s === "rejected").length;

  dash.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total Candidates</div><div class="stat-value">${r.count}</div></div>
      <div class="stat-card"><div class="stat-label">Top Score</div><div class="stat-value">${scores[0].toFixed(0)}</div></div>
      <div class="stat-card"><div class="stat-label">Average Score</div><div class="stat-value">${avg.toFixed(1)}</div></div>
      <div class="stat-card"><div class="stat-label">Shortlisted</div><div class="stat-value" style="color:var(--good)">${shortlisted}</div></div>
      <div class="stat-card"><div class="stat-label">Rejected</div><div class="stat-value" style="color:var(--bad)">${rejected}</div></div>
      <div class="stat-card"><div class="stat-label">Strong Fits (70+)</div><div class="stat-value">${scores.filter(s => s >= 70).length}</div></div>
    </div>
    <div class="card" style="margin-top:24px;">
      <h3>Top 5 Candidates</h3>
      <table class="simple-table" style="margin-top:16px;">
        <thead><tr><th>#</th><th>Name</th><th>Score</th><th>Status</th></tr></thead>
        <tbody>
          ${r.candidates.slice(0, 5).map((c, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(c.candidate_name || c.filename)}</td>
              <td style="font-weight:600">${c.score.toFixed(0)}</td>
              <td><span class="status-badge ${state.candidateStatus[c.filename] || ''}">${state.candidateStatus[c.filename] || "Pending"}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- Analytics ----------
function renderAnalytics(r) {
  if (typeof Chart === "undefined") return;

  const skillFreq = {};
  for (const c of r.candidates) {
    for (const s of (c.all_skills || [])) {
      skillFreq[s.name] = (skillFreq[s.name] || 0) + 1;
    }
    // Also count matched skills if all_skills not available
    for (const s of (c.matched_skills || [])) {
      if (!c.all_skills) skillFreq[s] = (skillFreq[s] || 0) + 1;
    }
  }

  const sorted = Object.entries(skillFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (state.skillsChart) state.skillsChart.destroy();
  state.skillsChart = new Chart($("skills-chart"), {
    type: "bar",
    data: {
      labels: sorted.map(x => x[0]),
      datasets: [{ data: sorted.map(x => x[1]), backgroundColor: "#111827", borderRadius: 2, barThickness: 24 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "#f3f4f6" }, ticks: { stepSize: 1 } },
        y: { grid: { display: false }, ticks: { color: "#6b7280" } },
      },
    },
  });
}

// ---------- Export ----------
async function exportResults(fmt) {
  if (!state.results) { toast("No results to export. Run screening first.", "error"); return; }
  const body = {
    format: fmt,
    job_title: state.jobTitle || "Job Description",
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
    toast(`${fmt.toUpperCase()} exported successfully.`, "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------- Save Job / Save as Draft ----------
function saveJob(publish = true) {
  const title = $("job-title").value.trim();
  if (!title) { toast("Job title is required.", "error"); return; }
  if (!state.jobDescription.trim()) { toast("Job description is required.", "error"); return; }

  const job = {
    id: Date.now(),
    title,
    description: state.jobDescription,
    published: publish,
    createdAt: new Date().toISOString(),
  };

  const jobs = JSON.parse(localStorage.getItem("tf_jobs") || "[]");
  jobs.push(job);
  localStorage.setItem("tf_jobs", JSON.stringify(jobs));
  state.savedJobs = jobs;

  renderJobList();
  toast(publish ? `"${title}" published.` : `"${title}" saved as draft.`, "success");
  if (publish) switchTab("upload");
}

function renderJobList() {
  const jobs = JSON.parse(localStorage.getItem("tf_jobs") || "[]");
  const nav = $("job-nav-list");
  if (!nav) return;
  nav.innerHTML = jobs.slice(-5).reverse().map(j => `
    <a href="#" class="nav-item ${j.id === state.activeJobId ? 'active' : ''}" data-job-id="${j.id}" title="${escapeHtml(j.title)}">
      ${escapeHtml(j.title)}${j.published ? "" : " (Draft)"}
    </a>
  `).join("") || `<span class="nav-item" style="opacity:0.4;pointer-events:none">No jobs yet</span>`;

  nav.querySelectorAll(".nav-item[data-job-id]").forEach(el =>
    el.addEventListener("click", e => {
      e.preventDefault();
      const job = jobs.find(j => j.id === Number(el.dataset.jobId));
      if (!job) return;
      state.activeJobId = job.id;
      state.jobTitle = job.title;
      state.jobDescription = job.description;
      $("job-title").value = job.title;
      $("jd").value = job.description;
      $("preview-title").textContent = job.title;
      $("jd").dispatchEvent(new Event("input"));
      renderJobList();
      switchTab("create");
    })
  );
}

// ---------- Candidate Filter ----------
function setFilter(filter) {
  state.candidateFilter = filter;
  document.querySelectorAll(".filter-btn").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.filter === filter)
  );
  renderCandidates();
}

// ---------- Search ----------
function handleSearch(q) {
  state.searchQuery = q;
  // If on candidates tab, live filter; otherwise navigate there
  if (state.activeTab !== "candidates") switchTab("candidates");
  renderCandidates();
}

// ---------- Modal ----------
function openModal(filename) {
  if (!state.results) return;
  const c = state.results.candidates.find(x => x.filename === filename);
  if (!c) return;

  const skillsByCat = {};
  for (const s of (c.all_skills || [])) (skillsByCat[s.category] ||= []).push(s.name);
  const hasCats = Object.keys(skillsByCat).length > 0;
  const scoreColor = c.score >= 70 ? "var(--good)" : c.score >= 45 ? "#ca8a04" : "var(--bad)";

  $("modal-body").innerHTML = `
    <h2 style="margin:0 0 4px">${escapeHtml(c.candidate_name || c.filename)}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px">${escapeHtml(c.filename)} · Rank #${c.rank}</p>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
      <div class="card" style="padding:16px;text-align:center">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Overall</div>
        <div style="font-size:28px;font-weight:700;color:${scoreColor}">${c.score.toFixed(0)}</div>
      </div>
      <div class="card" style="padding:16px;text-align:center">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Skills</div>
        <div style="font-size:28px;font-weight:700">${c.breakdown.skills.toFixed(0)}</div>
      </div>
      <div class="card" style="padding:16px;text-align:center">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Keywords</div>
        <div style="font-size:28px;font-weight:700">${c.breakdown.keywords.toFixed(0)}</div>
      </div>
    </div>

    ${c.rationale ? `
    <h4 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">AI Rationale</h4>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:14px;line-height:1.6;margin-bottom:24px">${escapeHtml(c.rationale)}</div>
    ` : ""}

    <h4 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Matched Skills (${c.matched_skills.length})</h4>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px">
      ${c.matched_skills.map(s => `<span class="tag match">${escapeHtml(s)}</span>`).join("") || '<span style="color:#6b7280;font-size:14px">None</span>'}
    </div>

    <h4 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Missing Skills (${c.missing_skills.length})</h4>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px">
      ${c.missing_skills.map(s => `<span class="tag miss">${escapeHtml(s)}</span>`).join("") || '<span style="color:#6b7280;font-size:14px">None</span>'}
    </div>

    ${hasCats ? `
    <h4 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">All Detected Skills</h4>
    <div>
      ${Object.entries(skillsByCat).map(([cat, list]) => `
        <div style="margin-bottom:12px">
          <div style="font-size:11px;color:#6b7280;margin-bottom:4px">${escapeHtml(cat)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${list.map(s => `<span class="tag neutral">${escapeHtml(s)}</span>`).join("")}</div>
        </div>`).join("")}
    </div>
    ` : ""}

    ${c.warnings && c.warnings.length ? `
    <h4 style="margin:16px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--bad)">Warnings</h4>
    ${c.warnings.map(w => `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:12px;font-size:13px;color:#991b1b;margin-bottom:8px">${escapeHtml(w)}</div>`).join("")}
    ` : ""}

    <div style="display:flex;gap:12px;margin-top:24px;padding-top:24px;border-top:1px solid #e5e7eb">
      <button class="btn-dark" onclick="setStatus('${escapeHtml(c.filename)}','shortlisted');$('modal').hidden=true">Shortlist</button>
      <button class="btn-ghost" onclick="setStatus('${escapeHtml(c.filename)}','rejected');$('modal').hidden=true">Reject</button>
    </div>
  `;
  $("modal").hidden = false;
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

const SAMPLE_JD = `Senior Frontend Developer

We are hiring a Senior Frontend Developer to build high-performance React applications.

Requirements:
- 5+ years of frontend development experience
- Strong experience with React, TypeScript, and state management (Redux, Zustand)
- Testing with Jest and React Testing Library
- Understanding of HTML, CSS, and modern web APIs
- Familiarity with CI/CD pipelines, Git, and AWS
- Excellent communication and teamwork

Nice to have: Next.js, GraphQL, Docker, Figma-to-code experience.`;

// ---------- Init ----------
function init() {
  // Tabs
  document.querySelectorAll(".nav-item[data-tab]").forEach(el => {
    el.addEventListener("click", e => { e.preventDefault(); switchTab(el.dataset.tab); });
  });

  // Create Job form
  $("job-title").addEventListener("input", e => {
    state.jobTitle = e.target.value;
    $("preview-title").textContent = state.jobTitle || "Job Title";
  });
  $("jd").addEventListener("input", e => {
    state.jobDescription = e.target.value;
    updateScreenBtn();
  });
  $("sample-jd").addEventListener("click", () => {
    $("jd").value = SAMPLE_JD;
    $("jd").dispatchEvent(new Event("input"));
  });
  $("save-job-btn").addEventListener("click", () => saveJob(true));
  $("save-draft-btn").addEventListener("click", () => saveJob(false));

  // Dropzone
  const dz = $("dropzone");
  const fi = $("file-input");
  dz.addEventListener("click", e => { if (e.target !== fi) fi.click(); });
  fi.addEventListener("change", () => addFiles(fi.files));
  ["dragenter", "dragover"].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", e => addFiles(e.dataTransfer.files));

  // Screen button
  $("screen-btn").addEventListener("click", runScreen);

  // Export buttons
  $("export-pdf").addEventListener("click", () => exportResults("pdf"));
  $("export-csv").addEventListener("click", () => exportResults("csv"));

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach(btn =>
    btn.addEventListener("click", () => setFilter(btn.dataset.filter))
  );

  // Search
  $("search-input").addEventListener("input", e => handleSearch(e.target.value));

  // Modal close
  $("modal-close").addEventListener("click", () => ($("modal").hidden = true));
  $("modal").addEventListener("click", e => { if (e.target === $("modal")) $("modal").hidden = true; });

  // Bell icon — show shortlist summary
  $("bell-btn").addEventListener("click", () => {
    if (!state.results) { toast("No screening results yet.", "info"); return; }
    const s = Object.values(state.candidateStatus).filter(x => x === "shortlisted").length;
    const r = Object.values(state.candidateStatus).filter(x => x === "rejected").length;
    toast(`${s} shortlisted, ${r} rejected out of ${state.results.count} candidates.`, "info");
  });

  // Load saved jobs
  renderJobList();
  updateScreenBtn();
  switchTab("create");
}

document.addEventListener("DOMContentLoaded", init);
