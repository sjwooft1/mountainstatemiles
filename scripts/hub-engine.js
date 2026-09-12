// ============================================================
//  hub-engine.js  —  MSM Hub Analytics Engine
// ============================================================
//  One shared model powering the WV Running News Central hub
//  (CrossCountry/xc.html) and the home page (index.html).
//
//  Built on the shared MSMRating engine (/scripts/msm-rating.js)
//  so every number here is on the same scale as rankings.html,
//  athlete profiles, and the coach portal:
//    • Riegel 5K-equivalent normalization
//    • course difficulty (terrain + common-athlete calibration)
//    • field isolation
//    • race-day weather from meet records
//
//  Framework-free, read-only. Exposes window.MSMHub.
// ============================================================

(function () {
  "use strict";

  const norm = (s) => (s || "").toString().trim().toLowerCase();

  /* ---------------- classification map ---------------- */

  const WV_CLASSIFICATION = {
    // ---- Class AAAA ----
    'Wheeling Park': 'AAAA', 'Morgantown': 'AAAA', 'University': 'AAAA', 'Hedgesville': 'AAAA',
    'Martinsburg': 'AAAA', 'Spring Mills': 'AAAA', 'Jefferson': 'AAAA', 'Musselman': 'AAAA',
    'Washington': 'AAAA', 'George Washington': 'AAAA', 'Woodrow Wilson': 'AAAA', 'Cabell Midland': 'AAAA',
    'Huntington': 'AAAA', 'Hurricane': 'AAAA', 'Parkersburg': 'AAAA', 'Parkersburg South': 'AAAA',
    'Oak Hill': 'AAAA', 'Buckhannon-Upshur': 'AAAA', 'Preston': 'AAAA', 'Riverside': 'AAAA',
    // ---- Class AAA ----
    'Lewis County': 'AAA', 'Shady Spring': 'AAA', 'Greenbrier East': 'AAA', 'Princeton': 'AAA',
    'Herbert Hoover': 'AAA', 'Ripley': 'AAA', 'Nitro': 'AAA', 'North Marion': 'AAA',
    'John Marshall': 'AAA', 'Brooke': 'AAA', 'East Fairmont': 'AAA', 'Fairmont Senior': 'AAA',
    'Grafton': 'AAA', 'Elkins': 'AAA', 'Hampshire': 'AAA', 'Keyser': 'AAA',
    'Robert C. Byrd': 'AAA', 'Bridgeport': 'AAA', 'Point Pleasant': 'AAA', 'Winfield': 'AAA',
    'Lincoln County': 'AAA', 'Capital': 'AAA', 'St. Albans': 'AAA', 'South Charleston': 'AAA',
    'Spring Valley': 'AAA', 'Nicholas County': 'AAA', 'PikeView': 'AAA', 'Chapmanville Regional': 'AAA',
    // ---- Class AA ----
    'Oak Glen': 'AA', 'Williamstown': 'AA', 'Ravenswood': 'AA', 'Moorefield': 'AA',
    'Philip Barbour': 'AA', 'Braxton County': 'AA', 'South Harrison': 'AA', 'Doddridge County': 'AA',
    // ---- Class A (remaining smaller schools) ----
    'Charleston Catholic': 'A', 'Wheeling Central': 'A', 'Magnolia': 'A', 'St. Marys': 'A',
    'Wirt County': 'A', 'Calhoun County': 'A', 'Clay-Battelle': 'A', 'Clay Battelle': 'A',
    'Tyler Consolidated': 'A', 'Cameron': 'A', 'Paden City': 'A', 'Valley Wetzel': 'A',
    'Gilmer County': 'A', 'Calhoun': 'A'
  };

  function normalizeSchoolName(schoolName) {
    if (!schoolName) return 'Unknown';
    let n = norm(schoolName).replace(/\s+(high\s+)?school\s*$/i, '').replace(/\s+hs\s*$/i, '').trim();
    return n.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  let WV_CLASS_LOOKUP = null;
  function classificationOfName(schoolName) {
    if (!WV_CLASS_LOOKUP) {
      WV_CLASS_LOOKUP = {};
      Object.keys(WV_CLASSIFICATION).forEach(k => {
        WV_CLASS_LOOKUP[norm(k)] = WV_CLASSIFICATION[k];
      });
    }
    if (!schoolName) return null;
    return WV_CLASS_LOOKUP[norm(schoolName)] || null;
  }

  /* ---------------- state ---------------- */

  const state = {
    loaded: false,
    loading: null,
    meets: {},        // slug -> meet record (with .key)
    schools: {},      // slug -> school record
    courses: {},      // slug -> course record
    news: [],         // [{ id, title, date, category, content }]
    featuredStory: null, // editorial Story of the Week record
    storyStats: {},   // live values used by authored story tokens
    results: [],      // normalized results with .msm rating
    mostImproved: { M: [], F: [] },
    watch: { M: [], F: [] },
    divisional: {},   // 'AAAA'|'AAA'|'AA'|'A'|'UNA' -> { top:[], teams:[] }
    upcoming: [],
    recaps: [],
    weatherApplied: 0,
    weatherTotal: 0
  };

  const secOf = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (s.includes(':')) {
      const parts = s.split(':').map(Number);
      if (parts.some(isNaN)) return null;
      let sec = 0;
      for (const p of parts) sec = sec * 60 + p;
      return sec;
    }
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  function waitForFirebase() {
    if (window.firebaseDatabase) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let i = 0;
      (function poll() {
        if (window.firebaseDatabase) return resolve();
        if (i++ > 80) return reject(new Error("Firebase not ready"));
        setTimeout(poll, 100);
      })();
    });
  }

  function waitForMSMRating() {
    if (window.MSMRating) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let i = 0;
      (function poll() {
        if (window.MSMRating) return resolve();
        if (i++ > 80) return reject(new Error("MSMRating not ready"));
        setTimeout(poll, 100);
      })();
    });
  }

  // In-season window (mirrors rankings.html): Aug 22 – Nov 1.
  function isNonCompetitive(meetSlug) {
    const meet = state.meets[meetSlug];
    if (!meet || !meet.date) return true; // undated results are never in-season
    const m = Number(String(meet.date).slice(5, 7));
    const d = Number(String(meet.date).slice(8, 10));
    if (!m || !d) return true;
    if (m < 8 || (m === 8 && d < 22)) return true;
    if (m > 11 || (m === 11 && d > 1)) return true;
    return false;
  }

  function seasonOf(r) {
    return r.date ? new Date(r.date).getFullYear() : null;
  }

  // In-progress season (the calendar year of "today").
  function currentSeason() {
    return new Date().getFullYear();
  }

  // Latest COMPLETED season, for year-over-year comparisons.
  function latestSeason() {
    return currentSeason() - 1;
  }

  /* ---------------- model build ---------------- */

  async function load() {
    if (state.loaded) return state;
    if (state.loading) return state.loading;
    state.loading = (async () => {
      await waitForFirebase();
      await waitForMSMRating();
      const db = window.firebaseDatabase;

      const [meetsSnap, schoolsSnap, coursesSnap, newsSnap, featuredStorySnap, resultsSnap] = await Promise.all([
        db.ref("crosscountry/meets").once("value"),
        db.ref("crosscountry/schools").once("value"),
        db.ref("crosscountry/courses").once("value"),
        db.ref("news").once("value").catch(() => null),
        db.ref("featuredStory").once("value").catch(() => null),
        db.ref("crosscountry/results").once("value")
      ]);

      meetsSnap.forEach(c => { const m = { key: c.key, ...c.val() }; if (m.slug) state.meets[m.slug] = m; });
      schoolsSnap.forEach(c => { const s = { key: c.key, ...c.val() }; if (s.slug) state.schools[s.slug] = s; });
      coursesSnap.forEach(c => { const o = { key: c.key, ...c.val() }; if (o.slug) state.courses[o.slug] = o; });
      if (newsSnap && newsSnap.exists()) {
        newsSnap.forEach(c => { const n = { id: c.key, ...c.val() }; if (n && n.title) state.news.push(n); });
        state.news.sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")));
      }
      if (featuredStorySnap && featuredStorySnap.exists()) {
        state.featuredStory = featuredStorySnap.val() || null;
      }

      const raw = [];
      resultsSnap.forEach(c => {
        const r = c.val() || {};
        if (!r.athlete_name) return;
        const meet = state.meets[r.meet_slug] || {};
        raw.push({
          key: c.key,
          athlete_name: r.athlete_name,
          gender: (r.gender || "").toUpperCase() === "F" ? "F" : (r.gender || "").toUpperCase() === "M" ? "M" : "",
          school_slug: r.school_slug || "",
          school_name: (state.schools[r.school_slug] || {}).name || "",
          meet_slug: r.meet_slug || "",
          meet_name: meet.name || r.meet_slug || "",
          course_slug: r.course_slug || meet.course_slug || "",
          distance: r.distance || 5000,
          timeSec: secOf(r.time),
          time_in_seconds: secOf(r.time),  // field name the MSMRating engine expects
          place: r.place != null ? parseInt(r.place, 10) : null,
          race_type: r.race_type || "",
          grad_year: r.grad_year || null,
          date: meet.date || r.created_at || "",
          state: (r.state || meet.state || "WV").toString().toUpperCase()
        });
      });

      // Build the shared rating model ONCE (all-time scope, matching the
      // athlete profile pages) and rate every result.
      await window.MSMRating.buildModel(raw, { meetsMap: state.meets, coursesMap: state.courses });
      raw.forEach(r => {
        const res = window.MSMRating.ratingForResult(r);
        r.msm = res ? res.points : null;
      });
      state.results = raw;

      analyze();
      state.loaded = true;
      return state;
    })();
    return state.loading;
  }

  /* ---------------- derived analytics ---------------- */

  function schoolNameOf(slug) {
    return (state.schools[slug] || {}).name || slug || "Unknown";
  }

  // Resolve an expected-teams entry (slug OR freeform name) to a school slug.
  // Expected lists mix "university", "University", "University High School",
  // and "{ slug, name }" objects, so match on slug, exact name, and a
  // suffix-stripped title-case name.
  function resolveSchoolSlug(slug, name) {
    if (slug && state.schools[slug]) return slug;
    if (!name) return slug || null;
    if (state.schools[norm(name)]) return norm(name);
    const n = normalizeSchoolName(name);
    if (!resolveSchoolSlug._byName) {
      resolveSchoolSlug._byName = {};
      for (const s in state.schools) resolveSchoolSlug._byName[norm(normalizeSchoolName(state.schools[s].name))] = s;
    }
    return resolveSchoolSlug._byName[norm(n)] || slug || null;
  }

  function classify(slug) {
    const name = schoolNameOf(slug);
    return classificationOfName(name) || "UNA"; // UNA / unmapped
  }

  // Compare this season's median rating vs last season's, per athlete.
  // Needs >= 2 rated in-season races in the current season.
  function computeMostImproved(currentSeason, gender) {
    const cur = {};
    const prev = {};
    state.results.forEach(r => {
      // In-season races only, so fun runs don't distort improvement deltas.
      if (!r.msm || r.gender !== gender || isNonCompetitive(r.meet_slug)) return;
      const y = seasonOf(r);
      const key = norm(r.athlete_name);
      if (y === currentSeason) (cur[key] || (cur[key] = [])).push(r.msm);
      else if (y === currentSeason - 1) (prev[key] || (prev[key] = [])).push(r.msm);
    });
    const med = (a) => {
      if (!a || !a.length) return null;
      const s = a.slice().sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const out = [];
    for (const key in cur) {
      const cm = med(cur[key]);
      const pm = med(prev[key]);
      if (cm == null || pm == null) continue;
      // Require at least two rated races in EACH season: this is what keeps
      // one-off outliers (a single slow tune-up, then a breakthrough) from
      // dominating the board with bogus 800-point "jumps".
      if (cur[key].length < 2 || prev[key].length < 2) continue;
      // Primary school = the school they raced for most this season.
      const schoolCounts = {};
      state.results.forEach(r => {
        if (norm(r.athlete_name) === key && r.school_slug) schoolCounts[r.school_slug] = (schoolCounts[r.school_slug] || 0) + 1;
      });
      const school_slug = Object.keys(schoolCounts).sort((a, b) => schoolCounts[b] - schoolCounts[a])[0] || "";
      out.push({
        name: state.results.find(r => norm(r.athlete_name) === key).athlete_name,
        gender,
        school_slug,
        school: schoolNameOf(school_slug),
        curRating: Math.round(cm),
        prevRating: Math.round(pm),
        delta: Math.round(cm - pm),
        racesCur: cur[key].length,
        racesPrev: prev[key].length
      });
    }
    out.sort((a, b) => b.delta - a.delta);
    return out;
  }

  function computeWatchList(currentSeason, gender) {
    const byName = {};
    state.results.forEach(r => {
      if (r.gender !== gender || r.msm == null || !r.date) return;
      if (seasonOf(r) !== currentSeason) return;
      const key = norm(r.athlete_name);
      const entry = byName[key] || (byName[key] = {
        name: r.athlete_name, gender,
        school_slug: r.school_slug, best: null, bestRaw: null,
        races: 0, meets: {}, lastDate: ""
      });
      entry.races++;
      if (r.meet_slug) entry.meets[r.meet_slug] = true;
      if (entry.best == null || r.msm > entry.best) { entry.best = r.msm; entry.bestRaw = r; }
      if (r.date > entry.lastDate) entry.lastDate = r.date;
    });
    const list = Object.values(byName);
    list.forEach(e => {
      e.school = schoolNameOf(e.school_slug);
      e.classification = classify(e.school_slug);
      e.bestTime = e.bestRaw ? e.bestRaw.timeSec : null;
      e.bestMeet = e.bestRaw ? e.bestRaw.meet_name : "";
      e.bestDate = e.bestRaw ? e.bestRaw.date : "";
    });
    // "Hot" = current-season best MSM rating, in-season races only.
    // Unattached runners and unmapped schools are excluded: this is a
    // school-season watch list, and they have no title to chase.
    return list
      .filter(e => e.best != null && !isNonCompetitive(e.bestRaw.meet_slug))
      .filter(e => e.school_slug && e.school_slug !== "unattached" && e.classification)
      .sort((a, b) => b.best - a.best);
  }

  function computeDivisional(currentSeason) {
    const out = {};
    ["AAAA", "AAA", "AA", "A"].forEach(cls => {
      const watch = [];
      for (const g of ["M", "F"]) {
        state.watch[g].forEach(e => {
          if (e.classification === cls) watch.push({ ...e, gender: g });
        });
      }
      watch.sort((a, b) => b.best - a.best);
      // Team power = sum of top-5 athlete best ratings, per gender.
      const teams = {};
      for (const g of ["M", "F"]) {
        state.watch[g].forEach(e => {
          if (e.classification !== cls) return;
          const k = e.school_slug + "|" + g;
          (teams[k] || (teams[k] = { school_slug: e.school_slug, gender: g, top: [] })).top.push(e.best);
        });
      }
      const teamRows = Object.values(teams).map(t => ({
        school_slug: t.school_slug, gender: t.gender,
        school: schoolNameOf(t.school_slug),
        power: t.top.slice(0, 5).reduce((s, v) => s + v, 0),
        runners: t.top.length
      })).filter(t => t.runners >= 3).sort((a, b) => b.power - a.power);
      out[cls] = { watch: watch.slice(0, 12), teams: teamRows.slice(0, 8) };
    });
    return out;
  }

  function computeUpcoming(currentSeason) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = [];
    const recaps = [];

    for (const slug in state.meets) {
      const m = state.meets[slug];
      if (!m.date) continue;
      const d = new Date(String(m.date).slice(0, 10) + "T12:00:00");
      if (isNaN(d)) continue;
      const dayDiff = Math.round((d - today) / 86400000);
      const expected = Array.isArray(m.expected_teams) ? m.expected_teams : [];

      if (dayDiff >= 0 && m.state !== "OUT" && dayDiff <= 90) {
        // Expected-field strength: resolve each expected entry to a school
        // record (they arrive as slugs, names, or "X High School" strings),
        // then take that school's best current-season rating.
        const teamStrengths = expected.map(t => {
          const rawName = typeof t === "string" ? t : (t.name || t.slug || "");
          const rawSlug = typeof t === "object" && t.slug ? t.slug : null;
          const sSlug = resolveSchoolSlug(rawSlug, rawName);
          const name = sSlug ? schoolNameOf(sSlug) : rawName;
          let strength = null, topName = null, topRating = null;
          if (sSlug) {
            for (const g of ["M", "F"]) {
              state.watch[g].forEach(e => {
                if (e.school_slug !== sSlug) return;
                if (strength == null || e.best > strength) { strength = e.best; topName = e.name; topRating = e.best; }
              });
            }
          }
          return { slug: sSlug, name, strength, topName, topRating };
        }).filter(t => t.slug || t.name);

        const withStrength = teamStrengths.filter(t => t.strength != null);
        const richness = withStrength.length;
        const topTeam = withStrength.slice().sort((a, b) => b.strength - a.strength)[0] || null;
        const hype = Math.min(10, Math.round(richness * 0.6 + (topTeam ? topTeam.strength / 150 : 0)));

        upcoming.push({
          slug, name: m.name || slug, date: m.date, dayDiff,
          location: m.location || "", course_slug: m.course_slug || "",
          isChampionship: !!m.is_state_championship,
          expectedCount: expected.length,
          richness, topTeam, hype,
          teamStrengths: withStrength.slice().sort((a, b) => b.strength - a.strength)
        });
      }

      // Recaps: meets from the trailing 21 days that already have results.
      if (dayDiff < 0 && dayDiff >= -21) {
        const hasResults = state.results.some(r => r.meet_slug === slug);
        if (hasResults) {
          const gendered = {};
          ["M", "F"].forEach(g => {
            const rows = state.results.filter(r => r.meet_slug === slug && r.gender === g && r.msm != null);
            rows.sort((a, b) => b.msm - a.msm);
            if (rows.length) gendered[g] = rows.slice(0, 3).map(r => ({
              name: r.athlete_name, school: schoolNameOf(r.school_slug),
              school_slug: r.school_slug, timeSec: r.timeSec, msm: r.msm, place: r.place
            }));
          });
          recaps.push({ slug, name: m.name || slug, date: m.date, dayDiff, gendered });
        }
      }
    }

    upcoming.sort((a, b) => a.dayDiff - b.dayDiff || (b.hype || 0) - (a.hype || 0));
    recaps.sort((a, b) => b.dayDiff - a.dayDiff); // most recent first
    state.upcoming = upcoming;
    state.recaps = recaps;
    return { upcoming, recaps };
  }

  // Count of rated results that got a weather boost (>1.0 factor).
  function computeWeatherCoverage() {
    const model = window.MSMRating.model || {};
    const wx = model.weatherFactor || {};
    let applied = 0, total = 0;
    for (const k in wx) { total++; if (wx[k] > 1.0) applied++; }
    state.weatherApplied = applied;
    state.weatherTotal = total;
  }

  function buildStoryStats() {
    const improved = [...state.mostImproved.M, ...state.mostImproved.F]
      .filter(e => e && e.delta != null).sort((a, b) => b.delta - a.delta)[0] || null;
    const boys = state.watch.M[0] || null;
    const girls = state.watch.F[0] || null;
    const next = state.upcoming[0] || null;
    const rated = state.results.filter(r => r.msm != null).length;
    const schools = new Set(state.results.filter(r => r.school_slug && seasonOf(r) === currentSeason()).map(r => r.school_slug));
    state.storyStats = {
      most_improved_name: improved ? improved.name : "The next breakthrough star",
      most_improved_school: improved ? improved.school : "West Virginia",
      most_improved_delta: improved ? `+${improved.delta}` : "—",
      most_improved_rating: improved ? String(improved.curRating) : "—",
      most_improved_previous: improved ? String(improved.prevRating) : "—",
      most_improved_gender: improved && improved.gender === "F" ? "girls" : "boys",
      top_boys_name: boys ? boys.name : "—",
      top_boys_school: boys ? boys.school : "—",
      top_boys_rating: boys ? String(boys.best) : "—",
      top_girls_name: girls ? girls.name : "—",
      top_girls_school: girls ? girls.school : "—",
      top_girls_rating: girls ? String(girls.best) : "—",
      next_meet: next ? next.name : "the next meet",
      next_meet_date: next ? String(next.date).slice(0, 10) : "date TBD",
      next_meet_location: next ? (next.location || "West Virginia") : "West Virginia",
      upcoming_meets: String(state.upcoming.length),
      rated_performances: rated.toLocaleString(),
      schools_competing: String(schools.size),
      current_season: String(currentSeason())
    };
  }

  function analyze() {
    // Improvement compares THIS season's median vs last season's, so the
    // comparator gets the in-progress year (it derives "prev" as year - 1).
    const thisYear = currentSeason();
    state.mostImproved.M = computeMostImproved(thisYear, "M");
    state.mostImproved.F = computeMostImproved(thisYear, "F");
    state.watch.M = computeWatchList(thisYear, "M");
    state.watch.F = computeWatchList(thisYear, "F");
    state.divisional = computeDivisional(thisYear);
    computeUpcoming();
    computeWeatherCoverage();
    buildStoryStats();
  }

  function resolveStoryTokens(text) {
    return String(text || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (full, key) => {
      return Object.prototype.hasOwnProperty.call(state.storyStats, key) ? state.storyStats[key] : full;
    });
  }

  // =====================================================================
  //  MEET SIMULATION LAB
  // =====================================================================
  // A simulation must represent current form, not an athlete's lifetime PR.
  // The default basis therefore blends the last three selected meet results
  // (50/30/20% by recency), after removing source-course/field/weather effects
  // and applying the target course. "best" remains available as a clearly
  // labeled what-if diagnostic, never as the public default.
  function simulationMeetOptions(gender) {
    const counts = {};
    state.results.forEach(r => {
      if ((!gender || r.gender === gender) && r.timeSec != null && r.school_slug && r.school_slug !== "unattached") {
        counts[r.meet_slug] = (counts[r.meet_slug] || 0) + 1;
      }
    });
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Object.values(state.meets)
      .filter(m => m.date)
      .map(m => {
        const d = new Date(String(m.date).slice(0, 10) + "T12:00:00");
        const expected = m.teams || m.expected_teams || [];
        const expectedCount = Array.isArray(expected) ? expected.length : Object.keys(expected || {}).length;
        return {
          slug: m.slug, name: m.name || m.slug, date: m.date,
          location: m.location || "", course_slug: m.course_slug || "",
          resultCount: counts[m.slug] || 0, expectedCount,
          upcoming: !isNaN(d) && d >= now
        };
      })
      .filter(m => m.resultCount || m.expectedCount)
      .sort((a, b) => {
        if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
        return a.upcoming ? String(a.date).localeCompare(String(b.date)) : String(b.date).localeCompare(String(a.date));
      });
  }

  function simulationExpectedTeams(meetSlug, gender) {
    const m = state.meets[meetSlug];
    if (!m) return [];
    let list = m.teams || m.expected_teams || [];
    if (!Array.isArray(list)) list = Object.values(list || {});
    const out = [];
    list.forEach(t => {
      if (t == null || t === "") return;
      const raw = typeof t === "string" ? t : (t.slug || t.name || t.school || "");
      const name = typeof t === "string" ? t : (t.name || t.school || raw);
      const slug = resolveSchoolSlug(typeof t === "object" ? t.slug : raw, name);
      if (slug && slug !== "unattached" && !out.some(x => x.slug === slug)) {
        out.push({ slug, name: schoolNameOf(slug) });
      }
    });
    // A meet's expected list can be stale. Keep schools that actually posted
    // results there so the simulation remains faithful to the finish line.
    state.results.forEach(r => {
      if (r.meet_slug !== meetSlug || (gender && r.gender !== gender) || !r.school_slug || r.school_slug === "unattached") return;
      if (!out.some(x => x.slug === r.school_slug)) out.push({ slug: r.school_slug, name: schoolNameOf(r.school_slug) });
    });
    return out;
  }

  function simulationCourseFactor(courseSlug) {
    return (courseSlug && window.MSMRating && window.MSMRating.model.courseFactor[courseSlug]) || 1;
  }

  function projectSimulationResult(r, targetCourseSlug, targetDistance) {
    if (!r || r.timeSec == null || !window.MSMRating) return null;
    const rating = window.MSMRating.ratingForResult(r);
    const dist = Number(r.distance) > 0 ? Number(r.distance) : 5000;
    const raw5k = r.timeSec * Math.pow(5000 / dist, 1.06);
    // Rating factors are per-performance. Removing them prevents one easy
    // course, weak field, or favorable weather day from becoming a fake PR.
    const boost = rating && rating.boost > 0 ? rating.boost : 1;
    const neutral5k = raw5k / boost;
    const target5k = neutral5k * simulationCourseFactor(targetCourseSlug);
    return target5k * Math.pow(Number(targetDistance || 5000) / 5000, 1.06);
  }

  function simulateNewsMeet(opts) {
    opts = opts || {};
    const gender = opts.gender === "F" ? "F" : "M";
    const targetSlug = opts.targetMeetSlug;
    const target = state.meets[targetSlug];
    if (!target) return { error: "Choose a target meet." };
    const sourceSlugs = Array.isArray(opts.sourceMeetSlugs) ? opts.sourceMeetSlugs.filter(Boolean) : [];
    const basis = ["recent", "median", "best"].includes(opts.basis) ? opts.basis : "recent";
    const targetCourse = target.course_slug || targetSlug;
    let targetDistance = Number(target.distance) || 0;
    if (!targetDistance && state.courses[targetCourse]) targetDistance = Number(state.courses[targetCourse].distance) || 0;
    if (!targetDistance) {
      const targetRows = state.results.filter(r => r.meet_slug === targetSlug && r.gender === gender && r.distance > 0);
      targetDistance = targetRows.length ? Number(targetRows[0].distance) : 5000;
    }

    const allowed = sourceSlugs.length ? new Set(sourceSlugs) : null;
    const currentYear = currentSeason();
    const rows = state.results.filter(r => {
      if (r.gender !== gender || r.timeSec == null || !r.school_slug || r.school_slug === "unattached") return false;
      if (allowed) return allowed.has(r.meet_slug);
      return seasonOf(r) === currentYear && !isNonCompetitive(r.meet_slug);
    });

    // Keep school identity in the key: transfers must not teleport an effort
    // from one roster into another team's projected lineup.
    const byAthlete = {};
    rows.forEach(r => {
      const key = `${r.school_slug}|${norm(r.athlete_name)}`;
      (byAthlete[key] || (byAthlete[key] = [])).push(r);
    });
    const form = {};
    Object.keys(byAthlete).forEach(key => {
      const races = byAthlete[key].filter(r => projectSimulationResult(r, targetCourse, targetDistance) != null)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      if (!races.length) return;
      const projected = races.map(r => ({ r, timeSec: projectSimulationResult(r, targetCourse, targetDistance) }));
      let chosen;
      if (basis === "best") chosen = [projected.slice().sort((a, b) => a.timeSec - b.timeSec)[0]];
      else if (basis === "median") {
        const times = projected.map(x => x.timeSec).sort((a, b) => a - b);
        const med = times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2;
        chosen = [{ r: projected[0].r, timeSec: med }];
      } else chosen = projected.slice(0, 3);
      const weights = chosen.map((_, i) => basis === "recent" ? [0.5, 0.3, 0.2][i] || 0.1 : 1 / chosen.length);
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      const timeSec = chosen.reduce((s, x, i) => s + x.timeSec * weights[i], 0) / totalWeight;
      const latest = races[0];
      form[key] = {
        name: latest.athlete_name, schoolSlug: latest.school_slug, gender,
        timeSec, sourceCount: chosen.length, lastMeet: latest.meet_name,
        lastDate: latest.date, bestSource: chosen.slice().sort((a, b) => a.timeSec - b.timeSec)[0].r
      };
    });

    const teams = simulationExpectedTeams(targetSlug, gender).map(t => {
      const entrants = Object.values(form).filter(e => e.schoolSlug === t.slug).sort((a, b) => a.timeSec - b.timeSec).slice(0, 7);
      return { schoolSlug: t.slug, school: t.name, entrants, depth: entrants.length };
    }).filter(t => t.entrants.length);
    let field = teams.flatMap(t => t.entrants.map(e => ({ ...e, schoolSlug: t.schoolSlug, school: t.school })));
    field.sort((a, b) => a.timeSec - b.timeSec);
    field.forEach((e, i) => { e.place = i + 1; });

    const bySchool = {};
    field.forEach(e => (bySchool[e.schoolSlug] || (bySchool[e.schoolSlug] = [])).push(e));
    const teamRows = Object.values(bySchool).map(t => {
      t.sort((a, b) => a.place - b.place);
      const top5 = t.slice(0, 5);
      const complete = top5.length === 5;
      return {
        schoolSlug: t[0].schoolSlug, school: t[0].school, top5, top7: t,
        depth: t.length, complete, score: complete ? top5.reduce((s, e) => s + e.place, 0) : null,
        teamAvg: complete ? top5.reduce((s, e) => s + e.timeSec, 0) / 5 : null,
        spread15: complete ? top5[4].timeSec - top5[0].timeSec : null
      };
    }).sort((a, b) => (a.score == null ? 9999 : a.score) - (b.score == null ? 9999 : b.score) || (a.teamAvg || 999999) - (b.teamAvg || 999999));
    return {
      targetMeetSlug, targetMeetName: target.name || targetSlug,
      gender, targetCourse, targetDistance, basis, sourceMeetSlugs: sourceSlugs,
      sourceResultCount: rows.length, field, teams: teamRows,
      completeTeams: teamRows.filter(t => t.complete).length,
      expectedTeams: simulationExpectedTeams(targetSlug, gender)
    };
  }

  /* ---------------- read API ---------------- */

  window.MSMHub = {
    load,
    get state() { return state; },
    schoolNameOf,
    classify,
    isNonCompetitive,
    seasonOf,
    currentSeason,
    latestSeason,
    resolveStoryTokens,
    simulationMeetOptions,
    simulationExpectedTeams,
    simulateNewsMeet
  };
})();
