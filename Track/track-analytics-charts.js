const chartRegistry = new Map();

function chartCanvas(id) {
  const node = document.getElementById(id);
  if (!node) return null;
  return node.getContext("2d");
}

function destroyChart(id) {
  if (chartRegistry.has(id)) {
    chartRegistry.get(id).destroy();
    chartRegistry.delete(id);
  }
}

function render(id, config) {
  const ctx = chartCanvas(id);
  if (!ctx || !window.Chart) return;
  destroyChart(id);
  const chart = new window.Chart(ctx, config);
  chartRegistry.set(id, chart);
}

export function renderTrendChart(rows) {
  const points = rows
    .filter((r) => r.date && Number.isFinite(r.bestTimeSeconds))
    .sort((a, b) => a.date.localeCompare(b.date))
    .reduce((acc, r) => {
      if (!acc[r.date]) acc[r.date] = [];
      acc[r.date].push(r.bestTimeSeconds);
      return acc;
    }, {});
  const labels = Object.keys(points);
  const values = labels.map((d) => points[d].reduce((sum, v) => sum + v, 0) / points[d].length);
  render("trendChart", {
    type: "line",
    data: { labels, datasets: [{ label: "Avg Time (s)", data: values, borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.2)", tension: 0.25 }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

export function renderCategoryChart(rows) {
  const grouped = rows.reduce((acc, r) => {
    const key = r.category || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const labels = Object.keys(grouped);
  const values = labels.map((k) => grouped[k]);
  render("categoryChart", {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: ["#2563eb", "#16a34a", "#f59e0b", "#db2777", "#6d28d9"] }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

function buildMetric(row, metric) {
  if (metric === "count") return 1;
  if (metric === "bestTimeSeconds" || metric === "avgTimeSeconds") return row.bestTimeSeconds;
  if (metric === "bestFieldMark") return row.bestFieldMark;
  return null;
}

export function renderCustomChart(rows, { chartType, groupBy, metric, topN }) {
  const grouped = rows.reduce((acc, row) => {
    const key = String(row[groupBy] || "Unknown");
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  let entries = Object.entries(grouped).map(([key, items]) => {
    if (metric === "count") return [key, items.length];
    const values = items.map((r) => buildMetric(r, metric)).filter((v) => Number.isFinite(v));
    if (!values.length) return [key, null];
    if (metric === "bestTimeSeconds") return [key, Math.min(...values)];
    if (metric === "avgTimeSeconds") return [key, values.reduce((a, b) => a + b, 0) / values.length];
    if (metric === "bestFieldMark") return [key, Math.max(...values)];
    return [key, null];
  }).filter(([, v]) => v !== null);

  entries.sort((a, b) => {
    if (metric === "bestTimeSeconds" || metric === "avgTimeSeconds") return a[1] - b[1];
    return b[1] - a[1];
  });
  entries = entries.slice(0, Number(topN) || 10);

  render("customChart", {
    type: chartType,
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{
        label: metric,
        data: entries.map(([, v]) => v),
        borderColor: "#111827",
        backgroundColor: "rgba(17,24,39,0.25)",
      }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

export function renderCoachTeamDepthChart(rows) {
  // Charting number of unique athletes placed per event
  const grouped = rows.reduce((acc, r) => {
    const key = r.eventName || "Unknown";
    if (!acc[key]) acc[key] = new Set();
    acc[key].add(r.athleteName);
    return acc;
  }, {});
  
  const entries = Object.entries(grouped)
    .map(([eventName, athleteSet]) => [eventName, athleteSet.size])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // Top 10 deepest events

  render("coachTeamDepthChart", {
    type: "bar",
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{
        label: "Unique Athletes Competed",
        data: entries.map(([,v]) => v),
        backgroundColor: "rgba(139, 92, 246, 0.4)",
        borderColor: "#7c3aed",
        borderWidth: 1
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

export function renderCoachTrendChart(rows) {
  const grouped = rows
    .filter((r) => r.date && Number.isFinite(r.bestTimeSeconds))
    .sort((a, b) => a.date.localeCompare(b.date))
    .reduce((acc, row) => {
      if (!acc[row.date]) acc[row.date] = [];
      acc[row.date].push(row.bestTimeSeconds);
      return acc;
    }, {});
  const labels = Object.keys(grouped);
  const values = labels.map((d) => grouped[d].reduce((sum, v) => sum + v, 0) / grouped[d].length);
  render("coachTrendChart", {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Avg Time (s)",
        data: values,
        borderColor: "#0ea5e9",
        backgroundColor: "rgba(14,165,233,0.2)",
        tension: 0.25,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

export function renderCoachEventChart(rows) {
  const grouped = rows.reduce((acc, row) => {
    const key = row.eventName || "Unknown";
    if (!acc[key]) acc[key] = [];
    if (Number.isFinite(row.bestTimeSeconds)) {
      acc[key].push(row.bestTimeSeconds);
    } else if (Number.isFinite(row.bestFieldMark)) {
      acc[key].push(row.bestFieldMark);
    }
    return acc;
  }, {});
  const entries = Object.entries(grouped)
    .filter(([, vals]) => vals.length)
    .map(([k, vals]) => [k, vals.reduce((a, b) => a + b, 0) / vals.length])
    .slice(0, 12);
  render("coachEventChart", {
    type: "bar",
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{
        label: "Average Mark",
        data: entries.map(([, v]) => v),
        backgroundColor: "rgba(34,197,94,0.35)",
        borderColor: "#16a34a",
      }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}