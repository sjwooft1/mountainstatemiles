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

function el(id) {
  return document.getElementById(id);
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
    .map((text) => `<div class="insight-item">${text}</div>`)
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
    .map((text) => `<div class="insight-item">${text}</div>`)
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

  renderCoachTrendChart(rows);
  renderCoachEventChart(rows);
}

function renderCoachView() {
  const team = state.coachSchoolName || "";
  const athlete = state.coachAthleteName || "";
  const eventId = state.coachEventId || "";

  const teamSection = el("teamReportSection");
  const indSection = el("individualReportSection");
  const emptyState = el("coachEmptyState");

  // Reset charts if unselected
  if (!team && !athlete) {
    teamSection.style.display = "none";
    indSection.style.display = "none";
    emptyState.style.display = "block";
    renderCoachTeamDepthChart([]);
    renderCoachTrendChart([]);
    renderCoachEventChart([]);
    return;
  }

  emptyState.style.display = "none";

  if (team) {
    teamSection.style.display = "block";
    el("coachTeamNameDisplay").textContent = team;
    let baseTeamRows = filteredRows.filter((r) => r.schoolName === team);
    if (eventId)
      baseTeamRows = baseTeamRows.filter((r) => r.eventId === eventId);
    renderTeamReport(baseTeamRows, team);
  } else {
    teamSection.style.display = "none";
  }

  if (athlete) {
    indSection.style.display = "block";
    el("coachAthleteNameDisplay").textContent = athlete;
    let athleteRows = filteredRows.filter((r) => r.athleteName === athlete);
    if (eventId) athleteRows = athleteRows.filter((r) => r.eventId === eventId);

    // Sort athlete chronological
    athleteRows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    renderAthleteReport(athleteRows, athlete);
  } else {
    indSection.style.display = "none";
  }
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
  renderPills();
  renderKpis();
  renderInsights();
  renderComparison();
  renderTrendChart(filteredRows);
  renderCategoryChart(filteredRows);
  renderCustomChart(filteredRows, state);
  renderTable();
  refreshBuilderSelects();
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
    "coachAthleteName",
    uniqueValues(allRows, "athleteName").map((v) => ({ value: v, label: v })),
    "value",
    "label",
    true,
    "Select athlete",
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

  if (btn("shareBtn"))
    btn("shareBtn").addEventListener("click", async () => {
      const url = buildShareUrl(state);
      try {
        await navigator.clipboard.writeText(url);
        alert("Global shareable link copied.");
      } catch (err) {
        alert(`Could not copy link. ${url}`);
      }
    });

  if (btn("csvBtn"))
    btn("csvBtn").addEventListener("click", () => exportRows("csv"));
  if (btn("jsonBtn"))
    btn("jsonBtn").addEventListener("click", () => exportRows("json"));
  if (btn("printBtn"))
    btn("printBtn").addEventListener("click", () => window.print());

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
      document.body.classList.add("print-coach");
      window.print();
      setTimeout(() => {
        document.body.classList.remove("print-coach");
      }, 500);
    });

  if (btn("printCoachBtn"))
    btn("printCoachBtn").addEventListener("click", () => {
      document.body.classList.add("print-coach");
      window.print();
      document.body.classList.remove("print-coach");
    });

  if (btn("shareCoachBtn"))
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

function renderFavoriteBanner() {
  const favorite = window.localStorage.getItem(FAVORITE_TEAM_KEY) || "";
  const node = el("favoriteBanner");
  if (!node) return;
  node.textContent = favorite
    ? `Favorite team: ${favorite}`
    : "Favorite team: Not set";
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
  const loaded = await loadTrackAnalyticsData();
  allRows = loaded.rows;
  contextData = loaded;
  populateStaticFilters();
  hydrateInputsFromState();
  bindActions();
  updateView();
}

init().catch((error) => {
  const body = el("tableBody");
  if (body)
    body.innerHTML = `<tr><td colspan="11">Failed to load analytics data: ${error.message}</td></tr>`;
});
