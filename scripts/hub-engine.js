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

      // Imported meet names often carry stray whitespace, which reads badly in
      // prose and row labels, so normalize it once here.
      meetsSnap.forEach(c => {
        const m = { key: c.key, ...c.val() };
        if (!m.slug) return;
        if (m.name) m.name = String(m.name).trim();
        state.meets[m.slug] = m;
      });
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

  // A missing school record must never surface a raw slug to readers:
  // "greenbrier-west" reads as "Greenbrier West".
  function prettySchoolSlug(slug) {
    return String(slug || "").split(/[-_]+/).filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  function schoolNameOf(slug) {
    const name = (state.schools[slug] || {}).name;
    if (name) return name;
    return prettySchoolSlug(slug) || "Unknown";
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
      // classify() falls back to the truthy string "UNA", so the old
      // `&& e.classification` check let out-of-state and unmapped schools
      // through with their slug as a display name.
      .filter(e => e.school_slug && e.school_slug !== "unattached" && e.classification && e.classification !== "UNA")
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

  // "2026-09-12" reads badly inside a story sentence, but raw ISO values are
  // what the meets store, so the token renders as "Sat, Sep 12".
  function formatShortDate(value) {
    const d = new Date(String(value || "").slice(0, 10) + "T12:00:00");
    if (isNaN(d)) return String(value || "date TBD");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function buildStoryStats() {
    const improved = [...state.mostImproved.M, ...state.mostImproved.F]
      .filter(e => e && e.delta != null).sort((a, b) => b.delta - a.delta)[0] || null;
    const boys = state.watch.M[0] || null;
    const girls = state.watch.F[0] || null;
    const next = state.upcoming[0] || null;
    // Scoped to West Virginia meets so the headline figures match the WV-only
    // watch lists, divisionals, and state-of-the-state cards.
    const rated = state.results.filter(r => r.msm != null && r.state === "WV").length;
    const schools = new Set(state.results.filter(r => r.msm != null && r.school_slug && r.state === "WV" && seasonOf(r) === currentSeason()).map(r => r.school_slug));
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
      next_meet_date: next ? formatShortDate(next.date) : "date TBD",
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
    buildTeamIndex();
    buildMeetIndex();
    buildStoryStats();
  }

  /* =====================================================================
     STAT LIBRARY — teams, meets, and projections as draggable stats
     =====================================================================
     The news desk drags a stat into a story and gets back a token such as
     {{team:morgantown:M.power}}. Tokens resolve to the live number here, so a
     published story keeps reporting current data instead of a stale snapshot. */

  function formatTime(sec) {
    const n = Number(sec);
    if (!isFinite(n) || n <= 0) return "—";
    const m = Math.floor(n / 60);
    return `${m}:${(n - m * 60).toFixed(1).padStart(4, "0")}`;
  }

  const num = (value) => (value == null ? "—" : Number(value).toLocaleString("en-US"));

  // Team power = sum of a school's five best current-season ratings, per gender
  // (the same rule the divisional tables use).
  function buildTeamIndex() {
    const index = {};
    ["M", "F"].forEach(gender => {
      state.watch[gender].forEach(e => {
        if (!e.school_slug) return;
        const team = index[e.school_slug] || (index[e.school_slug] = {
          slug: e.school_slug,
          name: e.school,
          classification: e.classification && e.classification !== "UNA" ? e.classification : "",
          M: { rated: 0, scorers: 0, power: 0, top: "", topRating: null },
          F: { rated: 0, scorers: 0, power: 0, top: "", topRating: null }
        });
        const side = team[gender];
        side.rated += 1;
        if (side.topRating == null || e.best > side.topRating) { side.topRating = e.best; side.top = e.name; }
        side.ratings = (side.ratings || []).concat(e.best);
      });
    });
    Object.values(index).forEach(team => {
      ["M", "F"].forEach(gender => {
        const side = team[gender];
        const top = (side.ratings || []).sort((a, b) => b - a).slice(0, 5);
        side.scorers = top.length;
        side.power = top.reduce((s, v) => s + v, 0);
        delete side.ratings;
      });
    });
    // Ranks let the auto-drafted prose read like a real preview
    // ("the No. 1 boys team power in the state", "No. 2 in Class AAA").
    ["M", "F"].forEach(gender => {
      const ranked = Object.values(index).filter(t => t[gender].scorers).sort((a, b) => b[gender].power - a[gender].power);
      const seenClass = {};
      ranked.forEach((team, i) => {
        team[gender].powerRank = i + 1;
        const cls = team.classification || "unclassified";
        seenClass[cls] = (seenClass[cls] || 0) + 1;
        team[gender].classRank = seenClass[cls];
      });
    });
    state.teamIndex = index;
  }

  // Meet summary: field size, result count, and the top-rated boy/girl.
  function buildMeetIndex() {
    const index = {};
    state.results.forEach(r => {
      if (!r.meet_slug) return;
      const meet = index[r.meet_slug] || (index[r.meet_slug] = { schools: {}, count: 0, M: null, F: null });
      if (r.school_slug) meet.schools[r.school_slug] = true;
      meet.count += 1;
      if (r.msm == null || (r.gender !== "M" && r.gender !== "F")) return;
      const side = meet[r.gender];
      if (!side || r.msm > side.msm) {
        meet[r.gender] = {
          name: r.athlete_name, school: schoolNameOf(r.school_slug), school_slug: r.school_slug,
          msm: r.msm, timeSec: r.timeSec
        };
      }
    });
    state.meetIndex = index;
  }

  function teamStat(slug, spec) {
    const team = state.teamIndex[slug];
    if (!team) return null;
    const [first, second] = String(spec || "").split(".");
    if (!second) {
      if (first === "name") return team.name;
      if (first === "class") return team.classification || "unclassified";
      if (first === "athletes") return String(team.M.rated + team.F.rated);
      return null;
    }
    const side = team[first === "F" ? "F" : "M"];
    switch (second) {
      case "power": return side.scorers ? num(side.power) : "—";
      case "top": return side.top || "—";
      case "top_rating": return side.topRating == null ? "—" : num(side.topRating);
      case "rated": return num(side.rated);
      case "power_rank": return side.powerRank ? `No. ${side.powerRank}` : "—";
      case "class_rank": return side.classRank ? `No. ${side.classRank}` : "—";
      default: return null;
    }
  }

  function meetStat(slug, spec) {
    const meet = state.meets[slug];
    if (!meet) return null;
    const summary = state.meetIndex[slug];
    const [first, second] = String(spec || "").split(".");
    if (!second) {
      if (first === "name") return meet.name || slug;
      if (first === "date") return formatShortDate(meet.date);
      if (first === "location") return meet.location || "—";
      if (first === "field") {
        if (summary) return num(Object.keys(summary.schools).length);
        return Array.isArray(meet.expected_teams) ? num(meet.expected_teams.length) : "—";
      }
      if (first === "results") return num(summary ? summary.count : 0);
      return null;
    }
    const winner = summary ? summary[first === "F" ? "F" : "M"] : null;
    switch (second) {
      case "winner": return winner ? winner.name : "—";
      case "winner_school": return winner ? winner.school : "—";
      case "winner_rating": return winner ? num(winner.msm) : "—";
      case "winner_time": return winner ? formatTime(winner.timeSec) : "—";
      default: return null;
    }
  }

  // Projections are the expensive stat, so each meet/division pair is computed
  // once and cached (including failures, so a hopeless meet is not retried).
  const projectionCache = {};

  // "Current form" for a projection: the most recent meets the target meet's
  // expected teams actually raced.
  function defaultSimulationSources(targetSlug, gender) {
    const expected = new Set(simulationExpectedTeams(targetSlug, gender).map(t => t.slug));
    const latest = {};
    state.results.forEach(r => {
      if (!r.meet_slug || r.timeSec == null) return;
      if (expected.size && !(r.school_slug && expected.has(r.school_slug))) return;
      if (!latest[r.meet_slug] || latest[r.meet_slug] < r.date) latest[r.meet_slug] = r.date;
    });
    return Object.keys(latest)
      .sort((a, b) => String(latest[b]).localeCompare(String(latest[a])))
      .slice(0, 3);
  }

  function simulationSnapshot(targetSlug, gender) {
    const g = gender === "F" ? "F" : "M";
    const key = `${targetSlug}|${g}`;
    if (!(key in projectionCache)) {
      let snapshot = null;
      try {
        const sim = simulateNewsMeet({
          targetMeetSlug: targetSlug, gender: g, basis: "recent",
          sourceMeetSlugs: defaultSimulationSources(targetSlug, g)
        });
        if (sim && !sim.error) {
          const ranked = sim.teams.filter(t => t.complete);
          const winner = ranked[0] || null;
          const runnerUp = ranked[1] || null;
          const top = sim.field[0] || null;
          snapshot = {
            meet: sim.targetMeetName, gender: g,
            winner: winner ? winner.school : "—",
            score: winner ? num(winner.score) : "—",
            runner_up: runnerUp ? runnerUp.school : "—",
            teams: num(sim.completeTeams),
            runners: num(sim.field.length),
            top: top ? top.name : "—",
            top_school: top ? top.school : "—",
            top_time: top ? formatTime(top.timeSec) : "—"
          };
        }
      } catch (err) {
        snapshot = null;
      }
      projectionCache[key] = snapshot;
    }
    return projectionCache[key];
  }

  function simStat(targetSlug, gender, metric) {
    const snapshot = simulationSnapshot(targetSlug, gender);
    if (!snapshot) return null;
    return Object.prototype.hasOwnProperty.call(snapshot, metric) ? snapshot[metric] : null;
  }

  function resolveLibraryToken(key) {
    const parts = String(key || "").split(":");
    if (parts.length < 3) return null;
    if (parts[0] === "team") return teamStat(parts[1], parts[2]);
    if (parts[0] === "meet") return meetStat(parts[1], parts[2]);
    if (parts[0] === "sim") {
      const [gender, metric] = String(parts[2] || "").split(".");
      return simStat(parts[1], gender, metric);
    }
    return null;
  }

  // Grouped source data for the news desk. Teams and meets are cheap; sims are
  // requested per meet through simulationStats() so nothing heavy loads up front.
  function statLibrary() {
    const teams = Object.values(state.teamIndex)
      .sort((a, b) => Math.max(b.M.power, b.F.power) - Math.max(a.M.power, a.F.power))
      .map(team => {
        const stats = [];
        ["M", "F"].forEach(gender => {
          const side = team[gender];
          if (!side.rated) return;
          const who = gender === "F" ? "Girls" : "Boys";
          if (side.scorers) stats.push({ label: `${who} team power`, token: `{{team:${team.slug}:${gender}.power}}`, value: num(side.power) });
          if (side.powerRank) stats.push({ label: `${who} state rank`, token: `{{team:${team.slug}:${gender}.power_rank}}`, value: `No. ${side.powerRank}` });
          if (side.classRank && team.classification) stats.push({ label: `${who} ${team.classification} rank`, token: `{{team:${team.slug}:${gender}.class_rank}}`, value: `No. ${side.classRank}` });
          stats.push({ label: `${who} top runner`, token: `{{team:${team.slug}:${gender}.top}}`, value: side.top || "—" });
          if (side.topRating != null) stats.push({ label: `${who} top rating`, token: `{{team:${team.slug}:${gender}.top_rating}}`, value: num(side.topRating) });
          stats.push({ label: `${who} rated athletes`, token: `{{team:${team.slug}:${gender}.rated}}`, value: num(side.rated) });
        });
        stats.push({ label: "Class", token: `{{team:${team.slug}:class}}`, value: team.classification || "unclassified" });
        return {
          id: team.slug, name: team.name, logo: team.slug,
          meta: team.classification ? `Class ${team.classification}` : "Unmapped",
          stats: stats.filter(stat => stat.value && stat.value !== "—")
        };
      })
      .filter(team => team.stats.length);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const meets = Object.values(state.meets)
      .filter(m => m.slug)
      .map(m => {
        const summary = state.meetIndex[m.slug];
        const d = m.date ? new Date(String(m.date).slice(0, 10) + "T12:00:00") : null;
        // Compare calendar days, not instants: a meet yesterday must read -1,
        // not 0, or it would count as upcoming in the projection list.
        const dayDiff = d && !isNaN(d)
          ? Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000)
          : null;
        const stats = [
          { label: "Name", token: `{{meet:${m.slug}:name}}`, value: m.name || m.slug },
          { label: "Date", token: `{{meet:${m.slug}:date}}`, value: formatShortDate(m.date) },
          { label: "Location", token: `{{meet:${m.slug}:location}}`, value: m.location || "—" },
          { label: "Field size", token: `{{meet:${m.slug}:field}}`, value: num(summary ? Object.keys(summary.schools).length : (Array.isArray(m.expected_teams) ? m.expected_teams.length : 0)) },
          { label: "Rated results", token: `{{meet:${m.slug}:results}}`, value: num(summary ? summary.count : 0) }
        ];
        ["M", "F"].forEach(gender => {
          const winner = summary ? summary[gender] : null;
          if (!winner) return;
          const who = gender === "F" ? "Girls" : "Boys";
          stats.push({ label: `${who} winner`, token: `{{meet:${m.slug}:${gender}.winner}}`, value: winner.name });
          stats.push({ label: `${who} winner's school`, token: `{{meet:${m.slug}:${gender}.winner_school}}`, value: winner.school });
          stats.push({ label: `${who} winner's rating`, token: `{{meet:${m.slug}:${gender}.winner_rating}}`, value: num(winner.msm) });
          stats.push({ label: `${who} winner's time`, token: `{{meet:${m.slug}:${gender}.winner_time}}`, value: formatTime(winner.timeSec) });
        });
        const when = dayDiff == null ? "Undated" : dayDiff > 0 ? "Upcoming" : dayDiff === 0 ? "Today" : `${Math.abs(dayDiff)} days ago`;
        return {
          id: m.slug, name: m.name || m.slug,
          meta: [formatShortDate(m.date), when, m.state === "OUT" ? "out of state" : ""].filter(Boolean).join(" · "),
          dayDiff: dayDiff == null ? 9999 : dayDiff,
          stats: stats.filter(stat => stat.value && stat.value !== "—")
        };
      })
      // Upcoming meets first (soonest first), then the most recent results.
      .sort((a, b) => {
        const rank = (m) => (m.dayDiff >= 0 ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return rank(a) === 0 ? a.dayDiff - b.dayDiff : b.dayDiff - a.dayDiff;
      });

    return { teams, meets };
  }

  /* ---------------- auto-drafted lead paragraphs ---------------- */
  // The news desk's "Draft this story for me" button. Every number that has a
  // token is written as one, so a drafted story keeps reporting live data.
  function teamDraft(slug) {
    const team = state.teamIndex[slug];
    if (!team) return "";
    const lines = [];
    ["M", "F"].forEach(gender => {
      const side = team[gender];
      if (!side || !side.rated) return;
      const who = gender === "F" ? "girls" : "boys";
      const token = `{{team:${slug}:${gender}.`;
      if (side.scorers) {
        const stateRank = side.powerRank ? `the No. ${side.powerRank}` : "the";
        const sameRank = side.powerRank && side.classRank === side.powerRank;
        const classRank = side.classRank && team.classification
          ? ` (${sameRank ? `also No. ${side.classRank} in` : `No. ${side.classRank} of`} Class ${team.classification})`
          : "";
        lines.push(`${team.name} ${who} carry ${stateRank} team power rating in West Virginia${classRank} at ${token}power}} — the sum of their five best MSM ratings — led by ${token}top}} at ${token}top_rating}}.`);
      } else {
        lines.push(`${team.name} has ${token}rated}} rated ${who} this season so far, paced by ${token}top}} at ${token}top_rating}}.`);
      }
    });
    return lines.join(" ");
  }

  function meetDraft(slug) {
    const meet = state.meets[slug];
    if (!meet) return "";
    const summary = state.meetIndex[slug];
    const token = `{{meet:${slug}:`;
    if (summary && (summary.M || summary.F)) {
      const parts = [`${token}name}} (${token}date}}) drew ${token}field}} teams and produced ${token}results}} rated MSM performances.`];
      if (summary.M) parts.push(`${summary.M.name} of ${summary.M.school} won the boys race in ${token}M.winner_time}} at ${token}M.winner_rating}} MSM.`);
      if (summary.F) parts.push(`${summary.F.name} of ${summary.F.school} took the girls race in ${token}F.winner_time}} at ${token}F.winner_rating}} MSM.`);
      return parts.join(" ");
    }
    if (meet.date) {
      return `${token}name}} is on the calendar for ${token}date}} at ${token}location}}, with ${token}field}} teams in the expected field.`;
    }
    return `${token}name}} is on the season calendar at ${token}location}}.`;
  }

  function simulationDraft(meetSlug) {
    if (!state.meets[meetSlug]) return "";
    const name = `{{meet:${meetSlug}:name}}`;
    const date = `{{meet:${meetSlug}:date}}`;
    const parts = [];
    ["M", "F"].forEach(gender => {
      const snapshot = simulationSnapshot(meetSlug, gender);
      if (!snapshot || snapshot.winner === "—" || snapshot.score === "—") return;
      const who = gender === "F" ? "girls" : "boys";
      const token = `{{sim:${meetSlug}:${gender}.`;
      const chase = snapshot.runner_up && snapshot.runner_up !== "—" ? `, ahead of ${token}runner_up}}` : "";
      parts.push(`Projecting current form onto ${name} (${date}): ${token}winner}} takes the ${who} title with a ${token}score}}-point total${chase}, and ${token}top}} projects as the individual winner in ${token}top_time}}.`);
    });
    if (!parts.length) return "";
    return parts.join(" ");
  }

  // group: "team" | "meet" | "sim", id: the row's id in the news desk library.
  function storyDraft(group, id) {
    if (group === "team") return teamDraft(id);
    if (group === "meet") return meetDraft(id);
    if (group === "sim") return simulationDraft(id);
    return "";
  }

  // One target meet, both divisions: the rows the news desk can drag from.
  function simulationStats(meetSlug) {
    const meet = state.meets[meetSlug];
    if (!meet) return null;
    const stats = [];
    ["M", "F"].forEach(gender => {
      const snapshot = simulationSnapshot(meetSlug, gender);
      if (!snapshot) return;
      const who = gender === "F" ? "Girls" : "Boys";
      // "—" means the division cannot be projected yet, so it is not offered.
      const add = (label, metric, value) => {
        if (value == null || value === "—" || value === "") return;
        stats.push({ label: `${who} ${label}`, token: `{{sim:${meetSlug}:${gender}.${metric}}}`, value: String(value) });
      };
      add("projected winner", "winner", snapshot.winner);
      add("winning score", "score", snapshot.score);
      add("projected runner-up", "runner_up", snapshot.runner_up);
      add("projected individual winner", "top", snapshot.top);
      add("individual winner's time", "top_time", snapshot.top_time);
      add("projected runners", "runners", snapshot.runners);
      add("scoring teams", "teams", snapshot.teams);
    });
    if (!stats.length) return null;
    return { id: meetSlug, name: meet.name || meetSlug, meta: formatShortDate(meet.date), stats };
  }

  // Tokens come in two flavours: the headline keys in storyStats
  // ({{next_meet}}) and library keys such as {{team:morgantown:M.power}}.
  // Unknown tokens are returned untouched so typos are visible in the copy.
  function resolveStoryTokens(text) {
    return String(text || "").replace(/\{\{\s*([a-z0-9_:.-]+)\s*\}\}/gi, (full, key) => {
      if (Object.prototype.hasOwnProperty.call(state.storyStats, key)) return state.storyStats[key];
      const value = resolveLibraryToken(key);
      return value == null ? full : String(value);
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
      targetMeetSlug: targetSlug, targetMeetName: target.name || targetSlug,
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
    simulateNewsMeet,
    statLibrary,
    simulationStats,
    storyDraft
  };
})();
