import {
  loadTrackAnalyticsData,
  applyFilters,
  uniqueValues,
} from "./track-analytics-data.js";
import {
  getDefaultState,
  parseStateFromUrl,
  writeStateToUrl,
  buildShareUrl,
} from "./track-analytics-state.js";
import {
  buildKpis,
  buildInsights,
  compareSlices,
  buildTeamInsights,
} from "./track-analytics-insights.js";
import {
  renderTrendChart,
  renderCategoryChart,
  renderCustomChart,
  renderCoachTrendChart,
  renderCoachEventChart,
  renderCoachTeamDepthChart,
  renderCoachRadarChart,
} from "./track-analytics-charts.js";

const filterIds = [
  "season",
  "gender",
  "eventId",
  "category",
  "schoolName",
  "meetId",
  "athleteName",
  "relayFilter",
  "markType",
  "startDate",
  "endDate",
  "placementMax",
  "compareBy",
  "compareEventId",
  "compareA",
  "compareB",
  "coachSchoolName",
  "coachAthleteName",
  "coachEventId",
  "coachMeetId",
  "chartType",
  "groupBy",
  "metric",
  "topN",
];

const idMap = {
  season: "seasonFilter",
  gender: "genderFilter",
  eventId: "eventFilter",
  category: "categoryFilter",
  schoolName: "schoolFilter",
  meetId: "meetFilter",
  athleteName: "athleteFilter",
  relayFilter: "relayFilter",
  markType: "markTypeFilter",
  startDate: "startDate",
  endDate: "endDate",
  placementMax: "placementMax",
  compareBy: "compareBy",
  compareEventId: "compareEventId",
  compareA: "compareA",
  compareB: "compareB",
  coachSchoolName: "coachSchoolName",
  coachAthleteName: "coachAthleteName",
  coachEventId: "coachEventId",
  coachMeetId: "coachMeetId",
  chartType: "chartType",
  groupBy: "groupBy",
  metric: "metric",
  topN: "topN",
};

let state = getDefaultState();
let allRows = [];
let filteredRows = [];
let contextData = { meets: [], events: [], athletes: [] };
const FAVORITE_TEAM_KEY = "track.favorite.team";
let coachDebounceTimer = null;

function el(id) {
  return document.getElementById(id);
}

function insightToHtml(text) {
  const esc = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function isCoachAuthorized() {
  return (
    typeof window !== "undefined" &&
    window.MSMTrackCoachAuth &&
    window.MSMTrackCoachAuth.isSignedIn()
  );
}

function coachScopeRows(team, athlete) {
  let rows = filteredRows;
  if (team) rows = rows.filter((r) => r.schoolName === team);
  if (athlete) rows = rows.filter((r) => r.athleteName === athlete);
  if (state.coachMeetId)
    rows = rows.filter((r) => r.meetId === state.coachMeetId);
  if (state.coachEventId)
    rows = rows.filter((r) => r.eventId === state.coachEventId);
  return rows;
}

function scheduleCoachRedraw() {
  if (coachDebounceTimer) clearTimeout(coachDebounceTimer);
  coachDebounceTimer = setTimeout(() => {
    pullStateFromInputs();
    renderCoachView();
    writeStateToUrl(state);
  }, 380);
}

function refreshCoachDependentSelects() {
  const team = state.coachSchoolName || el("coachSchoolName")?.value || "";
  const meetLabelFor = (id) =>
    contextData.meets?.find((m) => m.id === id)?.name ||
    filteredRows.find((r) => r.meetId === id)?.meetName ||
    id;

  let scopedForMeets = filteredRows;
  if (team) scopedForMeets = scopedForMeets.filter((r) => r.schoolName === team);
  let meetIds = [
    ...new Set(scopedForMeets.map((r) => r.meetId).filter(Boolean)),
  ].sort();

  const meetPickLabel = team
    ? "All meets (coach scope)"
    : "All meets in filters";
  const meetOpts = meetIds.map((id) => ({
    value: id,
    label: meetLabelFor(id),
  }));
  const prevMeet = state.coachMeetId;
  setOptions(
    "coachMeetId",
    meetOpts,
    "value",
    "label",
    true,
    meetPickLabel,
  );
  const meetNode = el("coachMeetId");
  if (
    meetNode &&
    prevMeet &&
    meetIds.some((id) => id === prevMeet)
  ) {
    meetNode.value = prevMeet;
    state.coachMeetId = prevMeet;
  } else state.coachMeetId = meetNode?.value || "";

  const athBase = team
    ? scopedForMeets.filter((r) => r.schoolName === team)
    : scopedForMeets;
  const athleteNames = uniqueValues(athBase, "athleteName");
  const athOpts = athleteNames.map((v) => ({ value: v, label: v }));
  const prevAth = state.coachAthleteName;
  setOptions(
    "coachAthleteName",
    athOpts,
    "value",
    "label",
    true,
    "Team roster overview",
  );
  const athNode = el("coachAthleteName");
  if (
    athNode &&
    prevAth &&
    athleteNames.some((n) => n === prevAth)
  ) {
    athNode.value = prevAth;
    state.coachAthleteName = prevAth;
  } else state.coachAthleteName = athNode?.value || "";
}

function updateCoachToolbarAccess() {
  const auth = isCoachAuthorized();
  const gated = ["printReportBtn", "printFilteredSummaryBtn", "shareCoachBtn", "printBtn"];
  gated.forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.disabled = id === "printBtn" ? false : !auth;
    node.style.opacity = auth || id === "printBtn" ? "1" : "0.48";
    node.title = auth
      ? ""
      : "Coach or admin login required — use Coach login link in navbar area.";
  });
  const printGlobal = el("printBtn");
  if (printGlobal) printGlobal.style.display = auth ? "" : "none";

  const hint = el("coachAuthHint");
  if (hint) hint.style.display = auth ? "none" : "";

  const pill = el("coachStatusPill");
  if (pill) {
    pill.textContent = auth
      ? "Signed in · print-ready reports enabled"
      : "Read-only summaries · sign in to print";
  }
}

function scheduleChartPrintPaint() {
  requestAnimationFrame(() => {
    [
      "trendChart",
      "categoryChart",
      "customChart",
      "coachTrendChart",
      "coachEventChart",
      "coachRadarChart",
      "coachTeamDepthChart",
    ].forEach((id) => {
      const cn = document.getElementById(id);
      const chart = cn && window.Chart?.getChart ? window.Chart.getChart(cn) : null;
      if (chart) chart.resize();
    });
  });
}

function triggerPrint(modeClass) {
  const meta = el("coachPrintMetaLine");
  if (meta && modeClass === "print-coach") {
    const parts = [];
    if (state.coachSchoolName) parts.push(`Team: ${state.coachSchoolName}`);
    if (state.coachAthleteName)
      parts.push(`Athlete: ${state.coachAthleteName}`);
    if (state.coachMeetId) {
      const label =
        contextData.meets?.find((m) => m.id === state.coachMeetId)?.name ||
        filteredRows.find((r) => r.meetId === state.coachMeetId)?.meetName ||
        state.coachMeetId;
      parts.push(`Meet focus: ${label}`);
    }
    meta.textContent = `${parts.join(" · ") || "Overview"} · Generated ${new Date().toLocaleString()}`;
  } else if (meta && modeClass === "print-analytics-scope") {
    meta.textContent = `Filtered dataset (${filteredRows.length} rows) · ${new Date().toLocaleString()}`;
  } else if (meta) {
    meta.textContent = "";
  }

  document.body.classList.remove("print-coach", "print-analytics-scope");
  if (modeClass) document.body.classList.add(modeClass);
  scheduleChartPrintPaint();
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove("print-coach", "print-analytics-scope");
    }, 800);
  }, 220);
}

function renderCoachDynamicInsights(team, athlete, athleteRows, teamRows) {
  const box = el("coachInsights");
  if (!box) return;
  const bullets = [];

  const totalScoped = athleteRows.length || teamRows.length;
  if (!team && !athlete) {
    box.innerHTML = "";
    return;
  }

  bullets.push(
    `Current scope captures **${totalScoped}** result rows from your global filters (season, gender, dates, etc.).`,
  );

  if (team) {
    bullets.push(...buildTeamInsights(teamRows));
  }
  if (athlete && athleteRows.length) {
    const best = athleteRows
      .filter((r) => Number.isFinite(r.bestTimeSeconds))
      .sort((a, b) => a.bestTimeSeconds - b.bestTimeSeconds)[0];
    const bestFld = athleteRows
      .filter((r) => Number.isFinite(r.bestFieldMark))
      .sort((a, b) => b.bestFieldMark - a.bestFieldMark)[0];
    if (best) {
      bullets.push(
        `Best run in scope: ${formatCoachMetric(best.bestTimeSeconds)} (${best.eventName} @ ${best.meetName}).`,
      );
    }
    if (bestFld) {
      bullets.push(
        `Best field progression in scope: ${bestFld.bestFieldMark.toFixed(2)} (${bestFld.eventName}).`,
      );
    }
  }

  box.innerHTML = bullets
    .map((t) => `<div class="insight-item">${insightToHtml(t)}</div>`)
    .join("");
}

function renderCoachTeamHeader(team, rosterSize, scopedCount) {
  const host = el("teamHeader");
  if (!host) return;
  if (!team) {
    host.innerHTML = "";
    return;
  }
  const initials = team
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 3)
    .join("")
    .toUpperCase();
  host.innerHTML = `
    <div class="team-header coach-live-header">
      <div class="team-logo">${initials}</div>
      <div class="team-info">
        <h4>${insightToHtml(team)}</h4>
        <p>${rosterSize} athletes in scope · ${scopedCount} result rows powering this dashboard · updates live when filters move</p>
      </div>
      <span class="badge coach-live-dot">● Live</span>
    </div>`;
}

function setOptions(
  selectId,
  options,
  valueKey = "value",
  labelKey = "label",
  includeAll = true,
  allLabel = "All",
) {
  const node = el(selectId);
  if (!node) return;
  const initial = includeAll ? `<option value="">${allLabel}</option>` : "";
  node.innerHTML =
    initial +
    options
      .map(
        (opt) =>
          `<option value="${String(opt[valueKey] || "")}">${String(opt[labelKey] || "")}</option>`,
      )
      .join("");
}

function hydrateInputsFromState() {
  Object.entries(idMap).forEach(([stateKey, domId]) => {
    const node = el(domId);
    if (!node) return;
    node.value = state[stateKey] || "";
  });
}

function pullStateFromInputs() {
  const next = { ...state };
  filterIds.forEach((key) => {
    const node = el(idMap[key]);
    if (!node) return;
    next[key] = node.value || "";
  });
  state = next;
}
function applyPanelVisibility() {
  // If no panels are specified in state, show everything by default
  if (!state.panels) return; 

  const allowedPanels = state.panels.split(',');
  const allPanels = [
    'kpiPanel', 'insightsPanel', 'comparePanel', 
    'chartBuilderPanel', 'vizPanel', 'coachPanel', 'explorerPanel'
  ];
  
  allPanels.forEach(id => {
    const node = el(id);
    if (node) {
      node.style.display = allowedPanels.includes(id) ? '' : 'none';
    }
  });
}

function renderPills() {
  const container = el("filterPills");
  if (!container) return;
  const labels = [];
  Object.entries(state).forEach(([k, v]) => {
    if (
      !v ||
      [
        "compareBy",
        "compareA",
        "compareB",
        "chartType",
        "groupBy",
        "metric",
        "topN",
        "coachSchoolName",
        "coachAthleteName",
        "coachEventId",
        "coachMeetId",
      ].includes(k)
    )
      return;
    labels.push(`<span class="state-pill">${k}: ${v}</span>`);
  });
  container.innerHTML =
    labels.join("") || `<span class="state-pill">No active filters</span>`;
}

function renderKpis() {
  const kpis = buildKpis(filteredRows);
  el("kpiGrid").innerHTML = kpis
    .map(
      (kpi) =>
        `<div class="kpi"><div class="kpi-label">${kpi.label}</div><div class="kpi-value">${kpi.value}</div></div>`,
    )
    .join("");
}

function renderInsights() {
  const insights = buildInsights(filteredRows);
  el("insights").innerHTML = insights
    .map((text) => `<div class="insight-item">${insightToHtml(text)}</div>`)
    .join("");
}

function renderComparison() {
  const output = el("compareOutput");
  const result = compareSlices(
    filteredRows,
    state.compareBy,
    state.compareA,
    state.compareB,
    {
      compareEventId: state.compareEventId,
    },
  );
  const compareEvent = contextData.events.find(
    (e) => e.id === state.compareEventId,
  );
  const compareScope = compareEvent
    ? compareEvent.name || "Selected event"
    : "All events";
  output.innerHTML = [
    `<div class="compare-card"><strong>${result.a.label || "Selection A"}</strong><p>Scope: ${compareScope}</p><p>Rows: ${result.a.count}</p><p>Best time: ${result.a.bestTime}</p><p>Avg time: ${result.a.avgTime}</p><p>Best field: ${result.a.bestField}</p></div>`,
    `<div class="compare-card"><strong>${result.b.label || "Selection B"}</strong><p>Scope: ${compareScope}</p><p>Rows: ${result.b.count}</p><p>Best time: ${result.b.bestTime}</p><p>Avg time: ${result.b.avgTime}</p><p>Best field: ${result.b.bestField}</p></div>`,
    `<div class="compare-card"><strong>Comparison Notes</strong><p>Compare mode: ${state.compareBy}</p><p>Rows in scope: ${result.scopedCount}</p><p>Tip: choose an event to make school comparisons meaningful.</p></div>`,
  ].join("");
}

function renderTable() {
  const body = el("tableBody");
  const rows = filteredRows.slice(0, 400);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="11">No matching rows.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.date || "-"}</td>
      <td>${r.meetName}</td>
      <td>${r.eventName}</td>
      <td>${r.athleteName}</td>
      <td>${r.schoolName}</td>
      <td>${r.gender || "-"}</td>
      <td>${r.mark || "-"}</td>
      <td>${r.placement ?? "-"}</td>
      <td>${r.heat || "-"}</td>
      <td>${r.category || "-"}</td>
      <td>${r.season || "-"}</td>
    </tr>
  `,
    )
    .join("");
}

function formatCoachMetric(value) {
  if (!Number.isFinite(value)) return "N/A";
  if (value >= 60) {
    const mins = Math.floor(value / 60);
    const secs = (value % 60).toFixed(2).padStart(5, "0");
    return `${mins}:${secs}`;
  }
  return value.toFixed(2);
}

function renderTeamReport(rows, teamName) {
  const summary = el("coachTeamSummary");
  const insightsContainer = el("coachTeamInsights");

  const athletes = new Set(rows.map((r) => r.athleteName));
  const meets = new Set(rows.map((r) => r.meetName));
  const top3 = rows.filter(
    (r) => r.placement !== null && r.placement <= 3,
  ).length;

  summary.innerHTML = [
    `<div class="kpi"><div class="kpi-label">Active Roster Size</div><div class="kpi-value">${athletes.size}</div></div>`,
    `<div class="kpi"><div class="kpi-label">Meets Attended</div><div class="kpi-value">${meets.size}</div></div>`,
    `<div class="kpi"><div class="kpi-label">Total Results</div><div class="kpi-value">${rows.length}</div></div>`,
    `<div class="kpi"><div class="kpi-label">Top 3 Finishes</div><div class="kpi-value">${top3}</div></div>`,
  ].join("");

  const insights = buildTeamInsights(rows);
  insightsContainer.innerHTML = insights
    .map((text) => `<div class="insight-item">${insightToHtml(text)}</div>`)
    .join("");

  renderCoachTeamDepthChart(rows);
}

function renderAthleteReport(rows, athleteName) {
  const summary = el("coachSummary");
  const tableBody = el("coachTableBody");

  const timeVals = rows
    .map((r) => r.bestTimeSeconds)
    .filter((v) => Number.isFinite(v));
  const placeVals = rows
    .map((r) => r.placement)
    .filter((v) => Number.isFinite(v));
  const bestTime = timeVals.length ? Math.min(...timeVals) : null;
  const avgTime = timeVals.length
    ? timeVals.reduce((a, b) => a + b, 0) / timeVals.length
    : null;
  const avgPlace = placeVals.length
    ? placeVals.reduce((a, b) => a + b, 0) / placeVals.length
    : null;

  const recent = rows.slice(-5);
  const trendDelta =
    recent.length >= 2 &&
    Number.isFinite(recent[0].bestTimeSeconds) &&
    Number.isFinite(recent[recent.length - 1].bestTimeSeconds)
      ? recent[0].bestTimeSeconds - recent[recent.length - 1].bestTimeSeconds
      : null;

  summary.innerHTML = [
    `<div class="kpi"><div class="kpi-label">Rows In View</div><div class="kpi-value">${rows.length}</div></div>`,
    `<div class="kpi"><div class="kpi-label">Best Time</div><div class="kpi-value">${bestTime === null ? "N/A" : formatCoachMetric(bestTime)}</div></div>`,
    `<div class="kpi"><div class="kpi-label">Avg Time</div><div class="kpi-value">${avgTime === null ? "N/A" : formatCoachMetric(avgTime)}</div></div>`,
    `<div class="kpi"><div class="kpi-label">Avg Placement</div><div class="kpi-value">${avgPlace === null ? "N/A" : avgPlace.toFixed(1)}</div></div>`,
    `<div class="kpi"><div class="kpi-label">Recent Trend</div><div class="kpi-value">${trendDelta === null ? "N/A" : `${trendDelta >= 0 ? "Improving" : "Slower"} (${Math.abs(trendDelta).toFixed(2)}s)`}</div></div>`,
  ].join("");

  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="6">No rows for this athlete in the current scope.</td></tr>`;
  } else {
    tableBody.innerHTML = rows
      .slice()
      .reverse()
      .slice(0, 50)
      .map(
        (r) => `
      <tr>
        <td>${r.date || "-"}</td>
        <td>${r.eventName}</td>
        <td>${r.meetName}</td>
        <td>${r.mark || "-"}</td>
        <td>${r.placement ?? "-"}</td>
        <td>${r.heat || "-"}</td>
      </tr>
    `,
      )
      .join("");
  }
}

function renderCoachView() {
  const team = state.coachSchoolName || "";
  const athlete = state.coachAthleteName || "";

  const teamSection = el("teamReportSection");
  const indSection = el("individualReportSection");
  const emptyState = el("coachEmptyState");

  if (!team && !athlete) {
    renderCoachTeamHeader("", 0, 0);
    teamSection.style.display = "none";
    indSection.style.display = "none";
    emptyState.style.display = "block";
    renderCoachTeamDepthChart([]);
    renderCoachTrendChart([]);
    renderCoachEventChart([]);
    renderCoachRadarChart([]);
    return;
  }

  emptyState.style.display = "none";

  const teamScoped = team ? coachScopeRows(team, "") : [];
  let athleteRows = [];
  if (athlete)
    athleteRows = coachScopeRows(team, athlete).slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  renderCoachDynamicInsights(team, athlete, athleteRows, teamScoped);
  renderCoachTeamHeader(
    team,
    teamScoped.length ? new Set(teamScoped.map((r) => r.athleteName)).size : 0,
    teamScoped.length || athleteRows.length,
  );

  if (!athlete && el("coachSummary")) el("coachSummary").innerHTML = "";

  if (team) {
    teamSection.style.display = "block";
    el("coachTeamNameDisplay").textContent = team;
    renderTeamReport(teamScoped, team);
  } else {
    teamSection.style.display = "none";
  }

  if (athlete) {
    indSection.style.display = "block";
    el("coachAthleteNameDisplay").textContent = athlete;
    renderAthleteReport(athleteRows, athlete);
  } else {
    indSection.style.display = "none";
    if (!team) {
      renderCoachTeamDepthChart([]);
    }
    const summary = el("coachSummary");
    if (!team && summary) summary.innerHTML = "";
  }

  const chartPack = athleteRows.length ? athleteRows : teamScoped;
  renderCoachRadarChart(chartPack);
  renderCoachTrendChart(chartPack);
  renderCoachEventChart(chartPack);

  updateCoachToolbarAccess();
}

function refreshBuilderSelects() {
  const field = state.compareBy || "schoolName";
  const scopedRows = state.compareEventId
    ? filteredRows.filter((r) => r.eventId === state.compareEventId)
    : filteredRows;
  const values = uniqueValues(scopedRows, field);
  setOptions(
    "compareA",
    values.map((v) => ({ value: v, label: v })),
    "value",
    "label",
    true,
    "Select",
  );
  setOptions(
    "compareB",
    values.map((v) => ({ value: v, label: v })),
    "value",
    "label",
    true,
    "Select",
  );
  hydrateInputsFromState();
}

function updateView() {
  filteredRows = applyFilters(allRows, state);
  writeStateToUrl(state);
  applyPanelVisibility();
  renderPills();
  renderKpis();
  renderInsights();
  renderComparison();
  renderTrendChart(filteredRows);
  renderCategoryChart(filteredRows);
  renderCustomChart(filteredRows, state);
  renderTable();
  refreshBuilderSelects();
  refreshCoachDependentSelects();
  renderCoachView();
}

function populateStaticFilters() {
  setOptions(
    "eventFilter",
    contextData.events.map((e) => ({ value: e.id, label: e.name || e.id })),
    "value",
    "label",
    true,
    "All events",
  );
  setOptions(
    "compareEventId",
    contextData.events.map((e) => ({ value: e.id, label: e.name || e.id })),
    "value",
    "label",
    true,
    "All events",
  );
  setOptions(
    "meetFilter",
    contextData.meets.map((m) => ({ value: m.id, label: m.name || m.id })),
    "value",
    "label",
    true,
    "All meets",
  );

  const allSchools = uniqueValues(allRows, "schoolName");
  setOptions(
    "schoolFilter",
    allSchools.map((v) => ({ value: v, label: v })),
    "value",
    "label",
    true,
    "All schools",
  );
  setOptions(
    "coachSchoolName",
    allSchools.map((v) => ({ value: v, label: v })),
    "value",
    "label",
    true,
    "Select team",
  );

  setOptions(
    "athleteFilter",
    uniqueValues(allRows, "athleteName").map((v) => ({ value: v, label: v })),
    "value",
    "label",
    true,
    "All athletes",
  );
  setOptions(
    "coachEventId",
    contextData.events.map((e) => ({ value: e.id, label: e.name || e.id })),
    "value",
    "label",
    true,
    "All events",
  );

  setOptions(
    "categoryFilter",
    uniqueValues(allRows, "category").map((v) => ({ value: v, label: v })),
    "value",
    "label",
    true,
    "All categories",
  );

  refreshBuilderSelects();
  renderFavoriteBanner();
}

function bindActions() {
  const btn = (id) => el(id);

  if (btn("applyFiltersBtn"))
    btn("applyFiltersBtn").addEventListener("click", () => {
      pullStateFromInputs();
      updateView();
    });
  if (btn("resetFiltersBtn"))
    btn("resetFiltersBtn").addEventListener("click", () => {
      state = getDefaultState();
      hydrateInputsFromState();
      updateView();
    });

    const shareBtn = el("shareBtn");
    const shareMenu = el("shareMenu");
    const copyShareBtn = el("copyShareBtn");
  
    if (shareBtn && shareMenu) {
      shareBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        shareMenu.style.display = shareMenu.style.display === "none" ? "block" : "none";
      });
  
      // Close menu if clicked outside
      document.addEventListener("click", (e) => {
        if (!shareMenu.contains(e.target) && !shareBtn.contains(e.target)) {
          shareMenu.style.display = "none";
        }
      });
    }
  
    if (copyShareBtn) {
      copyShareBtn.addEventListener("click", async () => {
        const checkboxes = document.querySelectorAll(".share-panel-cb");
        const selectedPanels = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);
        
        // If all panels are checked, leave the state blank so it defaults to showing all
        if (selectedPanels.length === checkboxes.length) {
            state.panels = "";
        } else {
            state.panels = selectedPanels.join(",");
        }
  
        const url = buildShareUrl(state);
        try {
          await navigator.clipboard.writeText(url);
          alert("Custom shareable link copied!");
          shareMenu.style.display = "none";
        } catch (err) {
          alert(`Could not copy link. ${url}`);
        }
      });
    }

  if (btn("csvBtn"))
    btn("csvBtn").addEventListener("click", () => exportRows("csv"));
  if (btn("jsonBtn"))
    btn("jsonBtn").addEventListener("click", () => exportRows("json"));
  if (btn("printBtn"))
    btn("printBtn").addEventListener("click", () => {
      if (!isCoachAuthorized()) {
        window.location.href = "coach-login.html?redirect=" + encodeURIComponent(
          `${window.location.pathname.slice(window.location.pathname.lastIndexOf("/") + 1)}${window.location.search}`,
        );
        return;
      }
      triggerPrint("print-analytics-scope");
    });

  if (btn("buildChartBtn"))
    btn("buildChartBtn").addEventListener("click", () => {
      pullStateFromInputs();
      renderCustomChart(filteredRows, state);
      writeStateToUrl(state);
    });

  if (btn("compareBy"))
    btn("compareBy").addEventListener("change", () => {
      pullStateFromInputs();
      refreshBuilderSelects();
      renderComparison();
      writeStateToUrl(state);
    });
  if (btn("compareEventId"))
    btn("compareEventId").addEventListener("change", () => {
      pullStateFromInputs();
      refreshBuilderSelects();
      renderComparison();
      writeStateToUrl(state);
    });

  if (btn("setFavoriteBtn"))
    btn("setFavoriteBtn").addEventListener("click", () => {
      const school = state.schoolName || el("schoolFilter").value || "";
      if (!school) {
        alert("Choose a school filter first, then set favorite.");
        return;
      }
      window.localStorage.setItem(FAVORITE_TEAM_KEY, school);
      renderFavoriteBanner();
    });
  if (btn("useFavoriteBtn"))
    btn("useFavoriteBtn").addEventListener("click", () => {
      const favorite = window.localStorage.getItem(FAVORITE_TEAM_KEY) || "";
      if (!favorite) {
        alert("No favorite team set yet.");
        return;
      }
      state.schoolName = favorite;
      hydrateInputsFromState();
      updateView();
    });
  if (btn("clearFavoriteBtn"))
    btn("clearFavoriteBtn").addEventListener("click", () => {
      window.localStorage.removeItem(FAVORITE_TEAM_KEY);
      renderFavoriteBanner();
    });

  // Coach Section Actions
  if (btn("coachApplyBtn"))
    btn("coachApplyBtn").addEventListener("click", () => {
      pullStateFromInputs();
      renderCoachView();
      writeStateToUrl(state);
    });

  if (btn("printReportBtn"))
    btn("printReportBtn").addEventListener("click", () => {
      if (!isCoachAuthorized()) {
        window.location.href =
          "coach-login.html?redirect=" +
          encodeURIComponent(
            `analytics.html${window.location.search ? window.location.search : ""}`,
          );
        return;
      }
      const team = state.coachSchoolName || "";
      const athlete = state.coachAthleteName || "";
      if (!team && !athlete) {
        alert("Select a team or athlete in the Coach Dashboard first.");
        return;
      }
      triggerPrint("print-coach");
    });

  if (btn("printFilteredSummaryBtn"))
    btn("printFilteredSummaryBtn").addEventListener("click", () => {
      if (!isCoachAuthorized()) {
        window.location.href =
          "coach-login.html?redirect=" +
          encodeURIComponent(
            `analytics.html${window.location.search ? window.location.search : ""}`,
          );
        return;
      }
      if (!filteredRows.length) {
        alert("Nothing to print — widen your global filters first.");
        return;
      }
      triggerPrint("print-analytics-scope");
    });

  if (btn("printCoachBtn"))
    btn("printCoachBtn").addEventListener("click", () => {
      triggerPrint("print-coach");
    });

  if (btn("shareCoachBtn")) {
    btn("shareCoachBtn").style.display = "";
    btn("shareCoachBtn").textContent = "🔗 Copy coach view link";
    btn("shareCoachBtn").addEventListener("click", async () => {
      const url = buildShareUrl(state);
      try {
        await navigator.clipboard.writeText(url);
        alert("Coach Report specific link copied to clipboard!");
      } catch (err) {
        alert(`Could not copy link. ${url}`);
      }
    });
  }

  ["coachSchoolName", "coachAthleteName", "coachEventId", "coachMeetId"].forEach((sid) => {
    const node = el(sid);
    if (!node) return;
    node.addEventListener("change", scheduleCoachRedraw);
  });
}

function syncCoachBannerFromFavorite() {
  const fav = window.localStorage.getItem(FAVORITE_TEAM_KEY) || "";
  if (!state.coachSchoolName && fav && el("coachSchoolName")) {
    el("coachSchoolName").value = fav;
    state.coachSchoolName = fav;
  }
}

function maybeAutoTeamFromGlobals() {
  if (!state.coachSchoolName && state.schoolName && el("coachSchoolName")) {
    state.coachSchoolName = state.schoolName;
    el("coachSchoolName").value = state.schoolName;
  }
}

function renderFavoriteBanner() {
  const favorite = window.localStorage.getItem(FAVORITE_TEAM_KEY) || "";
  const banner = el("favoriteBanner");
  const label = el("favoriteBannerLabel");
  if (!banner || !label) return;
  label.textContent = favorite ? `Favorite team: ${favorite}` : "Favorite team: Not set";
}

function exportRows(mode) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  if (mode === "json") {
    const blob = new Blob([JSON.stringify(filteredRows, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, `track-analytics-${ts}.json`);
    return;
  }
  const cols = [
    "date",
    "meetName",
    "eventName",
    "athleteName",
    "schoolName",
    "gender",
    "mark",
    "placement",
    "heat",
    "category",
    "season",
    "markType",
    "bestTimeSeconds",
    "bestFieldMark",
  ];
  const lines = [cols.join(",")];
  filteredRows.forEach((row) => {
    lines.push(
      cols
        .map((c) => `"${String(row[c] ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `track-analytics-${ts}.csv`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function waitForFirebase() {
  let attempts = 0;
  while (typeof window.firebaseDatabase === "undefined" && attempts < 60) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }
  if (!window.firebaseDatabase)
    throw new Error("Firebase database not initialized");
}

async function init() {
  await waitForFirebase();
  state = { ...getDefaultState(), ...parseStateFromUrl() };
  if (state.meetId && !state.coachMeetId) state.coachMeetId = state.meetId;
  const loaded = await loadTrackAnalyticsData();
  allRows = loaded.rows;
  contextData = loaded;
  populateStaticFilters();
  syncCoachBannerFromFavorite();
  maybeAutoTeamFromGlobals();
  hydrateInputsFromState();
  bindActions();
  updateView();
  updateCoachToolbarAccess();
}

init()
  .catch((error) => {
    const body = el("tableBody");
    if (body)
      body.innerHTML = `<tr><td colspan="11">Failed to load analytics data: ${error.message}</td></tr>`;
  })
  .finally(() => {
    document.dispatchEvent(new Event("MSMDataLoaded"));
  });
