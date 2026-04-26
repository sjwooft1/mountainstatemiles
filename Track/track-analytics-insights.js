function safeAvg(values) {
  if (!values.length) return null;
  const total = values.reduce((sum, v) => sum + v, 0);
  return total / values.length;
}

function formatSeconds(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "N/A";
  if (seconds >= 60) {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2).padStart(5, "0");
    return `${mins}:${secs}`;
  }
  return seconds.toFixed(2);
}

export function buildKpis(rows) {
  const timeRows = rows.filter((r) => Number.isFinite(r.bestTimeSeconds));
  const fieldRows = rows.filter((r) => Number.isFinite(r.bestFieldMark));
  const avgTime = safeAvg(timeRows.map((r) => r.bestTimeSeconds));
  const bestTime = timeRows.length ? Math.min(...timeRows.map((r) => r.bestTimeSeconds)) : null;
  const bestField = fieldRows.length ? Math.max(...fieldRows.map((r) => r.bestFieldMark)) : null;

  return [
    { label: "Filtered Results", value: String(rows.length) },
    { label: "Unique Athletes", value: String(new Set(rows.map((r) => r.athleteName)).size) },
    { label: "Unique Meets", value: String(new Set(rows.map((r) => r.meetName)).size) },
    { label: "Average Time", value: formatSeconds(avgTime) },
    { label: "Best Time", value: formatSeconds(bestTime) },
    { label: "Best Field Mark", value: bestField ? bestField.toFixed(2) : "N/A" },
  ];
}

export function buildInsights(rows) {
  if (!rows.length) {
    return ["No rows match the current filters. Expand filters to generate insights."];
  }
  const insights = [];

  const bySchool = rows.reduce((acc, r) => {
    acc[r.schoolName] = (acc[r.schoolName] || 0) + 1;
    return acc;
  }, {});
  const schoolLeader = Object.entries(bySchool).sort((a, b) => b[1] - a[1])[0];
  if (schoolLeader) insights.push(`${schoolLeader[0]} has the highest activity in this filtered view (${schoolLeader[1]} results).`);

  const byEvent = rows.reduce((acc, r) => {
    acc[r.eventName] = (acc[r.eventName] || 0) + 1;
    return acc;
  }, {});
  const eventLeader = Object.entries(byEvent).sort((a, b) => b[1] - a[1])[0];
  if (eventLeader) insights.push(`${eventLeader[0]} is the most represented event (${eventLeader[1]} entries).`);

  const bestTimeRow = rows
    .filter((r) => Number.isFinite(r.bestTimeSeconds))
    .sort((a, b) => a.bestTimeSeconds - b.bestTimeSeconds)[0];
  if (bestTimeRow) insights.push(`Fastest time in view: ${formatSeconds(bestTimeRow.bestTimeSeconds)} by ${bestTimeRow.athleteName} at ${bestTimeRow.meetName}.`);

  const bestFieldRow = rows
    .filter((r) => Number.isFinite(r.bestFieldMark))
    .sort((a, b) => b.bestFieldMark - a.bestFieldMark)[0];
  if (bestFieldRow) insights.push(`Top field mark in view: ${bestFieldRow.bestFieldMark.toFixed(2)} by ${bestFieldRow.athleteName} (${bestFieldRow.eventName}).`);

  const bySeason = rows.reduce((acc, r) => {
    const key = r.season || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const seasonText = Object.entries(bySeason).map(([k, v]) => `${k}: ${v}`).join(", ");
  if (seasonText) insights.push(`Season distribution in current view -> ${seasonText}.`);

  return insights;
}

export function compareSlices(rows, compareBy, a, b, options = {}) {
  const eventId = options.compareEventId || "";
  const scopedRows = eventId ? rows.filter((r) => r.eventId === eventId) : rows;
  const as = scopedRows.filter((r) => String(r[compareBy] || "") === String(a || ""));
  const bs = scopedRows.filter((r) => String(r[compareBy] || "") === String(b || ""));
  const aBest = as.filter((r) => Number.isFinite(r.bestTimeSeconds)).sort((x, y) => x.bestTimeSeconds - y.bestTimeSeconds)[0];
  const bBest = bs.filter((r) => Number.isFinite(r.bestTimeSeconds)).sort((x, y) => x.bestTimeSeconds - y.bestTimeSeconds)[0];
  const aBestField = as.filter((r) => Number.isFinite(r.bestFieldMark)).sort((x, y) => y.bestFieldMark - x.bestFieldMark)[0];
  const bBestField = bs.filter((r) => Number.isFinite(r.bestFieldMark)).sort((x, y) => y.bestFieldMark - x.bestFieldMark)[0];

  const asAvg = safeAvg(as.filter((r) => Number.isFinite(r.bestTimeSeconds)).map((r) => r.bestTimeSeconds));
  const bsAvg = safeAvg(bs.filter((r) => Number.isFinite(r.bestTimeSeconds)).map((r) => r.bestTimeSeconds));

  return {
    a: {
      label: a || "A",
      count: as.length,
      bestTime: aBest ? formatSeconds(aBest.bestTimeSeconds) : "N/A",
      avgTime: asAvg ? formatSeconds(asAvg) : "N/A",
      bestField: aBestField ? aBestField.bestFieldMark.toFixed(2) : "N/A",
    },
    b: {
      label: b || "B",
      count: bs.length,
      bestTime: bBest ? formatSeconds(bBest.bestTimeSeconds) : "N/A",
      avgTime: bsAvg ? formatSeconds(bsAvg) : "N/A",
      bestField: bBestField ? bBestField.bestFieldMark.toFixed(2) : "N/A",
    },
    scopedCount: scopedRows.length,
  };
}

export function formatMetricValue(metric, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  if (metric.includes("Time")) return formatSeconds(value);
  return value.toFixed(2);
}
