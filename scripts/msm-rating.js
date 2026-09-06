// ============================================================
//  msm-rating.js  —  MSM Rating Engine (full model)
// ============================================================
//
//  One number per performance, on a 1000-point scale (higher is
//  better). Every raw time is:
//    1. reduced to pace (sec/m),
//    2. normalized across distance with the Riegel endurance model,
//    3. divided by a boost that captures how hard the conditions were
//       (course difficulty + individual field isolation + weather),
//    4. mapped onto the 1000 scale against a reference pace.
//
//  rating = round( 1000 + 3500 × (REF − adjustedPace) / REF )
//  adjustedPace = rawPace5K ÷ (courseFactor × fieldFactor × weatherFactor)
//
//  The same engine backs the rankings page and the athlete/coach
//  portal, so a rating is identical wherever it is shown.
// ============================================================

(function () {
  "use strict";

  // --- Constants -------------------------------------------------

  // Reference (1000-point) performance, as a 5K pace in sec/m.
  // 16:00 boys / 18:30 girls over 5000 m.
  const REF_TIME = { M: 16 * 60, F: 18.5 * 60 };
  const REF_PACE = { M: REF_TIME.M / 5000, F: REF_TIME.F / 5000 };

  // Riegel endurance exponent: T2 = T1 × (D2/D1)^RIEGEL.
  const RIEGEL = 1.06;

  // Course model.
  const NEUTRAL_CLIMB_PER_KM = 15;      // m/km treated as neutral WV terrain
  const HILL_SLOPE = 0.004;             // factor per (m/km) above neutral
  const HILL_CLAMP = [0.94, 1.14];
  const DIFFICULTY_FALLBACK = { easy: 0.96, medium: 1.00, hard: 1.06 };
  const COMMON_ATHLETE_CAP = 12;        // shared athletes for full data weight
  const COMMON_WEIGHT_MAX = 0.70;
  const COURSE_CLAMP = [0.90, 1.14];

  // Field (isolation) model.
  const NEIGHBORS = 3;                  // runners ahead / behind examined
  const FIELD_AMPLITUDE = 0.03;         // ±3% cap
  const FIELD_TANH_SCALE = 0.6;
  const FIELD_CLAMP = [0.97, 1.03];

  // Weather model (all additive to the factor; factor = 1 + sum).
  const WEATHER_CLAMP = [1.00, 1.15];

  // Overall boost guardrail.
  const BOOST_CLAMP = [0.90, 1.10];

  // Points scale.
  const POINTS_REF = 1000;
  const POINTS_SPAN = 3500;

  // --- Model state ----------------------------------------------

  const M = {
    ratings: {},        // athleteKey -> best (highest) rating this build
    perfByAthlete: {},  // athleteKey -> [{ raceKey, rating, ... }]
    courseFactor: {},   // courseKey -> blended difficulty factor
    weatherFactor: {},  // raceKey   -> weather factor
    meta: {}            // misc build metadata
  };

  // --- Helpers ---------------------------------------------------

  const norm = (s) => (s || "").toString().trim().toLowerCase();
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const median = (arr) => {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);

  const raceKey = (r) => `${r.meet_slug}|${r.gender}|${r.distance || 5000}`;
  const athleteKey = (r) => `${r.gender}|${norm(r.athlete_name)}`;
  const courseKeyOf = (r) => r.course_slug || r.meet_slug || "unknown";
  const distOf = (r) => {
    const d = r.distance ? parseInt(r.distance, 10) : 5000;
    return d > 0 ? d : 5000;
  };

  // Convert a raced time at `dist` meters into an equivalent 5000 m
  // time using Riegel, then to a 5K pace (sec/m). Riegel realistically
  // penalizes projecting a short race (mile, 3200) up to 5K, so a fast
  // 1600 no longer masquerades as a fast 5K.
  function riegel5KPace(timeSec, dist) {
    const equiv5K = timeSec * Math.pow(5000 / dist, RIEGEL);
    return equiv5K / 5000;
  }

  // ---- Course difficulty ---------------------------------------

  // Terrain factor from a GPX track, falling back to an admin label.
  function terrainFactor(course) {
    if (course && typeof course.climb_per_km === "number") {
      const f = 1 + (course.climb_per_km - NEUTRAL_CLIMB_PER_KM) * HILL_SLOPE;
      return clamp(f, HILL_CLAMP[0], HILL_CLAMP[1]);
    }
    if (course && course.difficulty) {
      const key = norm(course.difficulty);
      if (DIFFICULTY_FALLBACK[key] != null) return DIFFICULTY_FALLBACK[key];
    }
    return 1.00;
  }

  // Common-athlete calibration: a course is hard if the same runners
  // run slower on it (in 5K-equivalent pace) than on their other
  // courses. Returns { factor, n } where n is the shared-athlete count,
  // or null if there is no usable signal.
  function commonAthleteFactor(courseKey, byCourse5KPace) {
    const ratios = [];
    for (const aKey in byCourse5KPace) {
      const paces = byCourse5KPace[aKey];
      const here = paces[courseKey];
      if (here == null) continue;
      const others = [];
      for (const ck in paces) if (ck !== courseKey) others.push(paces[ck]);
      if (!others.length) continue;
      const med = median(others);
      if (med && med > 0) ratios.push(here / med);
    }
    if (!ratios.length) return null;
    return { factor: median(ratios), n: ratios.length };
  }

  // ---- Field isolation -----------------------------------------

  // For one runner in a sorted-by-time field, measure how isolated
  // they are versus the race's typical spacing. >1 = isolated (boost),
  // <1 = tightly packed (discount). Gaps are in 5K-equiv pace terms so
  // mixed-distance fields (rare within one race) stay comparable.
  function fieldFactorFor(idx, paces, typicalGap) {
    if (!typicalGap || typicalGap <= 0) return 1.00;

    const gapMean = (from, dir) => {
      const gaps = [];
      for (let k = 1; k <= NEIGHBORS; k++) {
        const j = from + dir * k;
        if (j < 0 || j >= paces.length) break;
        gaps.push(Math.abs(paces[j] - paces[from]));
      }
      return gaps.length ? mean(gaps) : null;
    };

    const ahead = gapMean(idx, -1);   // faster neighbors
    const behind = gapMean(idx, +1);  // slower neighbors

    const relAhead = ahead != null ? ahead / typicalGap : 1;
    const relBehind = behind != null ? behind / typicalGap : 1;

    // Weight the gap to runners behind more heavily: leading with a big
    // cushion is the textbook "ran alone" case.
    const isolation = 0.4 * relAhead + 0.6 * relBehind;

    const f = 1 - FIELD_AMPLITUDE * Math.tanh((isolation - 1) * FIELD_TANH_SCALE);
    return clamp(f, FIELD_CLAMP[0], FIELD_CLAMP[1]);
  }

  // ---- Weather -------------------------------------------------

  // Build a difficulty factor from a meet's daily conditions. Missing
  // weather yields a neutral 1.0 — we never invent an adjustment.
  function weatherFactor(meet) {
    const wx = meet && (meet.weather || meet.wx);
    if (!wx) return 1.00;

    let add = 0;
    const t = typeof wx.temp_c === "number" ? wx.temp_c : null;      // °C
    const wind = typeof wx.wind_kmh === "number" ? wx.wind_kmh : null;
    const precip = typeof wx.precip_mm === "number" ? wx.precip_mm : null;

    if (t != null) {
      if (t > 18) add += Math.min((t - 18) * 0.006, 0.09);           // heat, up to +9%
      else if (t < -5) add += Math.min((-5 - t) * 0.004, 0.04);      // cold, up to +4%
    }
    if (wind != null && wind > 15) add += Math.min((wind - 15) * 0.0025, 0.05); // up to +5%
    if (precip != null && precip > 1) add += Math.min((precip - 1) * 0.01, 0.06); // up to +6%

    return clamp(1 + add, WEATHER_CLAMP[0], WEATHER_CLAMP[1]);
  }

  // ---- Rating math ---------------------------------------------

  function paceToPoints(gender, adjustedPace) {
    const ref = REF_PACE[gender] || REF_PACE.M;
    return Math.round(POINTS_REF + POINTS_SPAN * (ref - adjustedPace) / ref);
  }

  // Invert the rating back into a neutral-course equivalent 5K time.
  function pointsToEquiv5Ksec(gender, points) {
    const ref = REF_PACE[gender] || REF_PACE.M;
    const adjustedPace = ref - (points - POINTS_REF) * ref / POINTS_SPAN;
    return (adjustedPace * 0.98) * 5000;
  }

  // --- Build ----------------------------------------------------

  async function buildModel(results, opts = {}) {
    const meetsMap = opts.meetsMap || {};
    const coursesMap = opts.coursesMap || {};

    M.ratings = {};
    M.perfByAthlete = {};
    M.courseFactor = {};
    M.weatherFactor = {};
    M.meta = { built: Date.now(), courseDetail: {} };

    const valid = results.filter(r =>
      r.time_in_seconds && r.time_in_seconds > 0 && r.athlete_name && r.date
    );

    // Group into races (same meet + gender + distance).
    const races = {};
    valid.forEach(r => {
      const key = raceKey(r);
      (races[key] || (races[key] = [])).push(r);
    });

    // --- Pass 1: per-athlete 5K-equiv pace per course (for course
    // calibration). Uses each athlete's median pace on each course.
    const byCoursePaceLists = {}; // aKey -> courseKey -> [pace,...]
    valid.forEach(r => {
      const aKey = athleteKey(r);
      const ck = courseKeyOf(r);
      const pace = riegel5KPace(r.time_in_seconds, distOf(r));
      const lists = byCoursePaceLists[aKey] || (byCoursePaceLists[aKey] = {});
      (lists[ck] || (lists[ck] = [])).push(pace);
    });
    const byCourse5KPace = {}; // aKey -> courseKey -> median pace
    for (const aKey in byCoursePaceLists) {
      byCourse5KPace[aKey] = {};
      for (const ck in byCoursePaceLists[aKey]) {
        byCourse5KPace[aKey][ck] = median(byCoursePaceLists[aKey][ck]);
      }
    }

    // --- Pass 2: course difficulty factor (blend terrain + common).
    const courseKeys = new Set(valid.map(courseKeyOf));
    courseKeys.forEach(ck => {
      const course = coursesMap[ck] || null;
      const terrain = terrainFactor(course);
      const common = commonAthleteFactor(ck, byCourse5KPace);

      let factor, detail;
      if (common) {
        const w = Math.min(common.n / COMMON_ATHLETE_CAP, COMMON_WEIGHT_MAX);
        factor = terrain * (1 - w) + common.factor * w;
        detail = { terrain, common: common.factor, sharedAthletes: common.n, weight: w };
      } else {
        factor = terrain;
        detail = { terrain, common: null, sharedAthletes: 0, weight: 0 };
      }
      factor = clamp(factor, COURSE_CLAMP[0], COURSE_CLAMP[1]);
      M.courseFactor[ck] = factor;
      M.meta.courseDetail[ck] = { ...detail, factor };
    });

    // --- Pass 3: weather factor per race.
    for (const key in races) {
      const meetSlug = races[key][0].meet_slug;
      M.weatherFactor[key] = weatherFactor(meetsMap[meetSlug]);
    }

    // --- Pass 4: score every result.
    for (const key in races) {
      const field = races[key];
      const gender = field[0].gender;
      const wxFactor = M.weatherFactor[key] || 1.00;

      // Sort by 5K-equiv pace for isolation measurement.
      const withPace = field.map(r => ({
        r,
        pace: riegel5KPace(r.time_in_seconds, distOf(r))
      })).sort((a, b) => a.pace - b.pace);

      const paces = withPace.map(x => x.pace);
      const consec = [];
      for (let i = 1; i < paces.length; i++) consec.push(paces[i] - paces[i - 1]);
      const typicalGap = median(consec);

      withPace.forEach((entry, idx) => {
        const r = entry.r;
        const ck = courseKeyOf(r);
        const courseF = M.courseFactor[ck] || 1.00;
        const fieldF = fieldFactorFor(idx, paces, typicalGap);

        const boost = clamp(courseF * fieldF * wxFactor, BOOST_CLAMP[0], BOOST_CLAMP[1]);
        const adjustedPace = entry.pace / boost;
        const points = paceToPoints(gender, adjustedPace);

        const aKey = athleteKey(r);
        const perf = {
          raceKey: key,
          meet_slug: r.meet_slug,
          date: r.date,
          distance: distOf(r),
          rawPace5K: entry.pace,
          courseFactor: courseF,
          fieldFactor: fieldF,
          weatherFactor: wxFactor,
          boost,
          points
        };
        (M.perfByAthlete[aKey] || (M.perfByAthlete[aKey] = [])).push(perf);

        // An athlete's overall rating is their best (highest) points.
        if (M.ratings[aKey] == null || points > M.ratings[aKey]) {
          M.ratings[aKey] = points;
        }
      });
    }

    return M;
  }

  // --- Public read API ------------------------------------------

  // Current overall rating for an athlete (their best performance).
  function currentRating(gender, name) {
    const key = `${gender}|${norm(name)}`;
    const points = M.ratings[key];
    if (points == null) return null;
    return {
      points,
      equiv5Ksec: pointsToEquiv5Ksec(gender, points)
    };
  }

  // Rating for one specific performance (found by meet slug + distance).
  function ratingForResult(r) {
    const list = M.perfByAthlete[athleteKey(r)];
    if (!list) return null;
    const key = raceKey(r);
    const perf = list.find(p => p.raceKey === key) || null;
    if (!perf) return null;
    return {
      points: perf.points,
      equiv5Ksec: pointsToEquiv5Ksec(r.gender, perf.points),
      courseFactor: perf.courseFactor,
      fieldFactor: perf.fieldFactor,
      weatherFactor: perf.weatherFactor,
      boost: perf.boost
    };
  }

  // Format equivalent seconds into m:ss.s (lower = faster).
  function fmtTime(totalSeconds) {
    if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds <= 0) return "";
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds - mins * 60;
    const secStr = secs.toFixed(1);
    return `${mins}:${(secs < 10 ? "0" : "") + secStr}`;
  }

  window.MSMRating = {
    buildModel,
    currentRating,
    ratingForResult,
    fmtTime,
    pointsToEquiv5Ksec,
    get model() { return M; }
  };
})();
