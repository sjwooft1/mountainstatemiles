// ============================================================
//  portal-engine.js  —  Shared analytics engine for the Portal
//  Mountain State Miles / wvruns
//
//  Framework-free. Exposes window.MSMEngine with:
//    • Data loading + client-side joins (results/meets/schools/courses/athletes)
//    • MSM rating engine (course terrain + field strength), ported from
//      rankings.html / athlete.html so the portal shows the SAME numbers
//    • Riegel race predictions to any distance
//    • Season trajectory forecast (linear regression on rating over time)
//    • Training pace zones derived from a recent race (Daniels-style VDOT-lite)
//    • Per-athlete season summaries + team (coach) analytics
//
//  Depends on Firebase RTDB being initialised (firebase-config.js) exactly
//  like the rest of the site. All reads are from the same public paths:
//    crosscountry/{results,meets,schools,courses,athletes}
// ============================================================

(function () {
  "use strict";

  const MILE_M = 1609.34;
  const RIEGEL = 1.06;

  // Team rankings are WV-only, matching rankings.html. Legacy results with no
  // `state` tag are assumed in-state.
  const HOME_STATE = "WV";
  function isInState(r) { return (r && r.state ? String(r.state) : HOME_STATE).toUpperCase() === HOME_STATE; }

  // Match the site's rating engine constants.
  const RATING_REF = { M: (16 * 60) / 5000, F: (18.5 * 60) / 5000 };
  const RATING_SPREAD = 350;
  const OUT_OF_SEASON_MEETS = ["chick-fil-a-5k", "st-marys-5k", "ymca-kennedy-center"];

  // Course coordinates for race-day weather lookups (mirrors rankings.html).
  const COURSE_COORDS = {
    "holmdel-park": { lat: 40.3418, lon: -74.1735 },
    "cabell-midland": { lat: 38.4126, lon: -82.2543 },
    "glen-oak": { lat: 39.4390, lon: -80.1420 },
    "pipestem-state-park": { lat: 37.5382, lon: -80.9865 },
    "meadowood-park": { lat: 39.6295, lon: -79.9559 },
    "preston-high": { lat: 39.4767, lon: -79.6640 },
    "south-harrison": { lat: 39.2065, lon: -80.6390 },
    "st-marys-5k": { lat: 39.3906, lon: -81.2043 },
    "chick-fil-a-5k": { lat: 38.3498, lon: -81.6326 },
    "frankfort-5k": { lat: 39.5001, lon: -78.9600 },
    "ymca-kennedy-center": { lat: 38.3400, lon: -81.7300 },
  };
  const WV_DEFAULT_COORDS = { lat: 38.6409, lon: -80.6227 };

  const KNOWN_DISTANCES = {
    1600: "1 Mile", 3000: "3K", 3200: "2 Mile", 4000: "4K",
    5000: "5K", 6000: "6K", 8000: "8K", 10000: "10K",
  };

  // ---- tiny utils -----------------------------------------------------
  const norm = (s) => (s || "").toString().trim().toLowerCase();
  const secOf = (v) => { const t = parseFloat(v); return isNaN(t) || t <= 0 ? null : t; };
  const num = (v) => { const n = Number(v); return isNaN(n) ? null : n; };

  function formatTime(sec) {
    if (sec == null || isNaN(sec)) return "—";
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    if (mins >= 60) {
      const h = Math.floor(mins / 60), m = mins % 60;
      return `${h}:${String(m).padStart(2, "0")}:${secs.toFixed(1).padStart(4, "0")}`;
    }
    return `${mins}:${secs.toFixed(1).padStart(4, "0")}`;
  }
  function formatClock(sec) {
    if (sec == null || isNaN(sec)) return "—";
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function distanceLabel(d) {
    if (d == null || isNaN(d)) return "Unknown";
    const r = Math.round(d);
    return KNOWN_DISTANCES[r] ? `${KNOWN_DISTANCES[r]} (${r}m)` : `${r}m`;
  }
  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function slugify(name) {
    return (name || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  // sessionStorage wrapper that never throws (file:// / privacy modes).
  const safeSS = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  // ---- state ----------------------------------------------------------
  const state = {
    loaded: false,
    results: [],       // normalized: {athlete_name, gender, school_slug, meet_slug, course_slug, distance, timeSec, place, race_type, grad_year, date, meet, msm}
    meetsMap: {},
    schoolsMap: {},
    coursesMap: {},
    athletesMap: {},   // id -> athlete
    factors: { course: {}, field: {}, hill: {}, weather: {}, globalMedianPace: { M: null, F: null } },
    weatherApplied: 0, // count of meets weather was successfully applied to
    weatherTotal: 0,
  };

  // =====================================================================
  //  MSM RATING ENGINE — delegated to the shared window.MSMRating module
  //  (msm-rating.js), the single source of truth shared with rankings.html.
  //  These thin wrappers keep the rest of the engine's API stable.
  // =====================================================================
  const R = () => window.MSMRating;
  function isNonCompetitive(meetSlug) {
    return OUT_OF_SEASON_MEETS.indexOf(norm(meetSlug)) !== -1;
  }
  function toRatingInput(r) {
    return {
      athlete_name: r.athlete_name, gender: r.gender, meet_slug: r.meet_slug,
      course_slug: r.course_slug, distance: r.distance,
      time_in_seconds: r.timeSec != null ? r.timeSec : Number(r.time),
      date: r.date,
    };
  }
  function computeRating(r) {
    const m = R().ratingForResult(toRatingInput(r));
    if (!m) return null;
    return {
      rating: m.points,
      courseFactor: m.courseFactor,
      fieldFactor: m.fieldFactor,
      weatherFactor: m.weatherFactor,
      boost: m.boost,
    };
  }
  function computeRatingValue(r) { const m = computeRating(r); return m ? m.rating : null; }
  function ratingToPredicted(rating, gender, distMeters) {
    const eq5k = R().pointsToEquiv5Ksec(gender, rating);
    if (eq5k == null) return null;
    return distMeters === 5000 ? eq5k : riegel(eq5k, 5000, distMeters);
  }
  function weatherDifficultyFactor() { return 1.0; }


  // Legacy helper retained only for the course-difficulty label fallback used
  // elsewhere (e.g. simulator projection UI). Terrain math itself now lives in
  // the shared module; this mirrors its labels for display.
  function difficultyLabelFactor(label) {
    switch ((label || "").toLowerCase()) {
      case "hard": return 1.06;
      case "medium": return 1.00;
      case "easy": return 0.96;
      default: return 1.0;
    }
  }


  // =====================================================================
  //  RIEGEL RACE PREDICTIONS
  // =====================================================================
  // Predict an equivalent time at d2 from an actual time at d1.
  function riegel(timeSec, d1, d2) {
    if (!timeSec || !d1 || !d2) return null;
    return timeSec * Math.pow(d2 / d1, RIEGEL);
  }
  // Standard prediction set for XC/road from a best effort.
  function predictionSet(bestTimeSec, bestDist) {
    const targets = [
      ["1 Mile", 1600], ["3K", 3000], ["2 Mile", 3200], ["4K", 4000],
      ["5K", 5000], ["6K", 6000], ["8K", 8000], ["10K", 10000],
    ];
    return targets.map(([label, d]) => ({
      label, distance: d,
      seconds: riegel(bestTimeSec, bestDist, d),
    }));
  }

  // =====================================================================
  //  TRAINING PACES (Daniels-style, derived from a recent race)
  // =====================================================================
  // Returns pace-per-mile (seconds) for each training zone from a race.
  function trainingPaces(raceTimeSec, raceDist) {
    if (!raceTimeSec || !raceDist) return null;
    // Equivalent 5K time via Riegel, then scale zones off 5K race pace/mile.
    const eq5k = riegel(raceTimeSec, raceDist, 5000);
    const racePacePerMile = (eq5k / 5000) * MILE_M; // ~5K race effort per mile
    return {
      race5k: eq5k,
      racePacePerMile,
      easy: racePacePerMile * 1.30,      // conversational
      marathon: racePacePerMile * 1.16,  // steady long-run
      threshold: racePacePerMile * 1.06, // tempo / T pace
      interval: racePacePerMile * 0.97,  // ~3K-5K effort (VO2)
      repetition: racePacePerMile * 0.92, // mile / R pace
    };
  }

  // =====================================================================
  //  SEASON TRAJECTORY FORECAST (linear regression on rating vs. day index)
  // =====================================================================
  function forecastTrajectory(datedRatings) {
    // datedRatings: [{date:'YYYY-MM-DD', rating:Number}]
    const pts = datedRatings
      .filter((p) => p.date && p.rating != null)
      .map((p) => ({ t: Date.parse(p.date), y: p.rating }))
      .filter((p) => !isNaN(p.t))
      .sort((a, b) => a.t - b.t);
    if (pts.length < 2) return null;
    const t0 = pts[0].t;
    const xs = pts.map((p) => (p.t - t0) / 86400000); // days since first race
    const ys = pts.map((p) => p.y);
    const n = xs.length;
    const sx = xs.reduce((a, b) => a + b, 0);
    const sy = ys.reduce((a, b) => a + b, 0);
    const sxx = xs.reduce((a, b) => a + b * b, 0);
    const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
    const denom = n * sxx - sx * sx;
    if (denom === 0) return null;
    const slope = (n * sxy - sx * sy) / denom; // rating pts per day
    const intercept = (sy - slope * sx) / n;
    const lastX = xs[xs.length - 1];
    // Project 21 days beyond last race (typical taper to championship).
    const projX = lastX + 21;
    const projectedRating = Math.round(intercept + slope * projX);
    return {
      slopePerWeek: slope * 7,
      current: Math.round(intercept + slope * lastX),
      projectedRating,
      trend: slope > 0.05 ? "improving" : slope < -0.05 ? "declining" : "flat",
    };
  }

  // =====================================================================
  //  DATA LOADING
  // =====================================================================
  function waitForFirebase() {
    return new Promise((resolve, reject) => {
      let i = 0;
      (function poll() {
        if (window.firebaseDatabase) return resolve();
        if (i++ > 80) return reject(new Error("Firebase not ready"));
        setTimeout(poll, 100);
      })();
    });
  }

  async function load() {
    if (state.loaded) return state;
    await waitForFirebase();
    const db = window.firebaseDatabase;
    const [resultsSnap, meetsSnap, schoolsSnap, coursesSnap, athletesSnap] = await Promise.all([
      db.ref("crosscountry/results").once("value"),
      db.ref("crosscountry/meets").once("value"),
      db.ref("crosscountry/schools").once("value"),
      db.ref("crosscountry/courses").once("value"),
      db.ref("crosscountry/athletes").once("value"),
    ]);

    meetsSnap.forEach((c) => { const m = { id: c.key, ...c.val() }; if (m.slug) state.meetsMap[m.slug] = m; });
    schoolsSnap.forEach((c) => { const s = { id: c.key, ...c.val() }; if (s.slug) state.schoolsMap[s.slug] = s; });
    coursesSnap.forEach((c) => { const o = { id: c.key, ...c.val() }; if (o.slug) state.coursesMap[o.slug] = o; });
    athletesSnap.forEach((c) => { state.athletesMap[c.key] = { id: c.key, ...c.val() }; });

    const raw = [];
    resultsSnap.forEach((c) => {
      const r = c.val() || {};
      const meet = state.meetsMap[r.meet_slug] || {};
      raw.push({
        id: c.key,
        athlete_name: r.athlete_name || "",
        gender: (r.gender || "").toUpperCase(),
        school_slug: r.school_slug || "",
        meet_slug: r.meet_slug || "",
        course_slug: r.course_slug || meet.course_slug || "",
        distance: r.distance || 5000,
        timeSec: secOf(r.time),
        place: r.place != null ? parseInt(r.place) : null,
        race_type: r.race_type || "",
        grad_year: r.grad_year || r.gradYear || null,
        date: meet.date || r.created_at || "",
        // In-state tag, mirroring rankings.html: legacy results with no `state`
        // are assumed WV. Used to keep team rankings WV-only.
        state: (r.state || meet.state || HOME_STATE).toString().toUpperCase(),
        meet,
      });
    });

    // Build the entire rating model in the shared engine (GPX hills,
    // common-athlete course calibration, per-athlete pack field factor, and
    // race-day weather). This is the SAME code rankings.html runs.
    await window.MSMRating.buildModel(raw.map(toRatingInput), {
      meetsMap: state.meetsMap,
      coursesMap: state.coursesMap,
      fetchWeather: true,
    });
    // Mirror the shared model's factors for local use (simulator projections).
    state.factors.course = R().model.courseFactor || {};
    state.factors.weather = R().model.weatherFactor || {};
    state.factors.hill = {}; // terrain is folded into courseFactor in the shared model
    const meetSlugs = [...new Set(raw.map((r) => r.meet_slug).filter(Boolean))];
    state.weatherTotal = meetSlugs.length;
    // weatherFactor is keyed by raceKey (meet|gender|distance), and >1 means applied.
    state.weatherApplied = Object.values(state.factors.weather).filter((f) => f > 1).length;



    // Attach full rating detail + numeric rating to each result.
    raw.forEach((r) => { r._msm = computeRating(r); r.msm = r._msm ? r._msm.rating : null; });
    raw.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    state.results = raw;
    state.loaded = true;
    return state;
  }

  // =====================================================================
  //  DERIVED QUERIES
  // =====================================================================
  // Season handling matches rankings.html: a season is a calendar year
  // (from the result's date). "all" means all-time. Meet-type filtering
  // (in/out of season) is applied on top when requested.
  function yearOf(r) { return r.date ? new Date(r.date).getFullYear() : null; }
  function seasonMatch(r, season) {
    if (!season || season === "all") return true;
    const y = yearOf(r);
    return y != null && String(y) === String(season);
  }
  function meetTypeMatch(r, meetType) {
    if (!meetType || meetType === "all") return true;
    const oos = isNonCompetitive(r.meet_slug);
    return meetType === "out_of_season" ? oos : !oos;
  }
  // All distinct seasons present in the data, newest first.
  function listSeasons() {
    const years = new Set();
    state.results.forEach((r) => { const y = yearOf(r); if (y != null && !isNaN(y)) years.add(y); });
    return [...years].sort((a, b) => b - a);
  }

  // Results for an athlete by NAME across every school they've run for.
  // (Transfers keep one unified profile.) Optional season filter.
  function resultsForAthlete(name, season) {
    const nn = norm(name);
    return state.results.filter((r) => norm(r.athlete_name) === nn && seasonMatch(r, season));
  }

  function athleteSummary(name, season) {
    const rows = resultsForAthlete(name, season);
    if (!rows.length) return null;
    const gender = (rows.find((r) => r.gender) || {}).gender || "";

    // Every school this athlete has results under (handles transfers).
    const schoolCounts = {};
    rows.forEach((r) => { if (r.school_slug) schoolCounts[r.school_slug] = (schoolCounts[r.school_slug] || 0) + 1; });
    const schools = Object.keys(schoolCounts)
      .map((slug) => ({ slug, name: (state.schoolsMap[slug] || {}).name || slug, count: schoolCounts[slug] }))
      .sort((a, b) => b.count - a.count);
    const primarySchool = schools[0] ? schools[0].slug : "";

    const pbs = {};
    rows.forEach((r) => {
      if (r.timeSec == null || r.distance == null) return;
      const key = String(Math.round(Number(r.distance)));
      if (!pbs[key] || r.timeSec < pbs[key].timeSec) pbs[key] = { distance: Number(r.distance), timeSec: r.timeSec, raw: r };
    });
    const ratings = rows.map((r) => r.msm).filter((v) => v != null);
    const bestMsm = ratings.length ? Math.max(...ratings) : null;
    const datedRatings = rows.filter((r) => r.date && r.msm != null).map((r) => ({ date: String(r.date).split("T")[0], rating: r.msm }));
    const pbEntries = Object.values(pbs);
    const best5k = pbs["5000"] || pbEntries.sort((a, b) => a.timeSec - b.timeSec)[0] || null;
    return {
      name, gender,
      schools, schoolSlug: primarySchool,
      rows, pbs, bestMsm, datedRatings,
      raceCount: rows.length,
      meetCount: new Set(rows.map((r) => r.meet_slug).filter(Boolean)).size,
      predictions: best5k ? predictionSet(best5k.timeSec, best5k.distance) : null,
      paces: best5k ? trainingPaces(best5k.timeSec, best5k.distance) : null,
      forecast: forecastTrajectory(datedRatings),
      best5k,
    };
  }

  // Statewide rank by best MSM rating per athlete-name, matching rankings.html's
  // dedupe-by-name. Season-aware.
  function stateRank(name, gender, season) {
    if (!gender) return null;
    const best = {};
    state.results.forEach((r) => {
      if (r.gender !== gender || r.msm == null) return;
      if (!seasonMatch(r, season)) return;
      const k = norm(r.athlete_name);
      if (!k) return;
      if (!(k in best) || r.msm > best[k]) best[k] = r.msm;
    });
    const me = best[norm(name)];
    if (me == null) return null;
    const ranked = Object.values(best).sort((a, b) => b - a);
    return { rank: ranked.filter((v) => v > me).length + 1, total: ranked.length, rating: me };
  }

  // Roster = athletes who have run for this school (in the season, if given).
  // Each athlete's summary still aggregates their full cross-school history so
  // a transfer's complete record is visible, but their season is respected.
  function rosterForSchool(schoolSlug, gender, season) {
    const names = {};
    state.results.forEach((r) => {
      if (r.school_slug !== schoolSlug) return;
      if (gender && r.gender !== gender) return;
      if (!seasonMatch(r, season)) return;
      const k = norm(r.athlete_name);
      if (k) names[k] = r.athlete_name;
    });
    return Object.values(names)
      .map((nm) => athleteSummary(nm, season))
      .filter(Boolean)
      .sort((a, b) => (a.best5k?.timeSec ?? Infinity) - (b.best5k?.timeSec ?? Infinity));
  }

  // Coach-level team metrics from the school's roster summaries.
  function teamInsights(summaries) {
    const withBest = summaries.filter((s) => s.best5k);
    const scoring5 = withBest.slice(0, 5);
    const scoringAvg = scoring5.length ? scoring5.reduce((s, a) => s + a.best5k.timeSec, 0) / scoring5.length : null;
    const spread15 = scoring5.length >= 2 ? scoring5[scoring5.length - 1].best5k.timeSec - scoring5[0].best5k.timeSec : null;
    let packGap = null;
    if (scoring5.length === 5) {
      const ts = scoring5.map((s) => s.best5k.timeSec);
      let g = 0; for (let i = 1; i < 5; i++) g += ts[i] - ts[i - 1];
      packGap = g / 4;
    }
    const improvers = summaries
      .filter((s) => s.forecast && s.forecast.trend === "improving")
      .sort((a, b) => (b.forecast.slopePerWeek) - (a.forecast.slopePerWeek))
      .slice(0, 5);
    return { scoringAvg, spread15, packGap, depth: withBest.length, scoring5, improvers };
  }

  function listSchools() {
    return Object.values(state.schoolsMap).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  function listAthleteNames(gender) {
    const names = {};
    state.results.forEach((r) => {
      if (gender && r.gender !== gender) return;
      const k = norm(r.athlete_name);
      if (k) names[k] = { name: r.athlete_name, school_slug: r.school_slug, gender: r.gender };
    });
    return Object.values(names).sort((a, b) => a.name.localeCompare(b.name));
  }
  function listCourses() {
    return Object.values(state.coursesMap)
      .map((c) => ({ slug: c.slug, name: c.name || c.slug, difficulty: c.difficulty || null, hill: state.factors.hill[c.slug] }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  function listMeets() {
    return Object.values(state.meetsMap)
      .map((m) => ({ slug: m.slug, name: m.name || m.slug, date: m.date || null, course_slug: m.course_slug || "" }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  // =====================================================================
  //  MEET SIMULATION
  // =====================================================================
  // Project an athlete's effort onto a target course + distance.
  // The shared MSM performance boost removes source-course, field, and weather
  // effects; the target course factor is then applied. This keeps simulations
  // from treating an easy-course PR as an athlete's portable ability.
  function projectOntoCourse(sourceRow, targetCourseSlug, targetDistance) {
    if (!sourceRow || sourceRow.timeSec == null) return null;
    const srcDist = sourceRow.distance ? parseInt(sourceRow.distance, 10) : 5000;
    const srcCourse = sourceRow.course_slug || (state.meetsMap[sourceRow.meet_slug] && state.meetsMap[sourceRow.meet_slug].course_slug) || "";
    const sourceBoost = sourceRow._msm && Number(sourceRow._msm.boost) > 0
      ? Number(sourceRow._msm.boost)
      : (state.factors.course[srcCourse] || 1.0);
    const targetFactor = state.factors.course[targetCourseSlug] || 1.0;
    const neutral5k = riegel(sourceRow.timeSec, srcDist, 5000) / sourceBoost;
    const target5k = neutral5k * targetFactor;
    return riegel(target5k, 5000, targetDistance);
  }

  // Best projected time for an athlete onto a course.
  // basis: "recent" (weighted last three efforts, default), "adjusted"
  // (best course-adjusted effort), or "raw" (fastest raw time diagnostic).
  function athleteProjectedTime(summary, courseSlug, distance, basis) {
    if (!summary || !summary.rows.length) return null;
    const timed = summary.rows.filter((r) => r.timeSec != null).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!timed.length) return null;
    if (basis === "raw") {
      const best = timed.slice().sort((a, b) => a.timeSec - b.timeSec)[0];
      return best ? { timeSec: best.timeSec, source: best, projected: false } : null;
    }
    const projected = timed.map((r) => ({ source: r, timeSec: projectOntoCourse(r, courseSlug, distance) })).filter((x) => x.timeSec != null);
    if (!projected.length) return null;
    if (basis === "adjusted") {
      const best = projected.slice().sort((a, b) => a.timeSec - b.timeSec)[0];
      return { timeSec: best.timeSec, source: best.source, projected: true };
    }
    // Recent form is deliberately not a PR: 50/30/20% over the latest three
    // usable races, with fewer races re-normalized instead of invented.
    const recent = projected.slice(0, 3);
    const weights = [0.5, 0.3, 0.2].slice(0, recent.length);
    const weightTotal = weights.reduce((s, w) => s + w, 0);
    const timeSec = recent.reduce((s, x, i) => s + x.timeSec * weights[i], 0) / weightTotal;
    return { timeSec, source: recent[0].source, projected: true, sourceCount: recent.length };
  }

  // Build the entrant list for one team.
  // includedNames: optional Set/array of athlete names to include (else top 7 by time).
  // sourceMeetSlugs: optional meet-result sample selected by the coach. When
  // present, only efforts from those meets are used; this makes the simulator
  // reproducible and prevents a lifetime/PR lookup from sneaking in.
  function teamEntrants(schoolSlug, gender, season, courseSlug, distance, basis, includedNames, sourceMeetSlugs) {
    const roster = rosterForSchool(schoolSlug, gender, season);
    const sourceSet = sourceMeetSlugs && sourceMeetSlugs.length ? new Set(sourceMeetSlugs) : null;
    let entrants = roster.map((s) => {
      const teamRows = s.rows.filter((r) => r.school_slug === schoolSlug && (!sourceSet || sourceSet.has(r.meet_slug)));
      if (!teamRows.length) return null;
      const teamSummary = { ...s, rows: teamRows };
      const t = athleteProjectedTime(teamSummary, courseSlug, distance, basis);
      return t ? { name: s.name, schoolSlug, timeSec: t.timeSec, projected: t.projected, source: t.source, sourceCount: t.sourceCount || 1, summary: s } : null;
    }).filter(Boolean).sort((a, b) => a.timeSec - b.timeSec);
    if (includedNames && includedNames.length) {
      const set = new Set(includedNames.map(norm));
      entrants = entrants.filter((e) => set.has(norm(e.name)));
    } else {
      entrants = entrants.slice(0, 7); // default: top 7
    }
    return entrants;
  }

  // Run the full simulation. teams: [{schoolSlug, includedNames?}].
  // Returns { field:[{...place, scoringPlace}], teams:[{school, score, ...}], distance, courseSlug }.
  // Scoring mirrors meet.html: displacement scoring (non-scorers still take a
  // place); teams need 5+ finishers to score.
  function simulateMeet(opts) {
    const { teamList, gender, season, courseSlug, basis } = opts;
    const sourceMeetSlugs = Array.isArray(opts.sourceMeetSlugs) ? opts.sourceMeetSlugs : null;
    const distance = opts.distance || (state.coursesMap[courseSlug] && parseInt(state.coursesMap[courseSlug].distance, 10)) || 5000;

    // Assemble the field.
    let field = [];
    teamList.forEach((t) => {
      const ents = teamEntrants(t.schoolSlug, gender, season, courseSlug, distance, basis, t.includedNames, sourceMeetSlugs);
      field = field.concat(ents);
    });
    field.sort((a, b) => a.timeSec - b.timeSec);
    field.forEach((e, i) => { e.place = i + 1; });

    // Team scoring — displacement (default meet.html behavior).
    const bySchool = {};
    field.forEach((e) => { (bySchool[e.schoolSlug] = bySchool[e.schoolSlug] || []).push(e); });
    const scoringSchools = new Set(Object.keys(bySchool).filter((s) => bySchool[s].length >= 5));
    // Meet scoring is based on absolute finish places. Incomplete teams still
    // occupy places and displace complete teams; they simply do not receive a
    // team score themselves.
    field.forEach((e) => { e.scoringPlace = scoringSchools.has(e.schoolSlug) ? e.place : null; });

    const teams = Object.keys(bySchool).map((slug) => {
      const runners = bySchool[slug].slice().sort((a, b) => (a.scoringPlace || 999) - (b.scoringPlace || 999));
      const top5 = runners.slice(0, 5);
      const complete = top5.length === 5 && scoringSchools.has(slug);
      const score = complete ? top5.reduce((s, r) => s + (r.scoringPlace || 999), 0) : null;
      const t5 = top5.map((r) => r.timeSec);
      const teamAvg = t5.length === 5 ? t5.reduce((s, x) => s + x, 0) / 5 : null;
      const spread15 = t5.length === 5 ? t5[4] - t5[0] : null;
      const top7 = runners.slice(0, 7);
      const spread17 = top7.length >= 2 ? top7[top7.length - 1].timeSec - top7[0].timeSec : null;
      return {
        schoolSlug: slug,
        school: (state.schoolsMap[slug] || {}).name || slug,
        score, complete, teamAvg, spread15, spread17,
        top5, top7, depth: runners.length,
        sixth: runners[5] || null, seventh: runners[6] || null,
      };
    }).sort((a, b) => {
      if (a.score == null && b.score == null) return (a.teamAvg ?? Infinity) - (b.teamAvg ?? Infinity);
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      if (a.score !== b.score) return a.score - b.score;
      const a6 = a.sixth?.scoringPlace ?? 999, b6 = b.sixth?.scoringPlace ?? 999;
      return a6 - b6;
    });

    return { field, teams, distance, courseSlug, basis, sourceMeetSlugs: sourceMeetSlugs || [] };
  }

  // =====================================================================
  //  EXPECTED TEAMS (mirrors meet.html)
  // =====================================================================
  // meet.html renders a meet's expected field with:
  //   const teamsList = currentMeetData.teams || currentMeetData.expected_teams || [];
  // Entries may be plain names/slugs (strings) or {name|school, slug?} objects.
  // This resolves each entry to a school slug + display name the same way.
  function meetExpectedTeams(meetSlug) {
    const m = state.meetsMap[meetSlug];
    if (!m) return [];
    let list = m.teams && (Array.isArray(m.teams) || typeof m.teams === "object") && (Array.isArray(m.teams) ? m.teams.length : Object.keys(m.teams).length)
      ? m.teams
      : (m.expected_teams || []);
    if (!Array.isArray(list)) list = Object.values(list || {});
    // normName -> slug lookup for entries given as school NAMES.
    const byName = {};
    Object.values(state.schoolsMap).forEach((s) => { if (s.name) byName[slugify(s.name)] = s.slug; });
    const out = [];
    list.forEach((t) => {
      if (t == null || t === "") return;
      const raw = typeof t === "object" ? (t.slug || t.name || t.school || "") : String(t);
      const display = typeof t === "object" ? (t.name || t.school || raw) : raw;
      const slug = state.schoolsMap[raw] ? raw : (byName[slugify(raw)] || slugify(raw));
      if (slug && !out.some((x) => x.slug === slug)) out.push({ slug, name: (state.schoolsMap[slug] || {}).name || display || slug });
    });
    return out;
  }

  // Upcoming meets (today forward), soonest first — for the coach's meet outlook.
  function listUpcomingMeets(limit) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return Object.values(state.meetsMap)
      .filter((m) => m.date && String(m.date).split("T")[0] >= todayStr)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((m) => ({
        slug: m.slug, name: m.name || m.slug, date: m.date, location: m.location || "",
        course_slug: m.course_slug || "",
        expected: meetExpectedTeams(m.slug),
      }))
      .slice(0, limit || 12);
  }

  // =====================================================================
  //  SPLIT COACH — personalized pacing plan from the athlete's own PBs
  // =====================================================================
  // Fit the athlete's personal Riegel exponent from their PBs at two
  // distances. n > 1.06 means they fade relative to the standard endurance
  // model (go out controlled); n < 1.06 means endurance outruns their speed
  // (they can afford to be slightly aggressive early).
  function personalRiegelExponent(summary) {
    const pbs = Object.values(summary && summary.pbs || {})
      .filter((p) => p && p.distance >= 1600 && p.timeSec)
      .sort((a, b) => a.distance - b.distance);
    if (pbs.length < 2) return null;
    const a = pbs[0], b = pbs[pbs.length - 1];
    if (b.distance <= a.distance) return null;
    return Math.log(b.timeSec / a.timeSec) / Math.log(b.distance / a.distance);
  }

  // Build a race-day split plan.
  // opts: { distance (m), goalTimeSec (optional — else best equivalent effort) }
  function splitPlan(summary, opts) {
    opts = opts || {};
    if (!summary || !summary.best5k) return null;
    const distance = Number(opts.distance) || 5000;
    const kms = distance / 1000;
    let goal = opts.goalTimeSec != null && Number(opts.goalTimeSec) > 0 ? Number(opts.goalTimeSec) : null;
    if (goal == null) goal = riegel(summary.best5k.timeSec, summary.best5k.distance, distance);
    if (goal == null || !isFinite(goal)) return null;

    const n = personalRiegelExponent(summary) || RIEGEL;
    const evenKm = goal / kms;
    const evenMile = (evenKm / 1000) * MILE_M;

    // Segment adjustments (seconds per km) keyed to the athlete's fade profile.
    let goOut = 0, close = 0, note = "";
    if (n > 1.09) {
      goOut = 5; close = -5;
      note = `Personal exponent ${n.toFixed(2)} — you fade more than the standard model. Bank nothing early: go out ~5s/km slower than goal and close hard.`;
    } else if (n > 1.07) {
      goOut = 3; close = -3;
      note = `Personal exponent ${n.toFixed(2)} — a slight fade tendency. Control the first km (~3s slow) and invest it in the last one.`;
    } else if (n < 1.03) {
      goOut = -2; close = 2;
      note = `Personal exponent ${n.toFixed(2)} — your endurance outruns your speed. Even to slightly aggressive early is safe for you; expect to pass people late.`;
    } else {
      note = `Personal exponent ${n.toFixed(2)} — an even-effort racer. Lock onto goal pace from the gun and roll.`;
    }

    // Cumulative checkpoints (even pacing), fractional final km handled.
    const checkpoints = [];
    const totalKm = Math.round(kms * 10) / 10;
    for (let k = 1; k <= Math.ceil(kms - 0.01); k++) {
      const segLen = Math.min(1, kms - (k - 1));
      checkpoints.push({ km: Math.round((k - 1 + segLen) * 10) / 10, cumSec: Math.round(evenKm * (k - 1 + segLen)) });
    }

    // Strategy segments: thirds for 3K+, halves for shorter races.
    const strategy = [];
    if (kms >= 3) {
      strategy.push({ label: `First 1 km`, paceSec: evenKm + goOut, tag: goOut > 0 ? "Controlled" : goOut < 0 ? "Aggressive" : "Even" });
      strategy.push({ label: `Through ${Math.floor(kms - 1)} km`, paceSec: evenKm, tag: "Even" });
      strategy.push({ label: "Final km", paceSec: evenKm + close, tag: close < 0 ? "Kick" : "Hold" });
    } else {
      const half = distance / 2;
      strategy.push({ label: `First ${Math.round(half)} m`, paceSec: evenKm + goOut, tag: goOut > 0 ? "Controlled" : "Even" });
      strategy.push({ label: `Second ${Math.round(half)} m`, paceSec: evenKm + close, tag: "Finish" });
    }

    return {
      distance, goalTimeSec: Math.round(goal), evenKm, evenMile,
      exponent: n, goOut, close, note, checkpoints, strategy,
      evenPaceMileSec: evenMile,
    };
  }

  // =====================================================================
  //  MILEAGE PLAN GENERATOR
  // =====================================================================
  // Week-by-week build from the athlete's current volume to a goal race:
  // ~8% weekly growth, a down week every 4th week, peak 3 weeks out,
  // then a 2-week taper. Miles are distributed across the chosen running
  // days (long run, two quality days, easy filler).
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const r2 = (v) => Math.round(v * 2) / 2;

  function mileagePlan(opts) {
    const o = opts || {};
    const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n)); };
    const currentMiles = clampNum(o.currentMiles, 5, 120, 25);
    const daysPerWeek = Math.round(clampNum(o.daysPerWeek, 3, 7, 6));
    const peakMiles = clampNum(o.peakMiles, Math.min(currentMiles, 140), 140, Math.round(currentMiles * 1.35));
    const raceName = (o.raceName || "Goal Race").toString().trim().slice(0, 60);

    // Resolve the goal date (default 8 weeks out). Weeks run Mon–Sun.
    let goal = o.goalDate ? new Date(o.goalDate + "T00:00:00") : null;
    if (!goal || isNaN(goal)) { goal = new Date(); goal.setDate(goal.getDate() + 56); }
    const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    const startMon = mondayOf(new Date());
    const goalMon = mondayOf(goal);
    const nWeeks = Math.max(2, Math.round((goalMon - startMon) / 604800000) + 1);
    if (nWeeks > 30) return null; // refuse absurd horizons

    // Day plan config: indices into DAY_NAMES.
    const longDay = Number.isInteger(o.longDay) ? o.longDay : 6;            // Saturday
    const q1Day = Number.isInteger(o.qualityDay1) ? o.qualityDay1 : 2;      // Tuesday
    const q2Day = Number.isInteger(o.qualityDay2) ? o.qualityDay2 : 4;      // Thursday
    const raceDay = longDay;
    const nQuality = daysPerWeek >= 5 ? 2 : 1;
    const runDays = new Set([longDay, q1Day]);
    if (nQuality === 2) runDays.add(q2Day);
    // Fill remaining running days with easy days: Wed, Mon, Fri, then Sunday
    // (last resort) — most runners keep Sunday as their rest day unless they
    // train all 7 days.
    [3, 1, 5, 0].forEach((d) => {
      if (runDays.size >= daysPerWeek) return;
      if (!runDays.has(d)) runDays.add(d);
    });

    const paces = o.paces || null;
    const weeks = [];
    let totalMiles = 0;

    for (let i = 0; i < nWeeks; i++) {
      const isRaceWeek = i === nWeeks - 1;
      const isTaper = i === nWeeks - 2;
      const isPeak = i === nWeeks - 3;
      let total;
      if (isRaceWeek) total = peakMiles * 0.55;
      else if (isTaper) total = peakMiles * 0.78;
      else if (isPeak) total = peakMiles;
      else {
        const buildWeeks = Math.max(1, nWeeks - 3);
        const t = i / buildWeeks;
        total = currentMiles + (peakMiles - currentMiles) * Math.pow(t, 0.9);
        if (i % 4 === 3 && i !== buildWeeks - 1) total *= 0.82; // down week
      }
      total = Math.max(currentMiles * 0.5, Math.round(total));
      totalMiles += total;

      // Distribute across days.
      const days = DAY_NAMES.map((name, di) => ({ dayIdx: di, day: name, type: runDays.has(di) ? "Easy" : "Rest", miles: 0, desc: "" }));
      let long = isRaceWeek ? r2(Math.min(total * 0.18, 6)) : r2(total * (daysPerWeek >= 5 ? 0.22 : 0.27));
      let q1 = isRaceWeek ? r2(total * 0.22) : r2(total * 0.15);
      let q2 = nQuality === 2 && !isRaceWeek ? r2(total * 0.12) : 0;
      let remaining = total - long - q1 - q2;
      const easyDays = [...runDays].filter((d) => d !== longDay && d !== q1Day && (nQuality === 2 ? d !== q2Day : true));
      const perEasy = easyDays.length ? r2(remaining / easyDays.length) : 0;
      easyDays.forEach((d, idx) => { days[d].miles = idx === easyDays.length - 1 ? r2(remaining - perEasy * (easyDays.length - 1)) : perEasy; });
      days[longDay].miles = long;
      days[q1Day].miles = q1;
      if (nQuality === 2 && !isRaceWeek) days[q2Day].miles = q2;

      // Descriptions.
      const phase = isRaceWeek ? "Race" : isTaper ? "Taper" : isPeak || total >= peakMiles * 0.95 ? "Peak" : "Build";
      const th = paces ? `~${formatClock(paces.threshold)}/mi` : "comfortably hard";
      const iv = paces ? `~${formatClock(paces.interval)}/mi` : "3K–5K effort";
      const ep = paces ? `~${formatClock(paces.easy)}/mi` : "conversational";
      const tempoMin = Math.max(15, Math.min(30, Math.round(q1 * 7)));
      if (isRaceWeek) {
        days[q1Day].type = "Quality — Sharpen";
        days[q1Day].desc = `Race-pace sharpening: 4–6 × 400m at goal pace (${iv}), full recovery.`;
        days[longDay].type = "Pre-race";
        days[longDay].desc = "Shakeout: 20 min very easy + 4 strides. Nothing new.";
      } else {
        days[q1Day].type = "Quality — Threshold";
        days[q1Day].desc = phase === "Peak" ? `Tempo ${tempoMin} min @ threshold (${th}) + 4×200 fast.` : `Tempo ${tempoMin} min @ threshold (${th}) inside an easy run.`;
        if (nQuality === 2) {
          days[q2Day].type = "Quality — Intervals";
          days[q2Day].desc = phase === "Peak" ? `6 × 800m @ ${iv}, 2:30 jog. Last one faster.` : `5 × 600m hills or ${iv} reps, walk/jog recovery.`;
        }
      }
      days.forEach((d) => { if (d.type === "Easy" && d.miles > 0) d.desc = `Easy ${ep}`; else if (d.type === "Rest") d.desc = daysPerWeek < 7 ? "Off / cross-train" : "Off"; });
      if (isRaceWeek) {
        days[raceDay].type = "RACE";
        days[raceDay].miles = Math.max(3.1, r2(total * 0.25));
        days[raceDay].desc = `RACE DAY — ${raceName}. Even splits, controlled first km.`;
      }

      const wStart = new Date(startMon); wStart.setDate(startMon.getDate() + i * 7);
      weeks.push({
        n: i + 1, phase, total,
        startISO: wStart.toISOString().split("T")[0],
        days: days.map(({ day, type, miles, desc }) => ({ day, type, miles, desc })),
      });
    }

    return {
      raceName, weeks, totalMiles: Math.round(totalMiles), peakMiles,
      assumptions: "~8% weekly build, down week every 4th week, 3-week peak/taper into race day. Miles are guidance — adjust for how you actually respond.",
    };
  }

  // =====================================================================
  //  STATEWIDE TEAM COMPARISON
  // =====================================================================
  // Rank WV teams by their scoring 5, using each athlete's BEST MSM RATING as
  // the basis (not raw time). This is distance-, course-, and field-neutral, so
  // a team that raced a 2-mile isn't flattered against a team that raced a 5K.
  // Out-of-season / non-competitive races are excluded (matching rankings.html).
  // The team metric is the top-5 average rating; for readability it's also shown
  // as the equivalent neutral-5K time.
  function teamStatewideComparison(schoolSlug, gender, season) {
    const g = gender || "M";
    const bySchool = {};
    state.results.forEach((r) => {
      if (r.gender !== g) return;
      if (!seasonMatch(r, season)) return;
      if (!isInState(r)) return;
      if (isNonCompetitive(r.meet_slug)) return;        // in-season only
      if (!r.school_slug || r.msm == null) return;      // needs a rating
      const k = norm(r.athlete_name);
      if (!k) return;
      const bucket = (bySchool[r.school_slug] = bySchool[r.school_slug] || {});
      if (!bucket[k] || r.msm > bucket[k]) bucket[k] = r.msm; // athlete's best rating
    });
    const teams = Object.keys(bySchool).map((slug) => {
      const ratings = Object.values(bySchool[slug]).sort((a, b) => b - a); // best first
      const top5 = ratings.slice(0, 5);
      const avgRating = top5.length === 5 ? Math.round(top5.reduce((s, x) => s + x, 0) / 5) : null;
      const spreadRating = top5.length === 5 ? top5[0] - top5[4] : null; // 1st minus 5th rating
      // Equivalent neutral-5K time of the average rating, for display.
      const scoringAvg = avgRating != null ? R().pointsToEquiv5Ksec(g, avgRating) : null;
      const spread15 = (top5.length === 5)
        ? R().pointsToEquiv5Ksec(g, top5[4]) - R().pointsToEquiv5Ksec(g, top5[0])
        : null;

      return {
        schoolSlug: slug, school: (state.schoolsMap[slug] || {}).name || slug,
        avgRating, spreadRating, scoringAvg, spread15, depth: ratings.length,
      };
    }).filter((t) => t.avgRating != null).sort((a, b) => b.avgRating - a.avgRating); // higher rating = better

    const idx = teams.findIndex((t) => t.schoolSlug === schoolSlug);
    return { rank: idx >= 0 ? idx + 1 : null, total: teams.length, teams, me: idx >= 0 ? teams[idx] : null };
  }

  // =====================================================================
  //  ADVANCED PER-ATHLETE TRAINING TIPS
  // =====================================================================
  function advancedTips(summary) {
    if (!summary) return [];
    const tips = [];
    const fc = summary.forecast;
    const rows = summary.rows.filter((r) => r.date && r.timeSec != null).sort((a, b) => a.date.localeCompare(b.date));

    // Trajectory
    if (fc) {
      if (fc.trend === "improving") tips.push({ tag: "Trajectory", tone: "good", text: `Rating rising ~${fc.slopePerWeek.toFixed(1)} pts/week. Hold the current training load; protect easy days so the upward trend continues into championship season.` });
      else if (fc.trend === "declining") tips.push({ tag: "Trajectory", tone: "warn", text: `Rating slipping ~${Math.abs(fc.slopePerWeek).toFixed(1)} pts/week. Check for accumulated fatigue — consider a down week, then reassess before adding intensity.` });
      else tips.push({ tag: "Trajectory", tone: "neutral", text: `Rating is flat. A focused block of threshold work (2×/week) is the highest-leverage change to break the plateau.` });
    }

    // Race spacing / volume of racing
    if (rows.length >= 2) {
      const gaps = [];
      for (let i = 1; i < rows.length; i++) gaps.push((Date.parse(rows[i].date) - Date.parse(rows[i - 1].date)) / 86400000);
      const avgGap = gaps.reduce((s, x) => s + x, 0) / gaps.length;
      if (avgGap < 6) tips.push({ tag: "Racing load", tone: "warn", text: `Racing every ~${Math.round(avgGap)} days. That's aggressive — make sure at least one week between key races is a true recovery week to avoid flatlining.` });
      else tips.push({ tag: "Racing load", tone: "neutral", text: `Averaging ~${Math.round(avgGap)} days between races — a sustainable rhythm. Keep one quality session + one long run between races.` });
    } else {
      tips.push({ tag: "Racing load", tone: "neutral", text: `Only ${rows.length} timed race on file — more data will sharpen these projections. Log time trials if races are sparse.` });
    }

    // Consistency / variability
    const times = rows.map((r) => r.timeSec);
    if (times.length >= 3) {
      const mean = times.reduce((s, x) => s + x, 0) / times.length;
      const sd = Math.sqrt(times.reduce((s, x) => s + (x - mean) ** 2, 0) / times.length);
      const cv = sd / mean;
      if (cv > 0.04) tips.push({ tag: "Consistency", tone: "warn", text: `Race times vary a lot (±${Math.round(sd)}s). Work on even pacing — target negative or even splits in workouts so race-day execution stabilizes.` });
      else tips.push({ tag: "Consistency", tone: "good", text: `Very consistent race times (±${Math.round(sd)}s). Pacing is a strength — you can race aggressively from the gun.` });
    }

    // Distance-specific: strength vs. speed lean from Riegel comparison
    const pbEntries = Object.values(summary.pbs);
    if (pbEntries.length >= 2) {
      const shortest = pbEntries.slice().sort((a, b) => a.distance - b.distance)[0];
      const longest = pbEntries.slice().sort((a, b) => b.distance - a.distance)[0];
      const predLongFromShort = riegel(shortest.timeSec, shortest.distance, longest.distance);
      if (predLongFromShort && longest.timeSec < predLongFromShort * 0.99) {
        tips.push({ tag: "Profile", tone: "neutral", text: `Stronger at longer distances than short-speed predicts — a strength runner. Add strides & short hill sprints to sharpen turnover for XC finishes.` });
      } else if (predLongFromShort && longest.timeSec > predLongFromShort * 1.01) {
        tips.push({ tag: "Profile", tone: "neutral", text: `Speed outpaces endurance — a speed runner. Prioritize aerobic volume and tempo work to hold pace over the full 5K.` });
      }
    }

    // Pace-zone reminder tied to their best effort
    if (summary.paces) {
      tips.push({ tag: "Paces", tone: "neutral", text: `Anchor easy days at ${formatClock(summary.paces.easy)}/mi and threshold reps at ${formatClock(summary.paces.threshold)}/mi. Most weekly mileage should be at or slower than easy pace.` });
    }
    return tips;
  }

  window.MSMEngine = {
    // lifecycle
    load, get state() { return state; },
    // formatting
    formatTime, formatClock, distanceLabel, slugify, norm,
    // rating + predictions + paces
    computeRating, computeRatingValue, ratingToPredicted, weatherDifficultyFactor,
    riegel, predictionSet, trainingPaces, forecastTrajectory,
    // queries
    resultsForAthlete, athleteSummary, stateRank, rosterForSchool, teamInsights,
    listSchools, listAthleteNames, listSeasons, seasonMatch, meetTypeMatch,
    listCourses, listMeets,
    // simulation + advanced analysis
    projectOntoCourse, athleteProjectedTime, teamEntrants, simulateMeet,
    teamStatewideComparison, advancedTips,
    // expected teams / meet outlook
    meetExpectedTeams, listUpcomingMeets,
    // split coach + mileage planning
    personalRiegelExponent, splitPlan, mileagePlan,
    // constants
    MILE_M, KNOWN_DISTANCES,
  };
})();
