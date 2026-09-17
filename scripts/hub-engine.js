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

  // WVSSAC 2025-26 enrollment classes (the four-class realignment). This map is
  // the roster of WV schools the hub covers as well as their class, so a school
  // missing here loses its team power, its divisional podium and its class
  // badge everywhere at once. It used to list only 88 names -- 45 WV schools
  // with five-plus rated runners (Frankfort, Weir, Scott, Logan, Poca, Westside,
  // Ritchie County, Buffalo, River View, Petersburg, Berkeley Springs ...) were
  // silently absent, so half the state had no power rating while rankings.html
  // listed them. Keep it in step with the copy in rankings.html.
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
    'Bluefield': 'AA', 'Mingo Central': 'AA', 'Westside': 'AA', 'Wyoming East': 'AA',
    'Liberty (Raleigh)': 'AA', 'Frankfort': 'AA', 'Midland Trail': 'AA', 'James Monroe': 'AA',
    'Buffalo': 'AA', 'Poca': 'AA', 'Roane County': 'AA', 'Clay County': 'AA',
    'Scott': 'AA', 'Logan': 'AA', 'Lincoln': 'AA', 'Sissonville': 'AA',
    'Independence': 'AA', 'Wayne': 'AA', 'Berkeley Springs': 'AA', 'Tyler Consolidated': 'AA',
    'Summers County': 'AA', 'River View': 'AA', 'Petersburg': 'AA', 'Weir': 'AA',
    // ---- Class A ----
    'Cameron': 'A', 'Madonna': 'A', 'Clay-Battelle': 'A', 'Valley': 'A',
    'Magnolia': 'A', 'East Hardy': 'A', 'Tucker County': 'A', 'Pendleton County': 'A',
    'Pocahontas County': 'A', 'Tygarts Valley': 'A', 'Montcalm': 'A', 'Mount View': 'A',
    'Greenbrier West': 'A', 'Meadow Bridge': 'A', 'Richwood': 'A', 'Webster County': 'A',
    'Man': 'A', 'Sherman': 'A', 'Tolsia': 'A', 'Tug Valley': 'A',
    'Van': 'A', 'Calhoun County': 'A', 'Gilmer County': 'A', 'Wahama': 'A',
    'Wirt County': 'A', 'Ritchie County': 'A', 'St. Marys': 'A', 'Wheeling Central Catholic': 'A',
    'Trinity Christian': 'A', 'Hannan': 'A', 'Charleston Catholic': 'A', 'Notre Dame': 'A',
    'Parkersburg Catholic': 'A', 'Greater Beckley Christian': 'A', 'Summit Christian': 'A',
    'Paw Paw': 'A', 'Union': 'A', 'Pickens': 'A', 'Harman': 'A',
    'Paden City': 'A',
    // ---- Spelling variants that appear in imported data ----
    'Clay Battelle': 'A', 'Calhoun': 'A', 'Valley Wetzel': 'A', 'Wheeling Central': 'A',
    'Shady Springs': 'AAA', 'St Marys': 'A', 'St Albans': 'AAA', 'Princeton Senior': 'AAA',
    'Braxton': 'AA', 'Chapmanville': 'AAA'
  };

  // Slugs whose name never matches a key above (the record is missing from the
  // schools collection, so the hub only has the slug to work with).
  const CLASS_SLUG_ALIASES = {
    'mt-view': 'Mount View', 'chapmanville': 'Chapmanville Regional',
    'liberty-raleigh': 'Liberty (Raleigh)', 'wyoming-east': 'Wyoming East',
    'tygarts-valley': 'Tygarts Valley', 'meadow-bridge': 'Meadow Bridge',
    'notre-dame': 'Notre Dame', 'river-view': 'River View',
    'st-marys': 'St. Marys', 'st-albans': 'St. Albans',
    'shady-springs': 'Shady Spring', 'princeton-senior': 'Princeton',
    'braxton': 'Braxton County', 'clay-battelle': 'Clay-Battelle',
    'calhoun': 'Calhoun County', 'valley-wetzel': 'Valley',
    'wheeling-central': 'Wheeling Central Catholic', 'summit-christian-academy': 'Summit Christian',
    'pendleton': 'Pendleton County', 'pocahontas': 'Pocahontas County'
  };

  function normalizeSchoolName(schoolName) {
    if (!schoolName) return 'Unknown';
    let n = norm(schoolName).replace(/\s+(high\s+)?school\s*$/i, '').replace(/\s+hs\s*$/i, '').trim();
    return n.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // Build once: normalized name -> class. Names are matched loosely, so
  // "St. Marys High School", "st marys hs" and "St. Marys" all land on the same
  // class, and a bare "Braxton" finds "Braxton County".
  let WV_CLASS_LOOKUP = null;
  function classificationOfName(schoolName) {
    if (!schoolName) return null;
    if (!WV_CLASS_LOOKUP) {
      WV_CLASS_LOOKUP = {};
      Object.keys(WV_CLASSIFICATION).forEach(k => {
        WV_CLASS_LOOKUP[normalizeSchoolName(k).toLowerCase()] = WV_CLASSIFICATION[k];
      });
    }
    const n = normalizeSchoolName(schoolName).toLowerCase();
    return WV_CLASS_LOOKUP[n]
      || WV_CLASS_LOOKUP[n + ' county']
      || WV_CLASS_LOOKUP[n.replace(/\s+county$/, '')]
      || null;
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
    teamIndex: {},    // school slug -> per-gender power, ranks, ranked athletes
    teamForm: {},     // school slug|gender -> meets raced, newest first
    meetIndex: {},    // meet slug -> field, rated leader, finishers, team scores
    watch: { M: [], F: [] },
    divisional: {},   // 'AAAA'|'AAA'|'AA'|'A'|'UNA' -> { top:[], teams:[] }
    upcoming: [],
    recaps: [],
    // Per-season rating models from MSMRating.buildSeasonModels(): the rating
    // a performance carries, and the course factors a projection needs.
    ratingModels: {},   // season -> { courseFactor, weatherFactor, ... }
    ratingSeasons: [],  // seasons present in the data, ascending
    ratingSeason: null, // season whose model is live (current when it has data)
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

  // West Virginia meets only. The database carries full fields from big
  // out-of-state invitationals (2,600+ rows of Pennsylvania and Ohio racing),
  // and rankings.html has always ranked WV teams on WV results alone. Every
  // power rating in the hub has to use the same rule, or a school that
  // travelled out of state posts one number on the hub and another on the
  // rankings page. Legacy rows with no `state` are assumed in-state, exactly
  // as rankings.html and the coach portal assume.
  const HOME_STATE = "WV";
  function isInState(r) {
    return (r && r.state ? String(r.state) : HOME_STATE).toUpperCase() === HOME_STATE;
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
          school_name: (state.schools[r.school_slug] || {}).name || (r.school_name || ""),
          raw_school_name: r.school_name || "", // the importer's own spelling
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

      // Rate every performance against its OWN season's calibration and build
      // the power ratings from the current season's racing. This is the team
      // power rule the divisional tables, the newsletters and the drafts all
      // quote ("sum of the five best ratings this season"), so the ratings it
      // sums have to come from this season's model -- not an all-time blend.
      const rated = await window.MSMRating.buildSeasonModels(raw, {
        meetsMap: state.meets,
        coursesMap: state.courses
      });
      state.ratingSeasons = rated.seasons;
      state.ratingModels = rated.models;
      state.ratingSeason = rated.season;
      raw.forEach(r => {
        const res = rated.rate(r);
        r.msm = res ? res.points : null;
        // Cached so a projection built later still sees this performance's
        // course/field/weather boost, whatever model is live by then.
        r.boost = res ? res.boost : null;
        r.ratingSeason = window.MSMRating.seasonOf(r);
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
    if (classificationOfName(name)) return classificationOfName(name);
    // Fall back to the slug, which is all there is when the school record is
    // missing from the schools collection.
    // Only the curated slug aliases -- guessing a class from a bare slug would
    // hand an out-of-state "Valley" or "Washington" a WV class it never earned.
    const alias = CLASS_SLUG_ALIASES[norm(slug)];
    return (alias && classificationOfName(alias)) || "UNA"; // UNA / unmapped
  }

  // Is this a WV school the hub should rank? Two signals, either one is enough:
  // a record in the curated `schools` collection, or a WVSSAC class. Out-of-state
  // schools that race WV invitationals have neither, which is what keeps
  // "Fairland" and "Russell" out of the WV team power tables.
  function isHomeSchool(slug) {
    if (!slug) return false;
    if (slug === "unattached") return false;
    if (state.schools[slug]) return true;
    const cls = classify(slug);
    return !!cls && cls !== "UNA";
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
      // WV-only, matching rankings.html's team standings and the "this season,
      // in West Virginia" framing of the watch lists and divisional podiums.
      if (!isInState(r)) return;
      // A summer road 5K or an August time trial is a fitness marker, not the
      // season itself, so out-of-season efforts never define an athlete's
      // standing. The ATHLETE stays (they have a season to chase) -- only the
      // out-of-season marks are ignored. Previously the whole athlete was
      // dropped whenever their single best rating happened to come from one of
      // those meets, which threw away every in-season race they ran and badly
      // undercut school team power (University's boys read 1,407 instead of
      // the 4,076 their in-season top five actually sums to).
      if (isNonCompetitive(r.meet_slug)) return;
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
      // Graduation year travels with the athlete so drafted copy and the
      // generated newsletter can say "Junior" instead of guessing.
      e.grade = e.bestRaw ? (e.bestRaw.grad_year || null) : null;
      // Relay legs are rated like any other effort (the site has always shown
      // them that way), but they are not cross country races, so the copy says
      // so when an athlete's best rating came from one.
      e.relay = e.bestRaw ? isRelayResult(e.bestRaw) : false;
    });
    // "Hot" = current-season best MSM rating, in-season races only.
    // Unattached runners and out-of-state schools are excluded: this is a
    // school-season watch list, and they have no WV title to chase.
    //
    // A missing WVSSAC class must NOT exclude a school any more -- that put 45
    // real WV teams (Weir, Scott, Logan, Frankfort, Ritchie County ...) outside
    // every power rating on the hub. A curated record in the schools collection
    // is enough to belong here; the class only decides which divisional table
    // the team appears in.
    return list
      .filter(e => e.best != null)
      .filter(e => isHomeSchool(e.school_slug))
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
      // Same rule as the team index: five runners or no power rating. Short
      // squads are still listed (readers want to know who is racing) but they
      // sort below the complete teams and carry no score.
      const teamRows = Object.values(teams).map(t => ({
        school_slug: t.school_slug, gender: t.gender,
        school: schoolNameOf(t.school_slug),
        complete: t.top.length >= 5,
        power: t.top.length >= 5 ? t.top.slice(0, 5).reduce((s, v) => s + v, 0) : null,
        runners: t.top.length
      })).filter(t => t.runners >= 3)
        .sort((a, b) => (a.complete === b.complete ? (b.power == null ? 0 : b.power) - (a.power == null ? 0 : a.power) : (a.complete ? -1 : 1)));
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

  // Count of current-season races that got a weather boost (>1.0 factor).
  function computeWeatherCoverage() {
    const bySeason = state.ratingModels || {};
    const season = bySeason[currentSeason()] ? currentSeason() : state.ratingSeason;
    const wx = (bySeason[season] || {}).weatherFactor
      || (window.MSMRating && window.MSMRating.model.weatherFactor) || {};
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
    // Scoped to West Virginia meets AND to the current season, so the headline
    // figures match the WV-only, current-season watch lists and divisional
    // tables they sit next to.
    const season = currentSeason();
    const rated = state.results.filter(r => r.msm != null && isInState(r) && seasonOf(r) === season).length;
    const schools = new Set(state.results.filter(r => r.msm != null && r.school_slug && isInState(r) && seasonOf(r) === season).map(r => r.school_slug));
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
    buildTeamIndex(thisYear);
    buildMeetIndex();
    buildTeamForm();
    // Both caches are keyed by data that just changed, so drop them rather
    // than serving a stale answer from a previous build.
    nextMeetCache = {};
    Object.keys(projectionCache).forEach(key => delete projectionCache[key]);
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

  // A margin rather than an absolute time: "+42.6s" or "+1:12.4".
  function formatGap(sec) {
    const n = Number(sec);
    if (!isFinite(n)) return "—";
    const sign = n < 0 ? "-" : "+";
    const a = Math.abs(n);
    const m = Math.floor(a / 60);
    return m
      ? `${sign}${m}:${(a - m * 60).toFixed(1).padStart(4, "0")}`
      : `${sign}${a.toFixed(1)}s`;
  }

  // Team power = sum of a school's five best current-season ratings, per gender.
  //
  // Membership is decided PER PERFORMANCE, not per athlete. The watch list keys
  // an athlete by name and keeps whichever school showed up first, which meant
  // that one stray row -- typically a relay leg carrying the wrong school slug --
  // handed a different school that athlete's best mark (and quietly cost the
  // real school a scorer: Clay-Battelle's Jonathan Bowers was on East Fairmont's
  // ledger because his first race of the season was). Here every rated row
  // counts for the school it names, which is exactly how rankings.html groups
  // its team standings, so both pages post the same number.
  // The results table carries more than one slug for some schools -- a typo
  // ("indepence" for Independence), a name variant ("braxton-county" beside
  // "braxton") -- which split one team into two entries and left each with half
  // a roster. Rows are filed under the school the `schools` collection knows,
  // matched on a county-suffix-insensitive name, so a squad has one roster and
  // one power rating. Unknown slugs are left alone rather than guessed at.
  let SCHOOL_SLUG_BY_NAME = null;
  function schoolNameKey(name) {
    return normalizeSchoolName(name).toLowerCase().replace(/\s+county$/, '');
  }
  function slugForSchoolName(name) {
    if (!name) return null;
    if (!SCHOOL_SLUG_BY_NAME) {
      SCHOOL_SLUG_BY_NAME = {};
      Object.keys(state.schools).forEach(sl => {
        const n = schoolNameKey((state.schools[sl] || {}).name || prettySchoolSlug(sl));
        if (n && !SCHOOL_SLUG_BY_NAME[n]) SCHOOL_SLUG_BY_NAME[n] = sl;
      });
    }
    return SCHOOL_SLUG_BY_NAME[schoolNameKey(name)] || null;
  }
  function canonicalSlugOf(slug, name) {
    if (slug && state.schools[slug]) return slug;
    return slugForSchoolName(name) || slugForSchoolName(prettySchoolSlug(slug)) || slug;
  }

  function buildTeamIndex(season) {
    const index = {};
    ["M", "F"].forEach(gender => {
      const seen = {}; // "school|athlete" -> the athlete's best row for that school
      state.results.forEach(r => {
        if (r.gender !== gender || r.msm == null || !r.date) return;
        if (!r.athlete_name || !r.school_slug) return;
        // Current season only: a power rating is built from this season's
        // racing, so a 2025 state-meet mark can never top a 2026 list.
        if (seasonOf(r) !== season) return;
        if (!isInState(r) || isNonCompetitive(r.meet_slug)) return;
        if (!isHomeSchool(r.school_slug)) return;
        const slug = canonicalSlugOf(r.school_slug, r.raw_school_name || r.school_name);
        const key = slug + "|" + norm(r.athlete_name);
        const current = seen[key];
        if (current) current.races++;
        else seen[key] = {
          school_slug: slug, school: schoolNameOf(slug),
          classification: classify(slug),
          name: r.athlete_name, rating: r.msm, timeSec: r.timeSec,
          meet: r.meet_name || "", date: r.date, races: 1,
          grade: r.grad_year || null, relay: isRelayResult(r)
        };
        if (current && r.msm > seen[key].rating) {
          // A better mark moves the athlete's card, not their school.
          seen[key].rating = r.msm; seen[key].timeSec = r.timeSec;
          seen[key].meet = r.meet_name || ""; seen[key].date = r.date;
          seen[key].grade = r.grad_year || null; seen[key].relay = isRelayResult(r);
        }
      });
      Object.values(seen).forEach(e => {
        const team = index[e.school_slug] || (index[e.school_slug] = {
          slug: e.school_slug,
          name: e.school,
          classification: e.classification && e.classification !== "UNA" ? e.classification : "",
          M: { rated: 0, scorers: 0, power: null, top: "", topRating: null, athletes: [] },
          F: { rated: 0, scorers: 0, power: null, top: "", topRating: null, athletes: [] }
        });
        const side = team[gender];
        side.rated += 1;
        if (side.topRating == null || e.rating > side.topRating) { side.topRating = e.rating; side.top = e.name; }
        // The ranked roster is the raw material for prose that names real
        // athletes (drafted articles, the team newsletter), so keep each
        // runner's best mark, the meet it came at, and their class.
        side.athletes.push({
          name: e.name, rating: e.rating, timeSec: e.timeSec,
          meet: e.meet, date: e.date, races: e.races,
          grade: e.grade || null, relay: !!e.relay
        });
      });
    });
    Object.values(index).forEach(team => {
      ["M", "F"].forEach(gender => {
        const side = team[gender];
        side.athletes.sort((a, b) => b.rating - a.rating);
        const five = side.athletes.slice(0, 5);
        side.scorers = five.length;
        // A team power rating is the sum of FIVE ratings -- that is the rule the
        // divisional tables, the newsletters and rankings.html all quote. A
        // three-runner squad summing three ratings is not comparable to a
        // complete five (and ranking them together flattered short-handed
        // teams), so an incomplete team has no power rating at all, only a
        // running total the copy is free to mention as "so far".
        side.complete = five.length === 5;
        side.power = side.complete ? five.reduce((s, a) => s + a.rating, 0) : null;
        side.partial = five.reduce((s, a) => s + a.rating, 0);
        side.avg = side.power == null ? null : side.power / 5;
        // Compression: the gap between a team's fastest and fifth scorer, in
        // seconds. A tight spread is what turns five good runners into a
        // low-scoring team, and it is worth a sentence in every write-up.
        // The gap between the best and fifth-best rating on the roster. Ratings,
        // not raw times: a squad's five marks come from different courses and
        // distances, so seconds are not comparable across them.
        side.spread = five.length >= 3 ? Math.round(five[0].rating - five[five.length - 1].rating) : null;
      });
    });
    // Ranks let the auto-drafted prose read like a real preview
    // ("the No. 1 boys team power in the state", "No. 2 in Class AAA").
    ["M", "F"].forEach(gender => {
      const ranked = Object.values(index)
        .filter(t => t[gender].complete)
        .sort((a, b) => b[gender].power - a[gender].power);
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

  /* ---- races, not meets: places are per race, not per meet ---- */
  // A meet runs several races (a class championship, varsity, JV, freshman),
  // and every one of them numbers its places from 1. Treating a
  // meet+gender as a single race makes a JV winner look like the meet winner
  // and corrupts any place-sum team score, so races are the unit here.

  function isRelayResult(r) {
    return /relay/i.test(String(r.race_type || ""));
  }

  // Token-safe race key: "AAA/AAAA HS" -> "aaa-aaaa-hs".
  function raceTagOf(raceType) {
    const t = String(raceType || "").trim();
    if (!t) return "open";
    return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "open";
  }

  // Human label for prose: "Class AAA race", "junior varsity race".
  function raceLabelOf(raceType) {
    const t = String(raceType || "").trim();
    if (!t) return "";
    if (/^\d[\d,\s]*m(eters)?$/i.test(t)) return ""; // a distance, not a race name
    const lower = t.toLowerCase();
    if (lower === "open") return "open race";
    if (lower === "jv" || lower === "junior varsity") return "junior varsity race";
    if (lower === "freshman") return "freshman race";
    if (lower === "hs junior" || lower === "junior") return "junior race";
    if (lower === "varsity" || lower === "high school") return "varsity race";
    if (/^a{1,4}$/.test(lower) || t.includes("/")) return `Class ${t.toUpperCase()} race`;
    return `${t} race`;
  }

  // The race a meet's story hangs on: the most competitive one with enough
  // scorers to produce a team score.
  function primaryRaceOf(meetSlug, gender) {
    const summary = state.meetIndex[meetSlug];
    const races = summary && summary.races ? summary.races[gender] : null;
    if (!races) return null;
    const list = Object.values(races);
    const scored = list.filter(r => r.finishers && r.finishers.length >= 5);
    const pool = scored.length ? scored : list.filter(r => r.finishers && r.finishers.length);
    if (!pool.length) return null;
    return pool.slice().sort((a, b) =>
      (a.winnerTimeSec || 1e9) - (b.winnerTimeSec || 1e9) || b.rows.length - a.rows.length
    )[0];
  }

  // Per-meet form, per school and gender: the top five a team actually ran on
  // a given day, with their ratings and times, taken from the race that team's
  // varsity line ran. This is what lets the drafted copy and the newsletter
  // talk about a team's week rather than its season average.
  function buildTeamForm() {
    const grouped = {};
    state.results.forEach(r => {
      if (!r.school_slug || r.school_slug === "unattached" || !r.meet_slug) return;
      if (r.gender !== "M" && r.gender !== "F") return;
      if (r.msm == null || seasonOf(r) !== currentSeason() || isNonCompetitive(r.meet_slug)) return;
      if (isRelayResult(r)) return; // relay legs are not a cross country team race
      const key = r.school_slug + "|" + r.gender;
      const meets = grouped[key] || (grouped[key] = {});
      const meet = meets[r.meet_slug] || (meets[r.meet_slug] = {
        meet_slug: r.meet_slug, meet_name: r.meet_name, date: r.date, byRace: {}
      });
      const tag = raceTagOf(r.race_type);
      (meet.byRace[tag] || (meet.byRace[tag] = [])).push({
        name: r.athlete_name, msm: r.msm, timeSec: r.timeSec, place: r.place,
        grade: r.grad_year || null, race_type: r.race_type || ""
      });
    });
    const out = {};
    Object.keys(grouped).forEach(key => {
      const [slug, gender] = key.split("|");
      const meets = Object.values(grouped[key])
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      meets.forEach(m => {
        // Prefer the meet's primary race, but fall back to whatever race this
        // school actually filled if it did not run with the varsity crowd.
        const primary = primaryRaceOf(m.meet_slug, gender);
        const tags = Object.keys(m.byRace);
        let chosen = primary && m.byRace[primary.tag] && m.byRace[primary.tag].length >= 5 ? primary.tag : null;
        if (!chosen) chosen = tags.slice().sort((a, b) => m.byRace[b].length - m.byRace[a].length)[0];
        const rows = m.byRace[chosen].slice();
        rows.sort((a, b) => (a.place || 9999) - (b.place || 9999) || (a.timeSec || 1e9) - (b.timeSec || 1e9));
        m.rows = rows;
        m.race_type = rows[0].race_type;
        m.race_label = raceLabelOf(rows[0].race_type);
        m.top5 = rows.slice(0, 5);
        m.avg = m.top5.length ? m.top5.reduce((s, x) => s + x.msm, 0) / m.top5.length : null;
        m.leader = rows[0] || null;
        delete m.byRace;
      });
      (out[slug] || (out[slug] = {}))[gender] = meets;
    });
    state.teamForm = out;
  }

  function teamFormOf(slug, gender) {
    const entry = (state.teamForm || {})[slug];
    return (entry && entry[gender === "F" ? "F" : "M"]) || [];
  }

  // The next meet on a school's own calendar, plus the strongest opponents
  // already listed in that meet's expected field.
  let nextMeetCache = {};
  function nextMeetForSchool(slug) {
    if (Object.prototype.hasOwnProperty.call(nextMeetCache, slug)) return nextMeetCache[slug];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let best = null;
    for (const key in state.meets) {
      const m = state.meets[key];
      if (!m.date) continue;
      const list = Array.isArray(m.expected_teams) ? m.expected_teams : (Array.isArray(m.teams) ? m.teams : []);
      const mine = list.some(t => {
        const raw = typeof t === "string" ? t : (t.slug || t.name || "");
        const name = typeof t === "string" ? t : (t.name || raw);
        return resolveSchoolSlug(typeof t === "object" ? t.slug : raw, name) === slug;
      });
      if (!mine) continue;
      const d = new Date(String(m.date).slice(0, 10) + "T12:00:00");
      if (isNaN(d) || d < today) continue;
      if (!best || String(m.date) < String(best.date)) best = m;
    }
    if (!best) { nextMeetCache[slug] = null; return null; }

    const seen = {};
    const opponents = (Array.isArray(best.expected_teams) ? best.expected_teams : (Array.isArray(best.teams) ? best.teams : []))
      .map(t => {
        const raw = typeof t === "string" ? t : (t.slug || t.name || "");
        const name = typeof t === "string" ? t : (t.name || raw);
        const s = resolveSchoolSlug(typeof t === "object" ? t.slug : raw, name);
        return s && s !== slug && !seen[s] && (seen[s] = true) ? { slug: s, name: schoolNameOf(s) } : null;
      })
      .filter(Boolean)
      .map(t => {
        const team = state.teamIndex[t.slug];
        return { ...t, power: team ? Math.max(team.M.power || 0, team.F.power || 0) : 0 };
      })
      .sort((a, b) => b.power - a.power);

    // The following meets come along too: a newsletter wants a short look
    // ahead, not just the very next Saturday.
    const ahead = Object.values(state.meets)
      .filter(m => m.date && String(m.date) > String(best.date))
      .filter(m => {
        const list = Array.isArray(m.expected_teams) ? m.expected_teams : (Array.isArray(m.teams) ? m.teams : []);
        return list.some(t => {
          const raw = typeof t === "string" ? t : (t.slug || t.name || "");
          const nm = typeof t === "string" ? t : (t.name || raw);
          return resolveSchoolSlug(typeof t === "object" ? t.slug : raw, nm) === slug;
        });
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 3)
      .map(m => ({ slug: m.slug, name: m.name || m.slug, date: m.date, location: m.location || "" }));

    const resolved = {
      slug: best.slug, name: best.name || best.slug, date: best.date,
      location: best.location || "", course_slug: best.course_slug || "",
      expectedCount: Array.isArray(best.expected_teams) && best.expected_teams.length
        ? best.expected_teams.length
        : opponents.length + 1,
      opponents: opponents.slice(0, 5),
      upcoming: ahead
    };
    nextMeetCache[slug] = resolved;
    return resolved;
  }

  // Meet summary: field size, result count, the top-rated boy/girl, and every
  // race run that day with its finish order and team scoring.
  function buildMeetIndex() {
    const index = {};
    const races = {};
    state.results.forEach(r => {
      if (!r.meet_slug) return;
      const meet = index[r.meet_slug] || (index[r.meet_slug] = { schools: {}, count: 0, M: null, F: null, races: {}, primary: {} });
      if (r.school_slug) meet.schools[r.school_slug] = true;
      meet.count += 1;
      if (r.msm != null && (r.gender === "M" || r.gender === "F")) {
        const side = meet[r.gender];
        if (!side || r.msm > side.msm) {
          meet[r.gender] = {
            name: r.athlete_name, school: schoolNameOf(r.school_slug), school_slug: r.school_slug,
            msm: r.msm, timeSec: r.timeSec
          };
        }
      }
      if ((r.gender !== "M" && r.gender !== "F") || isRelayResult(r)) return;
      const tag = raceTagOf(r.race_type);
      const key = `${r.meet_slug}|${r.gender}|${tag}`;
      const race = races[key] || (races[key] = {
        meet: r.meet_slug, gender: r.gender, tag,
        race_type: r.race_type || "", label: raceLabelOf(r.race_type), rows: []
      });
      race.rows.push(r);
    });

    Object.keys(races).forEach(key => {
      const race = races[key];
      const byPlace = race.rows.slice().sort((a, b) => (a.place || 9999) - (b.place || 9999) || (a.timeSec || 1e9) - (b.timeSec || 1e9));
      race.finishers = byPlace.slice(0, 5).map((r, i) => ({
        place: r.place || i + 1,
        name: r.athlete_name,
        school: schoolNameOf(r.school_slug),
        school_slug: r.school_slug,
        msm: r.msm,
        timeSec: r.timeSec
      }));
      race.winnerTimeSec = race.finishers.length ? race.finishers[0].timeSec : null;
      // Place-sum scoring over each school's fastest five, the same rule the
      // simulation uses, so a recap and a projection agree with each other.
      const bySchool = {};
      byPlace.forEach((r, i) => {
        if (!r.school_slug || r.school_slug === "unattached") return;
        (bySchool[r.school_slug] || (bySchool[r.school_slug] = [])).push(r.place || i + 1);
      });
      race.teamScores = Object.keys(bySchool)
        .map(s => ({
          school_slug: s, school: schoolNameOf(s),
          runners: bySchool[s].length,
          score: bySchool[s].length >= 5 ? bySchool[s].slice(0, 5).reduce((a, b) => a + b, 0) : null
        }))
        .filter(t => t.score != null)
        .sort((a, b) => a.score - b.score);
      const meet = index[race.meet];
      (meet.races[race.gender] || (meet.races[race.gender] = {}))[race.tag] = race;
    });

    // The race a story leads with, per gender: resolved once, after every race
    // has a finish order.
    state.meetIndex = index;
    Object.keys(index).forEach(slug => {
      ["M", "F"].forEach(gender => {
        const primary = primaryRaceOf(slug, gender);
        if (primary) index[slug].primary[gender] = primary;
      });
    });
  }

  function teamStat(slug, spec) {
    const team = state.teamIndex[slug];
    if (!team) return null;
    const [first, second] = String(spec || "").split(".");
    if (!second) {
      if (first === "name") return team.name;
      if (first === "class") return team.classification || "unclassified";
      if (first === "athletes") return String(team.M.rated + team.F.rated);
      if (first === "next_meet") { const n = nextMeetForSchool(slug); return n ? n.name : "—"; }
      if (first === "next_meet_date") { const n = nextMeetForSchool(slug); return n ? formatShortDate(n.date) : "—"; }
      if (first === "next_meet_location") { const n = nextMeetForSchool(slug); return n ? (n.location || "West Virginia") : "—"; }
      if (first === "next_meet_opponents") {
        const n = nextMeetForSchool(slug);
        if (!n || !n.opponents.length) return "—";
        const names = n.opponents.slice(0, 3).map(o => o.name);
        if (names.length === 1) return names[0];
        return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      }
      return null;
    }
    const gender = first === "F" ? "F" : "M";
    const side = team[gender];
    // "top_rating" is shorthand for the first runner, so one lookup handles
    // star and depth alike.
    const metric = second.replace(/^top_(rating|time|meet|races|grade|date)$/, "top1_$1");
    // Numbered athletes: {{team:morgantown:M.top2_rating}} is the second-best
    // runner on the roster, which is what makes it possible to write about a
    // team's depth instead of only its star.
    const depth = /^top([1-9])(?:_(rating|time|meet|races|school|grade|date))?$/.exec(metric);
    if (depth) {
      const athlete = side.athletes[Number(depth[1]) - 1];
      if (!athlete) return "—";
      switch (depth[2] || "name") {
        case "name": return athlete.name;
        case "rating": return num(athlete.rating);
        case "time": return formatTime(athlete.timeSec);
        case "meet": return athlete.meet || "—";
        case "races": return String(athlete.races == null ? "—" : athlete.races);
        case "date": return athlete.date ? formatShortDate(athlete.date) : "—";
        case "school": return team.name;
        case "grade": return classWordOf(athlete.grade) || "—";
        default: return "—";
      }
    }
    switch (metric) {
      case "power": return side.complete ? num(side.power) : "—";
      case "power_note": {
        if (side.complete) return "complete five";
        if (!side.rated) return "no rated runners";
        return `${num(side.rated)} rated runner${side.rated === 1 ? "" : "s"} — needs five for a team power`;
      }
      case "avg": return side.avg == null ? "—" : num(Math.round(side.avg));
      case "spread": return side.spread == null ? "—" : num(side.spread);
      case "top": return side.top || "—";
      case "top_rating": return side.topRating == null ? "—" : num(side.topRating);
      case "rated": return num(side.rated);
      case "power_rank": return side.powerRank ? `No. ${side.powerRank}` : "—";
      case "class_rank": return side.classRank ? `No. ${side.classRank}` : "—";
      case "meets_raced": return String(teamFormOf(slug, gender).length);
      case "last_meet": { const f = teamFormOf(slug, gender)[0]; return f ? f.meet_name : "—"; }
      case "last_rating": {
        const f = teamFormOf(slug, gender)[0];
        return f && f.avg != null ? num(Math.round(f.avg)) : "—";
      }
      case "last_leader": {
        const f = teamFormOf(slug, gender)[0];
        return f && f.leader ? f.leader.name : "—";
      }
      case "last_leader_time": {
        const f = teamFormOf(slug, gender)[0];
        return f && f.leader ? formatTime(f.leader.timeSec) : "—";
      }
      case "trend": {
        const forms = teamFormOf(slug, gender);
        if (forms.length < 2 || forms[0].avg == null || forms[1].avg == null) return "—";
        const delta = Math.round(forms[0].avg - forms[1].avg);
        return (delta > 0 ? "+" : "") + delta;
      }
      default: return null;
    }
  }

  // Everything that can only be answered by a single race: its finish order,
  // its place-sum team scores, and the label that tells readers which of a
  // meet's several races this is.
  function meetRaceStat(gender, race, second) {
    const teamScore = (place) => (race && race.teamScores ? race.teamScores[place] : null) || null;
    const winner = race && race.finishers ? race.finishers[0] : null;
    const finisherMatch = /^finisher([1-5])(?:_(school|time|rating))?$/.exec(second);
    if (finisherMatch) {
      const f = race && race.finishers ? race.finishers[Number(finisherMatch[1]) - 1] : null;
      if (!f) return "—";
      switch (finisherMatch[2] || "name") {
        case "name": return f.name;
        case "school": return f.school;
        case "time": return f.timeSec == null ? "—" : formatTime(f.timeSec);
        case "rating": return f.msm == null ? "—" : num(f.msm);
        default: return "—";
      }
    }
    switch (second) {
      case "race_label": return race ? (race.label || "race") : "—";
      case "race_type": return race ? (race.race_type || "—") : "—";
      case "winner": return winner ? winner.name : "—";
      case "winner_school": return winner ? winner.school : "—";
      case "winner_time": return winner && winner.timeSec != null ? formatTime(winner.timeSec) : "—";
      case "winner_rating": return winner && winner.msm != null ? num(winner.msm) : "—";
      case "team_winner": { const t = teamScore(0); return t ? t.school : "—"; }
      case "team_winner_score": { const t = teamScore(0); return t ? num(t.score) : "—"; }
      case "team_runner_up": { const t = teamScore(1); return t ? t.school : "—"; }
      case "team_runner_up_score": { const t = teamScore(1); return t ? num(t.score) : "—"; }
      case "scoring_teams": return num(race && race.teamScores ? race.teamScores.length : 0);
      default: return null;
    }
  }

  function meetStat(slug, spec) {
    const meet = state.meets[slug];
    if (!meet) return null;
    const summary = state.meetIndex[slug];
    const segments = String(spec || "").split(".");
    const first = segments[0];
    if (segments.length === 1) {
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
    const gender = first === "F" ? "F" : "M";
    // {{meet:slug:M.winner}} reads the race the story leads with;
    // {{meet:slug:M.aaa.winner}} names a specific race at a multi-race meet.
    if (segments.length > 2) {
      const byRace = summary && summary.races ? summary.races[gender] : null;
      const race = byRace ? byRace[segments[1]] : null;
      if (!race) return null;
      return meetRaceStat(gender, race, segments[2]);
    }
    const second = segments[1];
    const topRated = summary ? summary[gender] : null;
    if (second === "top") return topRated ? topRated.name : "—";
    if (second === "top_school") return topRated ? topRated.school : "—";
    if (second === "top_rating") return topRated ? num(topRated.msm) : "—";
    if (second === "top_time") return topRated ? formatTime(topRated.timeSec) : "—";
    if (second === "races") {
      const byRace = summary && summary.races ? summary.races[gender] : null;
      return num(byRace ? Object.keys(byRace).length : 0);
    }
    const race = summary && summary.primary ? summary.primary[gender] || null : null;
    if (!race) {
      // No usable race (results that are relays, or an unattached-only field):
      // fall back to the best rating of the day rather than a blank.
      switch (second) {
        case "winner": return topRated ? topRated.name : "—";
        case "winner_school": return topRated ? topRated.school : "—";
        case "winner_time": return topRated ? formatTime(topRated.timeSec) : "—";
        case "winner_rating": return topRated ? num(topRated.msm) : "—";
        default: break;
      }
    }
    return meetRaceStat(gender, race, second);
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
          const second = sim.field[1] || null;
          snapshot = {
            meet: sim.targetMeetName, gender: g,
            winner: winner ? winner.school : "—",
            score: winner ? num(winner.score) : "—",
            runner_up: runnerUp ? runnerUp.school : "—",
            runner_up_score: runnerUp ? num(runnerUp.score) : "—",
            teams: num(sim.completeTeams),
            runners: num(sim.field.length),
            top: top ? top.name : "—",
            top_school: top ? top.school : "—",
            top_time: top ? formatTime(top.timeSec) : "—",
            top2: second ? second.name : "—",
            top2_school: second ? second.school : "—",
            top2_time: second ? formatTime(second.timeSec) : "—",
            winner_spread: winner && winner.spread15 != null ? formatGap(winner.spread15) : "—"
          };
          // The winner's projected scoring five, addressable as
          // {{sim:meet:M.winner2}} / .winner2_time so a preview can name the
          // runners behind the team score instead of only the team total.
          if (winner) {
            winner.top5.forEach((e, i) => {
              snapshot[`winner${i + 1}`] = e.name;
              snapshot[`winner${i + 1}_time`] = formatTime(e.timeSec);
            });
          }
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
      .sort((a, b) => Math.max(b.M.power || 0, b.F.power || 0) - Math.max(a.M.power || 0, a.F.power || 0))
      .map(team => {
        const stats = [];
        ["M", "F"].forEach(gender => {
          const side = team[gender];
          if (!side.rated) return;
          const who = gender === "F" ? "Girls" : "Boys";
          if (side.complete) stats.push({ label: `${who} team power`, token: `{{team:${team.slug}:${gender}.power}}`, value: num(side.power) });
          else stats.push({ label: `${who} power status`, token: `{{team:${team.slug}:${gender}.power_note}}`, value: `${side.rated} rated — needs five` });
          if (side.powerRank) stats.push({ label: `${who} state rank`, token: `{{team:${team.slug}:${gender}.power_rank}}`, value: `No. ${side.powerRank}` });
          if (side.classRank && team.classification) stats.push({ label: `${who} ${team.classification} rank`, token: `{{team:${team.slug}:${gender}.class_rank}}`, value: `No. ${side.classRank}` });
          stats.push({ label: `${who} top runner`, token: `{{team:${team.slug}:${gender}.top}}`, value: side.top || "—" });
          if (side.topRating != null) stats.push({ label: `${who} top rating`, token: `{{team:${team.slug}:${gender}.top_rating}}`, value: num(side.topRating) });
          stats.push({ label: `${who} rated athletes`, token: `{{team:${team.slug}:${gender}.rated}}`, value: num(side.rated) });
          if (side.avg != null) stats.push({ label: `${who} scoring average`, token: `{{team:${team.slug}:${gender}.avg}}`, value: num(Math.round(side.avg)) });
          if (side.spread != null) stats.push({ label: `${who} power gap (1-5)`, token: `{{team:${team.slug}:${gender}.spread}}`, value: `${num(side.spread)} MSM` });
          const lastForm = teamFormOf(team.slug, gender)[0];
          if (lastForm) stats.push({ label: `${who} last meet`, token: `{{team:${team.slug}:${gender}.last_meet}}`, value: lastForm.meet_name });
          const second = side.athletes[1];
          if (second) stats.push({ label: `${who} second runner`, token: `{{team:${team.slug}:${gender}.top2}}`, value: second.name });
        });
        stats.push({ label: "Class", token: `{{team:${team.slug}:class}}`, value: team.classification || "unclassified" });
        const upcoming = nextMeetForSchool(team.slug);
        if (upcoming) stats.push({ label: "Next meet", token: `{{team:${team.slug}:next_meet}}`, value: upcoming.name });
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
          const race = summary && summary.primary ? summary.primary[gender] : null;
          if (race && race.label) stats.push({ label: `${who} race`, token: `{{meet:${m.slug}:${gender}.race_label}}`, value: race.label });
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

  /* ---------------- auto-drafted articles ---------------- */
  // The news desk's "Draft this story for me" button writes a whole article —
  // lede, team picture, the athletes behind it, recent form, what comes next —
  // and every number that has a token is written as one, so the copy keeps
  // reporting live data instead of freezing on the day it was drafted.

  // "A", "A and B", "A, B and C"
  function nameList(names) {
    const list = names.filter(Boolean);
    if (!list.length) return "";
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  }

  // Grad year -> "junior". Anchored to the season in progress, so a 2028
  // graduate is a sophomore in 2026.
  const CLASS_WORDS = { 9: "freshman", 10: "sophomore", 11: "junior", 12: "senior" };
  function classWordOf(gradYear) {
    const y = Number(gradYear);
    if (!y) return "";
    return CLASS_WORDS[12 - (y - currentSeason())] || "";
  }

  const WHO = { M: "boys", F: "girls" };

  // The named-athletes paragraph. This is the part that makes a draft read like
  // reporting rather than a table dump, so it names as many real runners as the
  // roster supports, each with the meet their mark came at.
  function athleteParagraph(slug, gender) {
    const team = state.teamIndex[slug];
    const side = team[gender];
    const T = k => `{{team:${slug}:${gender}.${k}}}`;
    const who = WHO[gender];
    const a = side.athletes;
    const sentences = [];
    const relayNote = athlete => (athlete && athlete.relay ? " — a relay leg rather than a cross country race" : "");
    if (a[0]) {
      sentences.push(`${T("top")} leads the way at ${T("top_rating")} MSM, the highest rating on the ${who}' roster, set at ${T("top_meet")} in ${T("top_time")}` +
        (classWordOf(a[0].grade) ? ` as a ${T("top_grade")}` : "") + relayNote(a[0]) + ".");
    }
    if (a[1]) {
      sentences.push(`${T("top2")} is next at ${T("top2_rating")}, set at ${T("top2_meet")}` +
        (classWordOf(a[1].grade) ? ` (${T("top2_grade")})` : "") + relayNote(a[1]) + ".");
    }
    if (a[2]) {
      // Whatever is left of the scoring five, however deep the roster goes.
      const rest = a.slice(2, 5).map((x, i) => `${T(`top${i + 3}`)} (${T(`top${i + 3}_rating`)})`);
      sentences.push(rest.length > 1
        ? `${nameList(rest)} fill out the back of the scoring five, so the ${who} are not a one-runner team.`
        : `${rest[0]} is the next name to know.`);
    }
    return sentences.join(" ");
  }

  // One squad's chapter: where it stands, who got it there, how it ran last.
  function teamGenderChapter(slug, gender) {
    const team = state.teamIndex[slug];
    const side = team[gender];
    const who = WHO[gender];
    const T = k => `{{team:${slug}:${gender}.${k}}}`;
    const out = [];

    // 1. The shape of the team score. The ranking itself is the lede's job, so
    // this paragraph is about how the five is built.
    const bits = [];
    if (side.scorers >= 5) {
      const classRank = side.classRank && team.classification
        ? `, ${T("class_rank")} of Class ${team.classification}`
        : "";
      bits.push(`Their five-runner core averages ${T("avg")} MSM a scorer${classRank}, and ${T("spread")} MSM points separate their first and fifth scorers.`);
      if (side.spread != null) {
        bits.push(side.spread <= 130
          ? `That is a tight pack, so an off day for one runner barely moves the team total — the single most useful thing a cross country team can have.`
          : `The swing lives at the back of the five, which makes the fifth runner the one to watch on race day.`);
      }
      const formCount = teamFormOf(slug, gender).length;
      if (formCount > 1) {
        bits.push(`${T("rated")} ${who} have a rated performance this season across ${T("meets_raced")} meets, which is the depth that lets a coach rearrange the back half of the lineup.`);
      } else {
        bits.push(`${T("rated")} ${who} have a rated performance this season, which is the depth that lets a coach rearrange the back half of the lineup.`);
      }
    } else {
      const tail = side.rated >= 2 ? `, ahead of ${T("top2")} at ${T("top2_rating")}` : "";
      bits.push(`The ${who} are still building a team score: ${T("rated")} rated runner${side.rated === 1 ? "" : "s"} so far, led by ${T("top")} at ${T("top_rating")} MSM${tail}.`);
      bits.push(`Five scorers is the number that decides cross country meets, so the weeks ahead are about putting a full five behind ${T("top")}.`);
    }
    out.push(bits.join(" "));

    // 2. The athletes themselves.
    const names = athleteParagraph(slug, gender);
    if (names) out.push(names);

    // 3. Most recent outing, with the shape of that day's top five.
    const forms = teamFormOf(slug, gender);
    const last = forms[0];
    if (last) {
      const trend = forms[1]
        ? ` That is ${T("trend")} MSM on the five-runner average from the meet before.`
        : "";
      out.push(`Most recently at ${T("last_meet")}, the top five averaged ${T("last_rating")} MSM${last.leader ? `, with ${T("last_leader")} leading the group in ${T("last_leader_time")}` : ""}.` + trend);
    }
    return out;
  }

  // The ranking sentence that opens both the drafted article and the
  // newsletter, so the two never drift apart.
  function teamStandingSentence(slug) {
    const team = state.teamIndex[slug];
    if (!team) return "";
    const genders = ["M", "F"].filter(g => team[g].rated > 0);
    if (!genders.length) return "";
    const phrases = genders.map(gender => {
      const side = team[gender];
      const t = k => `{{team:${slug}:${gender}.${k}}}`;
      const standing = side.complete
        ? `are ${side.powerRank ? t("power_rank") : "unranked"} in West Virginia on a ${t("power")}-point top five`
        : `have ${t("rated")} rated runner${side.rated === 1 ? "" : "s"} led by ${t("top")}, and no team power rating until a fifth scorer emerges`;
      return `${WHO[gender]} ${standing}`;
    });
    const squads = team.classification
      ? (genders.length === 2 ? ` Both squads run in Class ${team.classification}.` : ` They run in Class ${team.classification}.`)
      : "";
    const lede = genders.length === 1
      ? `${team.name}'s ${phrases[0]}.`
      : `${team.name}'s ${phrases[0]}, and the ${phrases[1]}.`;
    return `${lede}${squads}`;
  }

  function teamDraft(slug) {
    const team = state.teamIndex[slug];
    if (!team) return "";
    const genders = ["M", "F"].filter(g => team[g].rated > 0);
    if (!genders.length) return "";
    const paragraphs = [];
    const T = k => `{{team:${slug}:${k}}}`;

    paragraphs.push(teamStandingSentence(slug));

    genders.forEach(gender => {
      paragraphs.push(...teamGenderChapter(slug, gender));
    });

    // What is next, straight off the school's own calendar.
    const next = nextMeetForSchool(slug);
    if (next) {
      const opponents = next.opponents.length
        ? ` The expected field includes ${nameList(next.opponents.slice(0, 3).map(o => o.name))}.`
        : "";
      paragraphs.push(`Next up is ${T("next_meet")} on ${T("next_meet_date")} at ${T("next_meet_location")}.${opponents}`);
    } else {
      paragraphs.push(`No next meet is on the calendar for ${team.name} yet — the schedule will update as soon as it is published.`);
    }

    return paragraphs.join("\n\n");
  }

  // Races that are not really the meet's headline: junior varsity, freshman
  // and open races get a mention only when a meet has nothing else.
  const LOWER_RACE = /junior varsity|freshman|open/i;

  function meetDraft(slug) {
    const meet = state.meets[slug];
    if (!meet) return "";
    const summary = state.meetIndex[slug];
    const T = k => `{{meet:${slug}:${k}}}`;
    const racesFor = (gender) => {
      const byRace = summary && summary.races ? summary.races[gender] : null;
      return byRace
        ? Object.values(byRace)
            .filter(r => r.finishers && r.finishers.length >= 3)
            .sort((a, b) => (a.winnerTimeSec || 1e9) - (b.winnerTimeSec || 1e9))
        : [];
    };
    const hasRace = ["M", "F"].some(g => racesFor(g).length);

    if (!hasRace) {
      if (meet.date) {
        return [
          `${T("name")} is on the calendar for ${T("date")} at ${T("location")}, with ${T("field")} teams in the expected field.`,
          `Entries, the course preview and the projected team scores will land here once the meet is run.`
        ].join("\n\n");
      }
      return `${T("name")} is on the season calendar at ${T("location")}.`;
    }

    const paragraphs = [
      `${T("name")} drew ${T("field")} teams and produced ${T("results")} rated MSM performances on ${T("date")} at ${T("location")}.`
    ];

    ["M", "F"].forEach(gender => {
      const races = racesFor(gender);
      if (!races.length) return;
      const who = WHO[gender];
      // A class meet runs several varsity races (AAAA/AAA/AA/A) and each one is
      // its own championship, so they are all reported — but JV and freshman
      // races are only mentioned when there is nothing else to lead with.
      const varsity = races.filter(r => !LOWER_RACE.test(r.label || ""));
      const pool = varsity.length ? varsity : races.slice(0, 1);
      // A championship meet runs one race per class: report them biggest class
      // first (AAAA, AAA, AA, A) rather than in time order, which would shuffle
      // classes together on a fast day.
      const classRaces = pool.every(r => /^Class [A]+ race$/.test(r.label || ""));
      const chosen = (classRaces
        ? pool.slice().sort((a, b) => b.tag.length - a.tag.length || a.tag.localeCompare(b.tag))
        : pool).slice(0, 4);
      const multiple = chosen.length > 1;

      chosen.forEach(race => {
        const t = k => `{{meet:${slug}:${gender}.${race.tag}.${k}}}`;
        const raceName = race.label ? `${race.label.replace(/ race$/, "")} ${who} race` : `${who} race`;
        const label = multiple ? `${raceName} — ` : "";
        const parts = [];
        if (race.finishers[0]) {
          parts.push(`${label}${t("winner")} of ${t("winner_school")} won in ${t("winner_time")} at ${t("winner_rating")} MSM`);
        }
        if (race.finishers[1] && race.finishers[2]) {
          parts.push(`, with ${t("finisher2")} (${t("finisher2_school")}) second in ${t("finisher2_time")} and ${t("finisher3")} (${t("finisher3_school")}) third in ${t("finisher3_time")}`);
        }
        const top5 = race.finishers.slice(0, 5).map(f => f.name);
        if (top5.length >= 3) parts.push(`. ${nameList(top5)} rounded out the individual top five`);
        parts.push(".");
        paragraphs.push(parts.join(""));

        // Team scoring from the finish order in that race.
        const scores = race.teamScores || [];
        if (scores.length >= 3 && !LOWER_RACE.test(race.label || "")) {
          const t2 = k => `{{meet:${slug}:${gender}.${race.tag}.${k}}}`;
          let line = `${multiple ? `In the ${raceName}, ` : `In the ${who} team race, `}${t2("team_winner")} took the win with ${t2("team_winner_score")} points`;
          if (scores[1]) line += `, ahead of ${t2("team_runner_up")} (${t2("team_runner_up_score")})`;
          if (scores[2]) line += ` and ${scores[2].school} (${scores[2].score})`;
          line += `. ${t2("scoring_teams")} schools put five scorers on the line.`;
          paragraphs.push(line);
        }
      });
    });

    const topBoys = summary ? summary.M : null;
    const topGirls = summary ? summary.F : null;
    const bests = [topBoys, topGirls].filter(Boolean);
    if (bests.length) {
      paragraphs.push(`The highest-rated performances of the day came from ${nameList(bests.map(b => `${b.name} of ${b.school} (${b.msm == null ? "—" : num(b.msm)} MSM)`))}.`);
    }

    paragraphs.push(`Full results, ratings and course information for ${T("name")} are on the meet page. Everything above is drawn from MSM ratings, which normalize each performance for course difficulty, field strength and race-day weather so times from different courses are comparable.`);
    return paragraphs.join("\n\n");
  }

  function simulationDraft(meetSlug) {
    if (!state.meets[meetSlug]) return "";
    const T = k => `{{meet:${meetSlug}:${k}}}`;
    const paragraphs = [];
    ["M", "F"].forEach(gender => {
      const snapshot = simulationSnapshot(meetSlug, gender);
      if (!snapshot || snapshot.winner === "—" || snapshot.score === "—") return;
      const who = WHO[gender];
      const S = k => `{{sim:${meetSlug}:${gender}.${k}}}`;
      const bits = [
        `${S("winner")} projects as the ${who} team champion at ${T("name")} with a ${S("score")}-point total`
      ];
      if (snapshot.runner_up && snapshot.runner_up !== "—") {
        bits.push(snapshot.runner_up_score && snapshot.runner_up_score !== "—"
          ? `, ahead of ${S("runner_up")} (${S("runner_up_score")})`
          : `, ahead of ${S("runner_up")}`);
      }
      if (snapshot.top && snapshot.top !== "—") {
        bits.push(`. ${S("top")} of ${S("top_school")} is the projected individual winner in ${S("top_time")}`);
        if (snapshot.top2 && snapshot.top2 !== "—") bits.push(`, with ${S("top2")} of ${S("top2_school")} next across the line`);
      }
      bits.push(`. The projection covers ${S("runners")} runners from ${S("teams")} scoring teams`);
      if (snapshot.winner_spread && snapshot.winner_spread !== "—") {
        bits.push(`, and ${S("winner")}'s scoring five sits within ${S("winner_spread")} of each other`);
      }
      bits.push(`.`);
      let line = bits.join("");
      // The winner's projected five, named, because that is the part a coach
      // actually argues with.
      const five = [1, 2, 3, 4, 5].filter(i => snapshot[`winner${i}`]);
      if (five.length >= 3) {
        line += ` Projected scorers for ${S("winner")}: `;
        line += five.map(i => `${S(`winner${i}`)} (${S(`winner${i}_time`)})`).join(", ") + ".";
      }
      paragraphs.push(line);
    });
    if (!paragraphs.length) return "";
    return [
      `Projection preview for ${T("name")} (${T("date")}, ${T("location")}). Each athlete is projected from their last three races, adjusted for the courses, fields and conditions they ran in, then applied to the target venue.`,
      ...paragraphs,
      `Projections are a snapshot of current form. They update as soon as new results land.`
    ].join("\n\n");
  }

  /* ---------------- auto-generated team newsletter ---------------- */
  // One email's worth of everything about one school, written from live MSM
  // data: where the squads stand, the athletes behind it, how the last meet
  // went and what is next. The engine writes tokens and then resolves them
  // before returning, because a newsletter is a snapshot document — an inbox
  // cannot resolve {{...}} later.
  function teamNewsletter(slug, options) {
    options = options || {};
    const school = state.schools[slug] || null;
    const team = state.teamIndex[slug] || null;
    const name = (school && school.name) || (team && team.name) || prettySchoolSlug(slug);
    const genders = team ? ["M", "F"].filter(g => team[g].rated > 0) : [];
    const next = nextMeetForSchool(slug);
    if (!genders.length && !next) return null;

    const tg = (gender, key) => `{{team:${slug}:${gender}.${key}}}`;
    const facts = [];
    const sections = [];

    genders.forEach(gender => {
      const side = team[gender];
      const label = gender === "F" ? "Girls" : "Boys";
      const bits = [];
      if (side.complete) bits.push(`Team power ${tg(gender, "power")}`);
      if (side.complete && side.powerRank) bits.push(tg(gender, "power_rank") + " in WV");
      if (!side.complete && side.rated) bits.push(`Depth ${tg(gender, "rated")} rated (${tg(gender, "power_note")})`);
      if (side.classRank && side.complete && team.classification) bits.push(tg(gender, "class_rank") + ` in Class ${team.classification}`);
      // A fact labelled "team power" must actually BE a power rating -- five
      // scorers summed. Short-handed squads get their count instead, so the
      // school page never shows a three-runner total dressed up as a rating.
      if (side.complete) {
        facts.push({
          label: `${label} team power`,
          value: tg(gender, "power"),
          sub: bits.slice(1).join(" · ") || `${tg(gender, "rated")} rated runners`
        });
      } else {
        facts.push({
          label: `${label} rated runners`,
          value: tg(gender, "rated"),
          sub: "team power needs a full five"
        });
      }
      facts.push({
        label: `${label} top runner`,
        value: tg(gender, "top"),
        sub: `${tg(gender, "top_rating")} MSM · ${tg(gender, "top_time")} at ${tg(gender, "top_meet")}`
      });
    });
    facts.push({
      label: "Rated athletes",
      value: team ? String(team.M.rated + team.F.rated) : "0",
      sub: options.rosterCount ? `${options.rosterCount} on the roster` : "this season"
    });
    if (options.prCount) {
      facts.push({ label: "Season bests", value: String(options.prCount), sub: "athletes at their fastest time this season" });
    }

    // 1. Where the programme stands.
    const outlook = [teamStandingSentence(slug)];
    genders.forEach(gender => {
      outlook.push(...teamGenderChapter(slug, gender));
    });
    if (outlook.length) sections.push({ heading: "Where they stand", icon: "fa-ranking-star", paragraphs: outlook });

    // 2. The athletes to watch, named, with the meet each mark came at.
    const watch = [];
    genders.forEach(gender => {
      const side = team[gender];
      // Prefer genuine cross country marks: an athlete whose only rated effort
      // is a relay leg is a poor "athlete to watch" unless the roster is thin.
      const crossCountry = side.athletes.filter(a => !a.relay);
      const pool = crossCountry.length >= 3 ? crossCountry : side.athletes;
      pool.slice(0, 3).forEach(athlete => {
        const label = gender === "F" ? "Girls" : "Boys";
        const gradeWord = classWordOf(athlete.grade);
        const achieved = [
          athlete.meet || "an unrecorded meet",
          athlete.date ? `(${formatShortDate(athlete.date)})` : ""
        ].filter(Boolean).join(" ");
        // Written from the athlete's own record rather than through a token:
        // the list skips relay-only marks, so a positional token such as
        // {{team:x:M.top3}} would name a different runner than the one shown.
        watch.push({
          name: athlete.name,
          meta: `${label}${gradeWord ? ` · ${gradeWord}` : ""} · ${num(athlete.rating)} MSM`,
          detail: `Best of ${athlete.timeSec == null ? "—" : formatTime(athlete.timeSec)} at ${achieved}, ` +
            `${athlete.races == null ? "—" : athlete.races} rated race${athlete.races === 1 ? "" : "s"} this season` +
            `${athlete.relay ? " (a relay leg)" : ""}.`,
          href: `athlete.html?name=${encodeURIComponent(athlete.name)}&school=${encodeURIComponent(slug)}`
        });
      });
    });
    if (watch.length) sections.push({ heading: "Athletes to watch", icon: "fa-star", bullets: watch });

    // 3. The last meet, with the scoring five that produced the team score.
    const recaps = [];
    genders.forEach(gender => {
      const last = teamFormOf(slug, gender)[0];
      if (!last || !last.top5.length) return;
      const label = gender === "F" ? "girls" : "boys";
      const scorers = last.top5.map(a => `#${a.place || "–"} ${a.name} (${formatTime(a.timeSec)})`).join(", ");
      recaps.push({
        heading: `${last.meet_name} — ${label}`,
        paragraphs: [
          `The top five averaged ${Math.round(last.avg)} MSM, led by ${last.leader ? last.leader.name : "the front group"}${last.leader && last.leader.place ? ` in ${placeLabel(last.leader.place)}` : ""}.`,
          `Scoring five: ${scorers}.`
        ]
      });
    });
    if (recaps.length) {
      sections.push({
        heading: "Last time out",
        icon: "fa-flag-checkered",
        paragraphs: [],
        subSections: recaps
      });
    }

    // 4. What is next, from the school's own calendar.
    if (next) {
      const paragraphs = [
        `Next up: ${next.name} on ${formatShortDate(next.date)}${next.location ? ` at ${next.location}` : ""}${next.expectedCount > 1 ? `, with ${next.expectedCount} teams in the expected field` : ""}.`
      ];
      if (next.opponents.length) {
        paragraphs.push(`Look for ${nameList(next.opponents.slice(0, 3).map(o => o.name))} at the front of the field.`);
      }
      const after = (next.upcoming || []).slice(0, 2);
      if (after.length) {
        paragraphs.push(`After that: ${nameList(after.map(m => `${m.name} (${formatShortDate(m.date)})`))}.`);
      }
      sections.push({ heading: "Up next", icon: "fa-calendar-days", paragraphs });
    } else {
      sections.push({
        heading: "Up next", icon: "fa-calendar-days",
        paragraphs: [`No upcoming meets are on ${name}'s calendar yet. The schedule updates as soon as it is published.`]
      });
    }

    // 5. How to read the numbers, so the newsletter explains itself.
    sections.push({
      heading: "How these numbers work", icon: "fa-circle-info",
      paragraphs: [
        "Every performance carries an MSM rating on a 1,000-point scale. A rating starts from the time, converts it to 5K pace, then adjusts for how hard the course was, how strong the field around it was, and the weather on the day — so a 17:30 on a mountain course outranks a 17:30 on a flat one. Team power is the sum of a school's five best ratings this season, the same rule that decides a cross country team score on the day."
      ]
    });

    const topGender = genders.find(g => team[g].complete && team[g].powerRank) || genders.find(g => team[g].rated > 0);
    const subject = topGender
      ? `${name} ${WHO[topGender]} ${team[topGender].powerRank ? `No. ${team[topGender].powerRank} in WV` : "team update"}${next ? ` — ${next.name} next` : ""}`
      : `${name} team update${next ? ` — ${next.name} next` : ""}`;

    const raw = {
      slug, name,
      class: team && team.classification ? team.classification : "",
      city: (school && school.city) || "",
      season: String(currentSeason()),
      generated: new Date().toISOString(),
      subject,
      preheader: genders.length
        ? `${genders.map(g => {
            const side = team[g];
            const whose = g === "F" ? "Girls" : "Boys";
            if (side.complete) return `${whose} power ${num(side.power)}`;
            return `${whose} ${side.rated} rated runner${side.rated === 1 ? "" : "s"}`;
          }).join(" · ")}${next ? ` · next: ${next.name} (${formatShortDate(next.date)})` : ""}`
        : `Season update for ${name}`,
      facts,
      sections
    };

    // Resolve tokens everywhere, including inside nested sections, so callers
    // (the school page, the email export) receive plain, email-safe text.
    const resolveDeep = (value) => {
      if (typeof value === "string") return resolveStoryTokens(value);
      if (Array.isArray(value)) return value.map(resolveDeep);
      if (value && typeof value === "object") {
        const out = {};
        Object.keys(value).forEach(key => { out[key] = resolveDeep(value[key]); });
        return out;
      }
      return value;
    };
    return resolveDeep(raw);
  }

  // Ordinal for a finish place, used in newsletter recaps.
  function placeLabel(place) {
    const n = Number(place);
    if (!n) return "";
    const rem100 = n % 100;
    const suffix = rem100 >= 11 && rem100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
    return `${n}${suffix}`;
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
      add("runner-up score", "runner_up_score", snapshot.runner_up_score);
      add("projected individual winner", "top", snapshot.top);
      add("second individual", "top2", snapshot.top2);
      add("projected scoring five", "winner1", snapshot.winner1);
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

  // Course difficulty for a projection uses the most recent calibrated
  // season (the current one whenever it has racing), so a simulation built
  // from last season's races still scores on today's course factors.
  function simulationCourseFactor(courseSlug) {
    if (!courseSlug) return 1;
    const bySeason = state.ratingModels || {};
    const latest = (state.ratingSeasons || [])[(state.ratingSeasons || []).length - 1];
    const season = bySeason[state.ratingSeason] ? state.ratingSeason : latest;
    const factors = season ? (bySeason[season] || {}).courseFactor : null;
    return (factors && factors[courseSlug]) || 1;
  }

  function projectSimulationResult(r, targetCourseSlug, targetDistance) {
    if (!r || r.timeSec == null) return null;
    // The performance's own boost was snapshotted when the model was built,
    // so a result from another season still projects correctly.
    const boost = r.boost > 0 ? r.boost : 1;
    const dist = Number(r.distance) > 0 ? Number(r.distance) : 5000;
    const raw5k = r.timeSec * Math.pow(5000 / dist, 1.06);
    // Rating factors are per-performance. Removing them prevents one easy
    // course, weak field, or favorable weather day from becoming a fake PR.
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
      // Relay legs are scored as relays, not as cross country: extrapolating a
      // 2 km leg to 5K would invent a PR nobody ran.
      if (isRelayResult(r)) return false;
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
    isInState,
    seasonOf,
    currentSeason,
    latestSeason,
    resolveStoryTokens,
    simulationMeetOptions,
    simulationExpectedTeams,
    simulateNewsMeet,
    statLibrary,
    simulationStats,
    storyDraft,
    teamNewsletter,
    teamFormOf,
    nextMeetForSchool,
    classWordOf
  };
})();
