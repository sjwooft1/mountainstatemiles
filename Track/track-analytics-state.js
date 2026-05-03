const DEFAULT_STATE = {
  season: "",
  gender: "",
  eventId: "",
  category: "",
  schoolName: "",
  meetId: "",
  athleteName: "",
  relayFilter: "",
  markType: "",
  startDate: "",
  endDate: "",
  placementMax: "",
  compareBy: "schoolName",
  compareA: "",
  compareB: "",
  compareEventId: "",
  coachSchoolName: "",
  coachAthleteName: "",
  coachEventId: "",
  coachMeetId: "",
  chartType: "bar",
  groupBy: "eventName",
  metric: "count",
  topN: "10",
};

export function getDefaultState() {
  return { ...DEFAULT_STATE };
}

export function parseStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const state = getDefaultState();
  Object.keys(state).forEach((key) => {
    if (params.has(key)) state[key] = params.get(key) || "";
  });
  return state;
}

export function writeStateToUrl(state) {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState({}, "", next);
}

export function buildShareUrl(state) {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
}