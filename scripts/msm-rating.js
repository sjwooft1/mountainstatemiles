// ============================================================
//  msm-rating.js  —  Mountain State Miles unified rating engine
//  SINGLE SOURCE OF TRUTH for the MSM Rating.
//
//  Loaded by BOTH rankings.html and the portal (portal-engine.js delegates
//  to it), so the two can never disagree again.
//
//  Public API (window.MSMRating):
//    await buildModel(results, { meetsMap, coursesMap, fetchWeather })
//        results: [{ athlete_name, gender('M'|'F'), meet_slug, course_slug,
//                    distance, time_in_seconds, date }]
//        Builds every statewide factor: global median pace, GPX hill factors,
//        common-athlete course calibration, and per-race pack structures.
//    rate(result)   -> { rating, cF, fF, wF, adjPace } | null
//    ratingToPredicted(rating, gender, distMeters=5000) -> seconds
//    ratingToPredicted5K(rating, gender) -> seconds
//    constants: REF, SPREAD
//
//  The rating: 1000 = a neutral reference performance (16:00 5K boys /
//  18:30 5K girls). Each ~35 rating points ≈ 1% faster on a neutral course
//  in an average field. Higher = better.
// ============================================================

(function () {
  "use strict";

  // ---- reference constants (unchanged from the original engine) -------
  const REF = { M: (16 * 60) / 5000, F: (18.5 * 60) / 5000 }; // sec per meter
  const SPREAD = 350;

  const OUT_OF_SEASON_MEETS = ["chick-fil-a-5k", "st-marys-5k", "ymca-kennedy-center"];

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

  // ---- model state (rebuilt by buildModel) ----------------------------
  const M = {
    meetsMap: {}, coursesMap: {},
    globalMedianPace: { M: null, F: null },
    hill: {},            // courseSlug -> terrain multiplier (>1 harder)
    courseFactor: {},    // courseSlug -> blended difficulty multiplier
    courseInfo: {},      // courseSlug -> { hill, common, commonN, blended }
    fieldByAthlete: {},  // resultKey -> individualized field factor
    weather: {},         // meetSlug -> wx | null
    raceGroups: {},      // "meet|gender|dist" -> sorted [{key,pace,time,name}]
  };

  // ---- small utils ----------------------------------------------------
  const norm = (s) => (s || "").toString().trim().toLowerCase();
  const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const distOf = (r) => (r.distance ? parseInt(r.distance, 10) : 5000);
  const paceOf = (r) => { const d = distOf(r); const t = Number(r.time_in_seconds); return d && t ? t / d : null; };
  const resultKey = (r) => `${norm(r.athlete_name)}|${r.meet_slug}|${distOf(r)}|${r.time_in_seconds}`;
  const courseOf = (r) => r.course_slug || (M.meetsMap[r.meet_slug] && M.meetsMap[r.meet_slug].course_slug) || "unknown";

  const safeSS = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  };

  function isNonCompetitive(meetSlug) {
    if (OUT_OF_SEASON_MEETS.includes(meetSlug)) return true;
    const meet = M.meetsMap[meetSlug];
    if (meet && meet.date) {
      const p = String(meet.date).split("T")[0].split("-");
      if (p.length >= 3) {
        const mo = parseInt(p[1], 10), day = parseInt(p[2], 10);
        if (mo < 8 || (mo === 8 && day < 22)) return true;
        if (mo > 11 || (mo === 11 && day > 1)) return true;
      }
    }
    return false;
  }

  // =====================================================================
  //  TERRAIN (GPX hills) — same as before
  // =====================================================================
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function parseGpxClimb(gpxText) {
    try {
      const doc = new DOMParser().parseFromString(gpxText, "application/xml");
      const pts = Array.from(doc.getElementsByTagName("trkpt"));
      if (pts.length < 2) return null;
      let climb = 0, dist = 0, prevEle = null, prevLat = null, prevLon = null;
      pts.forEach((pt) => {
        const lat = parseFloat(pt.getAttribute("lat")), lon = parseFloat(pt.getAttribute("lon"));
        const eleNode = pt.getElementsByTagName("ele")[0];
        const ele = eleNode ? parseFloat(eleNode.textContent) : null;
        if (prevEle !== null && ele !== null) { const d = ele - prevEle; if (d > 0.3) climb += d; }
        if (prevLat !== null) dist += haversineMeters(prevLat, prevLon, lat, lon);
        if (ele !== null) prevEle = ele;
        prevLat = lat; prevLon = lon;
      });
      return { climb, dist };
    } catch (e) { return null; }
  }
  function climbToFactor(mPerKm) {
    const NEUTRAL = 15;
    return clampN(1 + (mPerKm - NEUTRAL) * 0.004, 0.94, 1.14);
  }
  function difficultyLabelFactor(label) {
    switch ((label || "").toLowerCase()) {
      case "hard": return 1.06;
      case "medium": return 1.0;
      case "easy": return 0.96;
      default: return 1.0;
    }
  }
  async function buildHillFactors() {
    M.hill = {};
    const slugs = Object.keys(M.coursesMap || {});
    await Promise.all(slugs.map(async (slug) => {
      const course = M.coursesMap[slug];
      if (!course) return;
      if (course.gpx_url) {
        const ssKey = `msm_hill_${slug}`;
        const cached = safeSS.get(ssKey);
        if (cached !== null) { M.hill[slug] = parseFloat(cached); return; }
        try {
          const res = await fetch(course.gpx_url);
          if (res.ok) {
            const parsed = parseGpxClimb(await res.text());
            if (parsed && parsed.dist > 100) {
              const f = climbToFactor(parsed.climb / (parsed.dist / 1000));
              M.hill[slug] = f; safeSS.set(ssKey, String(f)); return;
            }
          }
        } catch (e) {}
      }
      M.hill[slug] = difficultyLabelFactor(course.difficulty);
    }));
  }

  // =====================================================================
  //  COURSE DIFFICULTY — common-athlete calibration blended with hills
  // =====================================================================
  //  Idea: a course is "hard" if the SAME runners run measurably slower on it
  //  than they do elsewhere. For every athlete with a race on course C and at
  //  least one race off C, take the ratio (their pace on C) / (their median
  //  pace off C). Average those ratios across all such athletes → a purely
  //  data-driven difficulty for C. Blend with the GPX/terrain hill factor,
  //  weighting the data term by how many common athletes we have (so a course
  //  only run a handful of times leans on terrain instead of noisy data).
  function buildCourseFactors(results) {
    // pace samples per athlete, split into (this course) vs (other courses)
    const byAthlete = {}; // name -> { course -> [paces], all -> [{course,pace}] }
    results.forEach((r) => {
      if (isNonCompetitive(r.meet_slug)) return;
      const p = paceOf(r); if (p == null) return;
      const g = r.gender; if (g !== "M" && g !== "F") return;
      const name = norm(r.athlete_name); if (!name) return;
      const c = courseOf(r);
      const a = (byAthlete[name] = byAthlete[name] || { byCourse: {}, samples: [] });
      (a.byCourse[c] = a.byCourse[c] || []).push(p);
      a.samples.push({ course: c, pace: p });
    });

    const ratios = {}; // course -> [ratios]
    Object.values(byAthlete).forEach((a) => {
      const courses = Object.keys(a.byCourse);
      if (courses.length < 2) return; // need at least one off-course sample
      courses.forEach((c) => {
        const onC = median(a.byCourse[c]);
        const offPaces = a.samples.filter((s) => s.course !== c).map((s) => s.pace);
        const offMed = median(offPaces);
        if (onC && offMed) {
          (ratios[c] = ratios[c] || []).push(onC / offMed);
        }
      });
    });

    M.courseFactor = {};
    M.courseInfo = {};
    const allCourses = new Set([...Object.keys(M.hill), ...Object.keys(ratios)]);
    allCourses.forEach((c) => {
      const hill = typeof M.hill[c] === "number" ? M.hill[c] : 1.0;
      const rs = ratios[c] || [];
      const commonN = rs.length;
      let common = null;
      if (commonN) common = clampN(median(rs), 0.90, 1.14);
      // Blend weight: data term earns trust as commonN grows (full trust ~12+).
      const w = common != null ? Math.min(commonN / 12, 0.7) : 0; // cap data at 70%
      const blended = common != null ? clampN(hill * (1 - w) + common * w, 0.90, 1.14) : hill;
      M.courseFactor[c] = blended;
      M.courseInfo[c] = { hill, common, commonN, blended, dataWeight: w };
    });
  }

  // =====================================================================
  //  FIELD STRENGTH — individualized, pack-based (conservative ±3%)
  // =====================================================================
  //  Rationale (from the coach's own reasoning): running ALONE with a big gap
  //  to the nearest competitors means you had no one to pull you along, so an
  //  equal time is a HARDER effort → boost. Being carried inside a tight, fast
  //  pack makes an equal time slightly EASIER → small discount.
  //
  //  For each runner we look at their nearest neighbours by time within the
  //  same race (same meet|gender|distance): the k runners ahead and k behind.
  //  We measure the average pace gap to them, normalized by the field's own
  //  typical spacing, and separately weight the gap to runners BEHIND (being
  //  chased with nobody near = truly solo). Small, capped adjustment.
  const PACK_K = 3;                 // neighbours each side
  const FIELD_CAP = 0.03;           // ±3% (conservative)

  function buildRaceGroups(results) {
    M.raceGroups = {};
    results.forEach((r) => {
      const g = r.gender; if (g !== "M" && g !== "F") return;
      const t = Number(r.time_in_seconds); if (!t) return;
      const key = `${r.meet_slug}|${g}|${distOf(r)}`;
      (M.raceGroups[key] = M.raceGroups[key] || []).push({
        key: resultKey(r), name: norm(r.athlete_name),
        pace: paceOf(r), time: t,
      });
    });
    Object.values(M.raceGroups).forEach((arr) => arr.sort((a, b) => a.time - b.time));
  }

  function buildFieldFactors() {
    M.fieldByAthlete = {};
    Object.values(M.raceGroups).forEach((field) => {
      const n = field.length;
      if (n < 3) { field.forEach((e) => { M.fieldByAthlete[e.key] = 1.0; }); return; }
      // Typical spacing in this race = median gap between consecutive finishers.
      const gaps = [];
      for (let i = 1; i < n; i++) gaps.push(field[i].pace - field[i - 1].pace);
      const medGap = median(gaps.filter((g) => g > 0)) || (field[n - 1].pace - field[0].pace) / Math.max(1, n - 1) || 1e-6;

      field.forEach((e, i) => {
        // Nearest neighbours ahead (faster) and behind (slower).
        const ahead = [];
        for (let j = i - 1; j >= 0 && ahead.length < PACK_K; j--) ahead.push(field[j].pace);
        const behind = [];
        for (let j = i + 1; j < n && behind.length < PACK_K; j++) behind.push(field[j].pace);

        const avgGapAhead = ahead.length ? ahead.reduce((s, p) => s + Math.abs(p - e.pace), 0) / ahead.length : null;
        const avgGapBehind = behind.length ? behind.reduce((s, p) => s + Math.abs(p - e.pace), 0) / behind.length : null;

        // Isolation score: how large the surrounding gaps are vs the race's
        // typical spacing. Weight the gap to runners BEHIND more heavily —
        // leading a race with a big cushion is the classic "ran alone" case.
        const rel = (gap) => (gap == null ? null : gap / medGap);
        const relAhead = rel(avgGapAhead);
        const relBehind = rel(avgGapBehind);
        let isolation;
        if (relAhead != null && relBehind != null) isolation = 0.4 * relAhead + 0.6 * relBehind;
        else isolation = relAhead != null ? relAhead : (relBehind != null ? relBehind : 1);

        // isolation ~1 means normal spacing (no adjustment). >1 isolated (boost),
        // <1 tightly packed (discount). Map to a small factor with tanh, capped.
        // factor <1 makes the adjusted pace FASTER → higher rating (boost).
        const dev = isolation - 1;                    // + = isolated, − = packed
        const raw = -FIELD_CAP * Math.tanh(dev * 0.6); // isolated -> negative -> boost
        M.fieldByAthlete[e.key] = clampN(1 + raw, 1 - FIELD_CAP, 1 + FIELD_CAP);
      });
    });
  }

  // =====================================================================
  //  WEATHER — same as before (optional; caller supplies fetchWeather)
  // =====================================================================
  function weatherDifficultyFactor(wx) {
    if (!wx) return 1.0;
    let f = 1.0;
    if (typeof wx.tempMaxC === "number" && wx.tempMaxC > 18) f += Math.min((wx.tempMaxC - 18) * 0.006, 0.09);
    if (typeof wx.tempMaxC === "number" && wx.tempMaxC < -5) f += Math.min((-5 - wx.tempMaxC) * 0.004, 0.04);
    if (typeof wx.windMaxKmh === "number" && wx.windMaxKmh > 15) f += Math.min((wx.windMaxKmh - 15) * 0.0025, 0.05);
    if (typeof wx.precipMm === "number" && wx.precipMm > 1) f += Math.min(wx.precipMm * 0.004, 0.06);
    return f;
  }
  function meetCoords(meet) {
    if (!meet) return WV_DEFAULT_COORDS;
    if (typeof meet.lat === "number" && typeof meet.lon === "number") return { lat: meet.lat, lon: meet.lon };
    const cs = meet.course_slug || meet.course || "";
    if (cs && COURSE_COORDS[cs]) return COURSE_COORDS[cs];
    return WV_DEFAULT_COORDS;
  }
  function meetDateISO(meet) {
    if (!meet || !meet.date) return null;
    const d = String(meet.date).split("T")[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  async function fetchWeatherForMeet(meetSlug) {
    if (meetSlug in M.weather) return M.weather[meetSlug];
    const ssKey = `msm_wx_${meetSlug}`;
    const cached = safeSS.get(ssKey);
    if (cached !== null) { M.weather[meetSlug] = JSON.parse(cached); return M.weather[meetSlug]; }
    const meet = M.meetsMap[meetSlug];
    const iso = meetDateISO(meet);
    if (!iso) { M.weather[meetSlug] = null; safeSS.set(ssKey, "null"); return null; }
    const { lat, lon } = meetCoords(meet);
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
      + `&start_date=${iso}&end_date=${iso}`
      + `&daily=temperature_2m_max,wind_speed_10m_max,precipitation_sum`
      + `&temperature_unit=celsius&wind_speed_unit=kmh&timezone=America%2FNew_York`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      const daily = json && json.daily;
      const wx = daily ? {
        tempMaxC: Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null,
        windMaxKmh: Array.isArray(daily.wind_speed_10m_max) ? daily.wind_speed_10m_max[0] : null,
        precipMm: Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum[0] : null,
      } : null;
      M.weather[meetSlug] = wx; safeSS.set(ssKey, JSON.stringify(wx)); return wx;
    } catch (e) { M.weather[meetSlug] = null; safeSS.set(ssKey, "null"); return null; }
  }

  // =====================================================================
  //  GLOBAL BASELINE
  // =====================================================================
  function buildGlobalMedians(results) {
    const byG = { M: [], F: [] };
    results.forEach((r) => {
      if (isNonCompetitive(r.meet_slug)) return;
      const g = r.gender; if (g !== "M" && g !== "F") return;
      const p = paceOf(r); if (p != null) byG[g].push(p);
    });
    M.globalMedianPace.M = median(byG.M);
    M.globalMedianPace.F = median(byG.F);
  }

  // =====================================================================
  //  RATING
  // =====================================================================
  function courseFactorFor(r) {
    const c = courseOf(r);
    const f = typeof M.courseFactor[c] === "number" ? M.courseFactor[c] : (typeof M.hill[c] === "number" ? M.hill[c] : 1.0);
    return clampN(f, 0.90, 1.14);
  }
  function fieldFactorFor(r) {
    const f = M.fieldByAthlete[resultKey(r)];
    return typeof f === "number" ? f : 1.0;
  }
  function paceToRating(adjPace, gender) {
    const ref = REF[gender] || REF.M;
    const pctFaster = (ref - adjPace) / ref;
    return Math.max(0, Math.round(1000 + pctFaster * (SPREAD * 10)));
  }
  function ratingToPredicted(rating, gender, distMeters) {
    const ref = REF[gender] || REF.M;
    const pctFaster = (rating - 1000) / (SPREAD * 10);
    const neutralPace = ref * (1 - pctFaster);
    return Math.max(1, neutralPace * (distMeters || 5000));
  }
  function ratingToPredicted5K(rating, gender) { return ratingToPredicted(rating, gender, 5000); }

  // Returns { rating, cF, fF, wF, adjPace } — identical shape to the old engine.
  function rate(r, weatherOverride) {
    const dist = distOf(r);
    const t = Number(r.time_in_seconds);
    if (!dist || !t) return null;
    const rawPace = t / dist;
    const cF = courseFactorFor(r);
    const fF = fieldFactorFor(r);
    const wF = typeof weatherOverride === "number"
      ? weatherOverride
      : weatherDifficultyFactor(M.weather[r.meet_slug]);
    let boost = cF * fF * wF;
    boost = clampN(boost, 0.90, 1.10);
    const adjPace = rawPace / boost;
    return { rating: paceToRating(adjPace, r.gender), cF, fF, wF, adjPace };
  }

  // =====================================================================
  //  BUILD MODEL (one call sets everything up)
  // =====================================================================
  //  results: normalized array (see header). opts.meetsMap / coursesMap are
  //  slug-keyed. opts.fetchWeather (bool) triggers Open-Meteo lookups for every
  //  meet present (cached). If false, weather is neutral (wF = 1).
  async function buildModel(results, opts) {
    opts = opts || {};
    M.meetsMap = opts.meetsMap || {};
    M.coursesMap = opts.coursesMap || {};
    M.weather = {};

    await buildHillFactors();
    buildGlobalMedians(results);
    buildCourseFactors(results);
    buildRaceGroups(results);
    buildFieldFactors();

    if (opts.fetchWeather) {
      const slugs = [...new Set(results.map((r) => r.meet_slug).filter(Boolean))];
      await Promise.all(slugs.map((s) => fetchWeatherForMeet(s)));
    }
    return M;
  }

  window.MSMRating = {
    buildModel, rate,
    ratingToPredicted, ratingToPredicted5K,
    weatherDifficultyFactor, fetchWeatherForMeet, isNonCompetitive,
    // introspection (for the explainer page + debugging)
    get model() { return M; },
    courseInfo: (slug) => M.courseInfo[slug] || null,
    REF, SPREAD,
  };
})();
