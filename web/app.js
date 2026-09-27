/* ============================================================
   AI Resume Screener — SPA Dashboard Logic
   ============================================================ */

const state = {
  activeTab: "create",
  jobTitle: "Senior Frontend Developer",
  jobDescription: "",
  files: [],
  results: null,
  skillsChart: null,
};

const $ = (id) => document.getElementById(id);

// ---------- Tab Navigation ----------
function switchTab(tabId) {
  state.activeTab = tabId;
  
  // Update sidebar active state
  document.querySelectorAll(".nav-item[data-tab]").forEach(el => {
    el.classList.toggle("active", el.dataset.tab === tabId);
  });
  
  // Update main content panes
  document.querySelectorAll(".tab-pane").forEach(el => {
    el.classList.toggle("active", el.id === `tab-${tabId}`);
  });

  if (tabId === "analytics" && state.results) {
    renderAnalytics(state.results);
  }
}

// ---------- File Handling ----------
const ALLOWED = [".pdf", ".docx", ".txt", ".md"];
function isAllowed(name) {
  return ALLOWED.some((ext) => name.toLowerCase().endsWith(ext));
}
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  ul.innerHTML = state.files.map((f, i) => `
      <li>
        <span>📄 ${escapeHtml(f.name)} <span class="muted" style="font-size:11px; margin-left:8px;">${humanSize(f.size)}</span></span>
        <button class="remove" data-i="${i}" title="Remove">✕</button>
      </li>`
  ).join("");
  
  ul.querySelectorAll(".remove").forEach((btn) =>
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
    btn.textContent = "Run AI Screening (Requires Job Description)";
  } else if (state.files.length === 0) {
    btn.disabled = true;
    btn.textContent = "Run AI Screening (Upload files first)";
  } else {
    btn.disabled = false;
    btn.textContent = "Run AI Screening";
  }
}

// ---------- API / Screening ----------
function showError(msg) {
  const box = $("error-box");
  box.hidden = !msg;
  box.textContent = msg;
}

function setLoading(on) {
  $("loading").hidden = !on;
  // Hide all tabs while loading
  document.querySelectorAll(".tab-pane").forEach(el => {
    if (on) el.style.display = "none";
    else {
      // Restore the active tab display
      if (el.id === `tab-${state.activeTab}`) {
        el.style.display = ""; 
      }
    }
  });
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
    
    // Move to candidates tab upon success
    switchTab("candidates");
    renderCandidates(state.results);
  } catch (e) {
    showError(e.message || "Screening failed.");
    setLoading(false);
  }
}

// ---------- Render Candidates ----------
function getInitials(name) {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderCandidates(r) {
  setLoading(false);
  $("cand-count").textContent = `${r.count} candidates found`;
  
  const list = $("candidates-list");
  if (!r.candidates || r.candidates.length === 0) {
    list.innerHTML = `<p class="muted">No candidates processed.</p>`;
    return;
  }

  list.innerHTML = r.candidates.map((c) => {
    const total = c.matched_skills.length + c.missing_skills.length;
    const matchPct = total ? Math.round((c.matched_skills.length / total) * 100) : 0;
    
    // We mix matches and misses, limiting to 5 total for the UI
    const matches = c.matched_skills.slice(0, 4).map(s => `<span class="tag match">${escapeHtml(s)}</span>`);
    const misses = c.missing_skills.slice(0, 2).map(s => `<span class="tag miss">${escapeHtml(s)}</span>`);
    
    return `
    <div class="cand-card">
      <div class="cand-avatar">${getInitials(c.candidate_name || c.filename)}</div>
      <div class="cand-info">
        <div class="cand-header">
          <div>
            <h3 class="cand-name">${escapeHtml(c.candidate_name || c.filename)}</h3>
            <p class="cand-role">${escapeHtml(c.filename)}</p>
          </div>
          <div class="match-box">
            <span class="match-pct">${c.score.toFixed(0)}% Match</span>
            <div class="match-bar-bg"><div class="match-bar-fill" style="width: ${c.score}%"></div></div>
          </div>
        </div>
        
        <div class="tags">
          ${matches.join("")}
          ${misses.join("")}
        </div>
        
        <div class="cand-meta">
          <span>Match: ${matchPct}% Skills</span>
          <span>Score: ${c.score.toFixed(1)}/100</span>
          ${c.engine !== 'offline' ? `<span>AI: ${c.engine}</span>` : ''}
        </div>
        
        <div class="cand-actions">
          <button class="action-btn" onclick="openModal('${escapeHtml(c.filename)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            View Resume
          </button>
          <button class="action-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            Shortlist
          </button>
          <button class="action-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            Reject
          </button>
        </div>
      </div>
    </div>
    `;
  }).join("");
}

// ---------- Render Analytics ----------
function renderAnalytics(r) {
  if (typeof Chart === "undefined") return;

  // Aggregate skills frequency
  const skillFreq = {};
  for (const c of r.candidates) {
    for (const s of c.all_skills) {
      skillFreq[s.name] = (skillFreq[s.name] || 0) + 1;
    }
  }

  // Sort and pick top 10
  const sorted = Object.entries(skillFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  if (state.skillsChart) state.skillsChart.destroy();
  
  state.skillsChart = new Chart($("skills-chart"), {
    type: "bar",
    data: {
      labels: sorted.map(x => x[0]),
      datasets: [{
        data: sorted.map(x => x[1]),
        backgroundColor: "#000000", // The strict black color from Figma screenshot
        borderRadius: 2,
        barThickness: 24,
      }],
    },
    options: {
      indexAxis: 'y', // Horizontal bar chart like in the Figma screenshot
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "#f3f4f6", drawBorder: false }, ticks: { stepSize: 15 } },
        y: { grid: { display: false }, ticks: { color: "#6b7280" } },
      },
    }
  });
}

// ---------- Modal Details ----------
function openModal(filename) {
  if (!state.results) return;
  const c = state.results.candidates.find((x) => x.filename === filename);
  if (!c) return;

  $("modal-body").innerHTML = `
    <h2 style="margin:0 0 8px">${escapeHtml(c.candidate_name || c.filename)}</h2>
    <p style="margin:0 0 24px; color:#6b7280">${escapeHtml(c.filename)}</p>
    
    <div style="margin-bottom:24px; padding:16px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:8px">
        <span style="font-weight:600">Overall Score</span>
        <span style="font-weight:600; color:#111827">${c.score.toFixed(1)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:14px; color:#6b7280">
        <span>Skill Match</span>
        <span>${c.breakdown.skills.toFixed(1)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:14px; color:#6b7280">
        <span>AI Keywords</span>
        <span>${c.breakdown.keywords.toFixed(1)}</span>
      </div>
    </div>
    
    <h4 style="margin:0 0 12px; font-size:14px">AI Rationale</h4>
    <p style="margin:0 0 24px; font-size:14px; line-height:1.5; color:#374151">
      ${c.rationale ? escapeHtml(c.rationale) : "No rationale provided by AI engine."}
    </p>
  `;
  $("modal").hidden = false;
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

const SAMPLE_JD = `Senior Frontend Developer

We are hiring a Senior Frontend Developer to build high-performance React applications.

Requirements:
- 5+ years of frontend development
- Strong experience with React, TypeScript, and state management (Redux, Zustand)
- Testing with Jest and React Testing Library
- Understanding of HTML, CSS, and modern web APIs
- Familiarity with CI/CD pipelines, Git, and AWS
- Excellent communication and teamwork
`;

// ---------- Initialization ----------
function init() {
  // Setup tabs
  document.querySelectorAll(".nav-item[data-tab]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(el.dataset.tab);
    });
  });

  // Setup Create Job form binding
  $("job-title").addEventListener("input", (e) => {
    state.jobTitle = e.target.value;
    $("preview-title").textContent = state.jobTitle || "Job Title";
  });
  $("jd").addEventListener("input", (e) => {
    state.jobDescription = e.target.value;
    updateScreenBtn();
  });
  $("sample-jd").addEventListener("click", () => {
    $("jd").value = SAMPLE_JD;
    $("jd").dispatchEvent(new Event("input"));
  });
  
  $("save-job-btn").addEventListener("click", () => {
    switchTab("upload"); // Move to upload step automatically
  });

  // Setup Dropzone
  const dz = $("dropzone");
  const fi = $("file-input");
  dz.addEventListener("click", () => fi.click());
  fi.addEventListener("change", () => addFiles(fi.files));
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  // Run AI Screening
  $("screen-btn").addEventListener("click", runScreen);

  // Modal
  $("modal-close").addEventListener("click", () => ($("modal").hidden = true));
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });

  // Init state
  updateScreenBtn();
  switchTab("create");
}

document.addEventListener("DOMContentLoaded", init);
