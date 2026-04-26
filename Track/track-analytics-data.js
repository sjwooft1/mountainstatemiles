function toArray(snapshot) {
  if (!snapshot || !snapshot.exists()) return [];
  const raw = snapshot.val() || {};
  return Object.entries(raw).map(([id, value]) => ({ id, ...(value || {}) }));
}

function normalizeGender(value) {
  const token = String(value || "").trim().toUpperCase();
  if (token === "W" || token === "F" || token === "GIRLS" || token === "FEMALE") return "F";
  if (token === "M" || token === "BOYS" || token === "MALE") return "M";
  return "";
}

function isFieldEvent(eventName) {
  const name = String(eventName || "").toLowerCase();
  const fields = ["jump", "vault", "shot", "discus", "javelin", "hammer", "throw", "put"];
  return fields.some((f) => name.includes(f));
}

function parseTimeToSeconds(mark) {
  const text = String(mark || "").trim();
  if (!text) return null;
  if (text.includes(":")) {
    const parts = text.split(":").map((n) => parseFloat(n));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  const num = parseFloat(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function parseFieldMark(mark) {
  const text = String(mark || "").trim().toLowerCase();
  if (!text) return null;
  const feetInch = text.match(/(\d+)\D+(\d+(?:\.\d+)?)/);
  if (feetInch) {
    const feet = parseFloat(feetInch[1]);
    const inches = parseFloat(feetInch[2]);
    return feet + inches / 12;
  }
  const num = parseFloat(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function inferSeason(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const month = date.getMonth() + 1;
  return month >= 11 || month <= 3 ? "indoor" : "outdoor";
}

function safeDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function normalizeRow(result, maps) {
  const meet = maps.meetsById.get(result.meet_id) || {};
  const event = maps.eventsById.get(result.event_id) || {};
  const athlete = maps.athletesById.get(result.athlete_id) || {};

  const eventName = event.name || result.event_name || "Unknown Event";
  const athleteName = result.relay_names || result.athlete_name || `${athlete.first_name || ""} ${athlete.last_name || ""}`.trim() || "Unknown Athlete";
  const schoolName = athlete.school || result.school || result.school_name || "Unknown School";
  const date = safeDate(meet.date || result.date || result.timestamp);
  const season = String(event.season || meet.season || inferSeason(date)).toLowerCase();
  const placement = Number.isFinite(Number(result.placement)) ? Number(result.placement) : (Number.isFinite(Number(result.place)) ? Number(result.place) : null);
  const gender = normalizeGender(result.gender || athlete.gender || event.gender);
  const relay = Boolean(result.relay_names || !result.athlete_id);
  const category = event.category || (isFieldEvent(eventName) ? "field" : "running");
  const mark = String(result.mark || result.time || "").trim();
  const markType = isFieldEvent(eventName) ? "field" : "time";
  const bestTimeSeconds = markType === "time" ? parseTimeToSeconds(mark) : null;
  const bestFieldMark = markType === "field" ? parseFieldMark(mark) : null;

  return {
    id: result.id,
    date,
    season,
    meetId: result.meet_id || meet.id || "",
    meetName: meet.name || result.meet_name || result.meet || "Unknown Meet",
    eventId: result.event_id || event.id || "",
    eventName,
    category,
    athleteId: result.athlete_id || athlete.id || "",
    athleteName,
    schoolName,
    gender,
    relay,
    mark,
    markType,
    placement,
    heat: result.heat || "",
    bestTimeSeconds,
    bestFieldMark,
    timestamp: result.timestamp || "",
  };
}

export async function loadTrackAnalyticsData() {
  if (!window.firebaseDatabase) throw new Error("Firebase database not initialized");
  const db = window.firebaseDatabase;
  const [meetsSnap, eventsSnap, athletesSnap, resultsSnap] = await Promise.all([
    db.ref("Track/meets").once("value"),
    db.ref("Track/events").once("value"),
    db.ref("Track/athletes").once("value"),
    db.ref("Track/results").once("value"),
  ]);

  const meets = toArray(meetsSnap);
  const events = toArray(eventsSnap);
  const athletes = toArray(athletesSnap);
  const results = toArray(resultsSnap);

  const maps = {
    meetsById: new Map(meets.map((m) => [m.id, m])),
    eventsById: new Map(events.map((e) => [e.id, e])),
    athletesById: new Map(athletes.map((a) => [a.id, a])),
  };

  const rows = results.map((r) => normalizeRow(r, maps)).filter((r) => r.mark || r.placement !== null);
  return { rows, meets, events, athletes };
}

export function applyFilters(rows, filters) {
  return rows.filter((row) => {
    if (filters.season && row.season !== filters.season) return false;
    if (filters.gender && row.gender !== filters.gender) return false;
    if (filters.eventId && row.eventId !== filters.eventId) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.schoolName && row.schoolName !== filters.schoolName) return false;
    if (filters.meetId && row.meetId !== filters.meetId) return false;
    if (filters.athleteName && row.athleteName !== filters.athleteName) return false;
    if (filters.relayFilter === "relay" && !row.relay) return false;
    if (filters.relayFilter === "individual" && row.relay) return false;
    if (filters.markType && row.markType !== filters.markType) return false;
    if (filters.startDate && row.date && row.date < filters.startDate) return false;
    if (filters.endDate && row.date && row.date > filters.endDate) return false;
    if (filters.placementMax && Number.isFinite(Number(filters.placementMax))) {
      if (row.placement === null || row.placement > Number(filters.placementMax)) return false;
    }
    return true;
  });
}

export function uniqueValues(rows, key) {
  return [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}
