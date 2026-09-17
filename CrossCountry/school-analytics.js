// ============================================================
//  school-analytics.js  —  Coach & Athlete Insights
//  Mountain State Miles / wvruns
//
//  Drop-in enhancement for CrossCountry/school.html.
//
//  The panel answers one question: how does the CURRENT squad look?
//  Every number in it follows the page's Season filter — which opens on the
//  newest season this school has results in — so the leaderboard lists the
//  athletes who actually raced that season, with their season best and a PR
//  flag when that best is also the fastest they have ever run, instead of
//  every athlete the school has ever recorded.
//
//  Times are only comparable over the same distance, so an athlete's season
//  best is tracked per distance (an early-season 3K and a 5K varsity race are
//  two different efforts). A season raced at one distance reads as a single
//  board; a season with both gets one board per distance.
//
//  Choosing "All-Time" in the Season filter widens it deliberately, and the
//  panel's subtitle says so.
//
//  Reuses globals defined by school.html:
//    schoolResults, seasonResults, currentSeason, rosterData, meetsBySlug,
//    schoolObj, schoolSlug, formatTime(), escapeHtml(), athleteKey(),
//    classLabelOf(), resultYear(), toggleSection(), collapseStorageKey(),
//    toast(), dl()
//
//  Install: <script src="school-analytics.js" defer></script>
//  school.html dispatches MSMDataLoaded once its data is on screen, and
//  MSMSeasonChanged whenever the Season filter moves.
// ============================================================

(function () {
  "use strict";

  // Leaderboard rows shown per board before the list is capped.
  const TOP_N = 10;
  let showAll = false;

  // ---------------------------------------------------------------
  //  Small local helpers (kept local so the module stays drop-in)
  // ---------------------------------------------------------------
  const nameOf = (r) => r.athlete_name || r.name || "Unknown";
  const secOf = (r) => { const t = parseFloat(r && r.time); return isNaN(t) || t <= 0 ? null : t; };
  // Relay legs are real results but not cross country races: a 2.4 km leg would
  // otherwise become someone's "season best" and top the improvement list.
  const isRelay = (r) => /relay/i.test(String(r.race_type || ""));
  const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  // Times come from the same stored source, so a hair of tolerance is plenty
  // to answer "is this run their best?".
  const EPS = 0.005;

  const fmt = (sec) => (typeof formatTime === "function" ? formatTime(sec) : String(sec));
  const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const esc = (s) => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s));
  const notify = (msg) => { if (typeof toast === "function") toast(msg); };
  const save = (name, type, body) => { if (typeof dl === "function") dl(name, type, body); };

  const GENDERS = [
    { code: "M", label: "Boys" },
    { code: "F", label: "Girls" },
    { code: "OTHER", label: "Athletes" }
  ];

  function genderLabel(code) {
    const found = GENDERS.find((g) => g.code === code);
    return found ? found.label : "Athletes";
  }

  function genderCode(r) {
    const g = String(r.gender || "").toUpperCase();
    if (g.startsWith("F") || g.startsWith("W")) return "F";
    if (g.startsWith("M")) return "M";
    return "OTHER";
  }

  // 0 means the distance wasn't recorded, which keeps those rows in their own
  // bucket instead of being compared against a real 5K.
  function distanceOf(r) {
    const d = parseInt(r.distance, 10);
    return isNaN(d) || d <= 0 ? 0 : d;
  }

  function distanceLabel(meters) {
    if (!meters) return "distance not recorded";
    if (meters % 1000 === 0) return `${meters / 1000}K`;
    return `${meters}m`;
  }

  // Result rows key on athlete_name (they carry no id), which is also how
  // school.html's own season-best map keys itself.
  function keyOf(r) {
    const raw = typeof athleteKey === "function"
      ? athleteKey(r)
      : (r.athlete_slug || r.athlete_id || r.athlete_name || r.name);
    return raw ? String(raw).trim().toLowerCase() : "";
  }

  // Result rows have no date of their own — it lives on the meet.
  function dateOf(r) {
    const meet = (typeof meetsBySlug === "object" && meetsBySlug && meetsBySlug[r.meet_slug]) || null;
    const raw = r.date || (meet && meet.date) || null;
    return raw ? String(raw).slice(0, 10) : null;
  }

  function meetNameOf(r) {
    const meet = (typeof meetsBySlug === "object" && meetsBySlug && meetsBySlug[r.meet_slug]) || null;
    return (meet && meet.name) || r.meet_name || r.meet || r.meet_slug || "";
  }

  function yearOf(r) {
    if (typeof resultYear === "function") return resultYear(r);
    const d = dateOf(r);
    return d ? Number(d.slice(0, 4)) : null;
  }

  function classOf(record) {
    if (!record || typeof classLabelOf !== "function") return "";
    try { return classLabelOf(record) || ""; } catch (e) { return ""; }
  }

  // ---------------------------------------------------------------
  //  Season scope
  // ---------------------------------------------------------------
  function seasonNow() {
    return (typeof currentSeason === "undefined" || !currentSeason) ? "all" : String(currentSeason);
  }

  function scopeLabel(season) {
    return season === "all" ? "All-Time" : `${season} Season`;
  }

  // The page keeps seasonResults in step with its Season filter, so that is the
  // source of truth; the filter is the only thing that decides who counts as a
  // "current" athlete.
  function scopedResults(season) {
    const all = (typeof schoolResults !== "undefined" && Array.isArray(schoolResults)) ? schoolResults : [];
    if (season === "all") return all;
    const scoped = (typeof seasonResults !== "undefined" && Array.isArray(seasonResults)) ? seasonResults : null;
    if (scoped && scoped.length) return scoped;
    return all.filter((r) => String(yearOf(r)) === season);
  }

  // ---------------------------------------------------------------
  //  Model
  // ---------------------------------------------------------------
  // Career bests come from the school's FULL history and are keyed per distance,
  // so a season best only earns the PR flag when it is genuinely the fastest
  // that athlete has run over that same distance.
  function careerBests() {
    const best = new Map();
    const all = (typeof schoolResults !== "undefined" && Array.isArray(schoolResults)) ? schoolResults : [];
    all.forEach((r) => {
      if (isRelay(r)) return;
      const key = keyOf(r);
      const t = secOf(r);
      if (!key || t == null) return;
      const k = `${key}|${distanceOf(r)}`;
      const current = best.get(k);
      if (current == null || t < current) best.set(k, t);
    });
    return best;
  }

  // Roster records supply the class year and the athlete-page link (results
  // themselves carry neither).
  function rosterIndex() {
    const index = new Map();
    const roster = (typeof rosterData !== "undefined" && Array.isArray(rosterData)) ? rosterData : [];
    roster.forEach((a) => {
      const key = String(a.athlete_name || a.name || "").trim().toLowerCase();
      if (key && !index.has(key)) index.set(key, a);
    });
    return index;
  }

  // One row per athlete per distance: "Cam Holley, 3,000 m" and
  // "Cam Holley, 5,000 m" are separate season bests.
  function summarize(rows, careers, roster) {
    const squad = new Map();    // athlete -> identity + season totals
    const series = new Map();   // athlete|distance -> that season best

    rows.forEach((r) => {
      if (isRelay(r)) return;
      const key = keyOf(r);
      if (!key) return;
      const t = secOf(r);
      const distance = distanceOf(r);
      const gender = genderCode(r);

      let who = squad.get(key);
      if (!who) {
        who = {
          key, name: nameOf(r), gender, races: 0, meets: new Set(),
          distances: new Set(), record: roster.get(key) || null
        };
        squad.set(key, who);
      }
      if (who.gender === "OTHER" && gender !== "OTHER") who.gender = gender;
      who.meets.add(r.meet_slug || meetNameOf(r));
      who.distances.add(distance);
      if (t == null) return;
      who.races++;

      const seriesKey = `${key}|${distance}`;
      let s = series.get(seriesKey);
      if (!s) {
        s = {
          id: seriesKey, key, distance, gender, name: nameOf(r),
          times: [], meets: new Set(), races: 0, best: null, bestMeet: ""
        };
        series.set(seriesKey, s);
      }
      s.races++;
      s.meets.add(r.meet_slug || meetNameOf(r));
      s.times.push({ t, date: dateOf(r), meet: meetNameOf(r) });
      if (s.best == null || t < s.best) {
        s.best = t;
        s.bestMeet = meetNameOf(r);
      }
    });

    const list = Array.from(series.values()).map((s) => {
      const who = squad.get(s.key) || {};
      // "Improvement" is this athlete's own arc at this distance: their first
      // race over it versus the best they have run over it.
      const dated = s.times.filter((x) => x.date).sort((x, y) => x.date.localeCompare(y.date));
      const first = dated.length ? dated[0] : (s.times.length ? s.times[0] : null);
      const opener = first ? first.t : null;
      const career = careers.get(`${s.key}|${s.distance}`);
      return Object.assign(s, {
        meetCount: s.meets.size,
        opener,
        openerMeet: first ? first.meet : "",
        gain: (s.best != null && opener != null && opener - s.best > EPS) ? opener - s.best : 0,
        pr: s.best != null && career != null && s.best <= career + EPS,
        careerBest: career == null ? null : career,
        classLabel: classOf(who.record),
        athleteId: (who.record && (who.record.id || who.record.slug)) || null,
        athleteRaces: who.races || s.races,
        athleteMeets: who.meets ? who.meets.size : s.meets.size
      });
    }).sort((x, y) => (x.best == null ? Infinity : x.best) - (y.best == null ? Infinity : y.best));

    return { squad, list };
  }

  // The distance a school actually races: the one with the most results in the
  // season (a tie goes to the longer race). Early-season tune-ups shouldn't be
  // what "the team's scoring five" describes when championship season is 5K.
  function primaryDistance(scoped) {
    const counts = new Map();
    scoped.forEach((r) => {
      if (isRelay(r) || secOf(r) == null) return;
      const d = distanceOf(r);
      counts.set(d, (counts.get(d) || 0) + 1);
    });
    let best = null, bestCount = -1;
    counts.forEach((count, distance) => {
      if (count > bestCount || (count === bestCount && distance > best)) {
        best = distance;
        bestCount = count;
      }
    });
    return best;
  }

  // Boards are (gender, distance). A season raced at one distance reads as one
  // board per squad; a season with an early 3K and a 5K gets one board each, so
  // nobody's 3,000 m time is ranked against somebody's 5,000 m time.
  function buildBoards(list, primaryDist) {
    const boards = [];
    GENDERS.forEach(({ code, label }) => {
      const forGender = list.filter((s) => s.gender === code && s.best != null);
      if (!forGender.length) return;
      const byDistance = new Map();
      forGender.forEach((s) => {
        if (!byDistance.has(s.distance)) byDistance.set(s.distance, []);
        byDistance.get(s.distance).push(s);
      });
      const ordered = Array.from(byDistance.entries())
        .sort((a, b) => {
          if (a[0] !== b[0]) {
            if (a[0] === primaryDist) return -1;
            if (b[0] === primaryDist) return 1;
          }
          return (b[1].length - a[1].length) || (b[0] - a[0]);
        })
        .map(([distance, rows]) => ({ distance, rows: rows.slice().sort((x, y) => x.best - y.best) }));
      // A single-distance season reads cleanly without any mention of distance.
      const multi = ordered.length > 1;
      ordered.forEach(({ distance, rows }, index) => {
        boards.push({ gender: code, genderLabel: label, distance, rows, primary: index === 0, multi });
      });
    });
    return boards;
  }

  function scoringFive(rows) {
    const five = rows.slice(0, 5);
    if (five.length < 5) return { complete: false, count: five.length };
    return {
      complete: true,
      count: 5,
      avg: five.reduce((sum, s) => sum + s.best, 0) / five.length,
      fifth: five[4].best,
      spread: five[4].best - five[0].best
    };
  }

  function buildModel() {
    const season = seasonNow();
    const scoped = scopedResults(season);
    const careers = careerBests();
    const { squad, list } = summarize(scoped, careers, rosterIndex());
    const primary = primaryDistance(scoped);
    const boards = buildBoards(list, primary);

    // The scoring five is reported over the school's primary distance, so both
    // squads are described over the same race — and only ever a complete five,
    // matching the hub's rule for publishing a team power rating.
    const five = {};
    ["M", "F"].forEach((code) => {
      const board = boards.find((b) => b.gender === code && b.distance === primary)
        || boards.find((b) => b.gender === code);
      five[code] = board ? { distance: board.distance, ...scoringFive(board.rows) } : { complete: false, count: 0 };
    });

    return {
      season,
      label: scopeLabel(season),
      scoped,
      primaryDistance: primary,
      squad,
      list,
      boards,
      athleteCount: squad.size,
      seriesCount: list.filter((s) => s.best != null).length,
      races: scoped.filter((r) => !isRelay(r) && secOf(r) != null).length,
      seasons: new Set(scoped.map((r) => yearOf(r)).filter((y) => y != null)).size,
      prCount: new Set(list.filter((s) => s.pr).map((s) => s.key)).size,
      five
    };
  }

  // ---------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------
  function statCard({ icon, label, value, sub }) {
    return `<div class="stat-card">
      <div class="stat-label"><i class="fa-solid ${icon}"></i> ${esc(label)}</div>
      <div class="stat-value">${esc(value)}</div>
      ${sub ? `<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px;line-height:1.4;">${esc(sub)}</div>` : ""}
    </div>`;
  }

  function cardsHtml(m) {
    const seasonal = m.season !== "all";
    const cards = [
      statCard({
        icon: "fa-people-group",
        label: seasonal ? `Athletes · ${m.season}` : "Athletes · All-Time",
        value: String(m.athleteCount),
        sub: m.seriesCount
          ? `${m.seriesCount} season best${m.seriesCount === 1 ? "" : "s"} from ${m.races} timed race${m.races === 1 ? "" : "s"}`
          : "No timed results in this scope yet"
      })
    ];

    ["M", "F"].forEach((code) => {
      const five = m.five[code] || { complete: false, count: 0 };
      const label = genderLabel(code);
      const where = five.distance ? distanceLabel(five.distance) : "";
      cards.push(statCard({
        icon: "fa-bolt",
        label: `${label} scoring five`,
        value: five.complete ? fmt(five.avg) : "—",
        sub: five.complete
          ? `${where} ${seasonal ? "season" : "all-time"} bests · 5th runner ${fmt(five.fifth)} · spread ${fmt(five.spread)}`
          : five.count
            ? `${where ? where + " · " : ""}${five.count} with a ${seasonal ? "season " : ""}best — a scoring five needs five`
            : "No timed results for this squad"
      }));
    });

    // In an all-time view every athlete's listed best IS their career best, so a
    // PR count would be tautological — report the racing history instead.
    cards.push(seasonal
      ? statCard({
          icon: "fa-fire",
          label: "Personal records",
          value: String(m.prCount),
          sub: m.prCount
            ? `Season best = career best for ${m.prCount} athlete${m.prCount === 1 ? "" : "s"}`
            : "Nobody is at a career best this season yet"
        })
      : statCard({
          icon: "fa-flag-checkered",
          label: "Races on file",
          value: String(m.races),
          sub: `${m.seasons} season${m.seasons === 1 ? "" : "s"} of results · relay legs excluded`
        }));

    return `<div class="stats-grid" style="margin-bottom:1.5rem;">${cards.join("")}</div>`;
  }

  function athleteLink(s) {
    if (s.athleteId) return `<a class="item-name" href="athlete.html?id=${encodeURIComponent(s.athleteId)}">${esc(s.name)}</a>`;
    const name = encodeURIComponent(s.name);
    const school = encodeURIComponent(typeof schoolSlug === "string" ? schoolSlug : "");
    return `<a class="item-name" href="athlete.html?name=${name}&school=${school}">${esc(s.name)}</a>`;
  }

  function metaFor(s) {
    const bits = [];
    if (s.classLabel) bits.push(s.classLabel);
    bits.push(`${s.races} race${s.races === 1 ? "" : "s"} at this distance`);
    if (s.meetCount) bits.push(`${s.meetCount} meet${s.meetCount === 1 ? "" : "s"}`);
    return bits.join(" · ");
  }

  function boardHeading(m, board) {
    const dist = board.multi ? ` · ${distanceLabel(board.distance)}` : "";
    return m.season === "all"
      ? `${board.genderLabel}${dist} · all-time best`
      : `${board.genderLabel}${dist} · ${m.season} season best`;
  }

  function improversHtml(m) {
    // One line per athlete: whoever improved at two distances is listed once,
    // at their bigger drop.
    const bestByAthlete = new Map();
    m.list.forEach((s) => {
      if (s.best == null || s.gain <= 0) return;
      const current = bestByAthlete.get(s.key);
      if (!current || s.gain > current.gain) bestByAthlete.set(s.key, s);
    });
    const improvers = Array.from(bestByAthlete.values())
      .sort((x, y) => y.gain - x.gain)
      .slice(0, 3);
    if (!improvers.length) return "";
    const seasonal = m.season !== "all";
    const heading = seasonal
      ? "Biggest improvements · first race this season → season best"
      : "Biggest career improvements · first race → career best";
    const multiDistance = new Set(m.boards.map((b) => b.distance)).size > 1;
    return `<div style="margin-bottom:1.5rem;">
      <div class="eyebrow" style="margin-bottom:8px;">${esc(heading)}</div>
      <div class="app-list">
        ${improvers.map((s, i) => `
          <div class="list-item">
            <div class="item-place">${i + 1}</div>
            <div class="item-details">
              <div class="item-name">${athleteLink(s)}</div>
              <div class="item-meta">${esc(`Opened ${fmt(s.opener)}${s.openerMeet ? ` at ${s.openerMeet}` : ""}${multiDistance ? ` · ${distanceLabel(s.distance)}` : ""}`)}</div>
            </div>
            <div class="item-score">
              <div class="score-stack">
                <span class="score-rating" style="color:var(--success,#10b981);">−${fmt(s.gain)}</span>
                <span class="score-predicted">faster than the ${seasonal ? "opener" : "debut"}</span>
              </div>
            </div>
          </div>`).join("")}
      </div>
    </div>`;
  }

  function boardsHtml(m) {
    const seasonal = m.season !== "all";
    const blocks = [];
    m.boards.forEach((board) => {
      const list = board.rows;
      // A squad can be 60 deep; the top of the list is the part that gets read,
      // so it opens capped and the whole thing is one click away.
      const visible = showAll ? list : list.slice(0, TOP_N);
      const more = list.length > visible.length
        ? `<div style="padding:12px 16px;text-align:center;border-top:1px solid var(--border);">
             <button class="xbtn" type="button" data-msm-toggle-more="1">Show all ${list.length} ${esc(board.genderLabel.toLowerCase())}</button>
           </div>`
        : (showAll && list.length > TOP_N
            ? `<div style="padding:12px 16px;text-align:center;border-top:1px solid var(--border);">
                 <button class="xbtn" type="button" data-msm-toggle-more="1">Show top ${TOP_N}</button>
               </div>`
            : "");
      blocks.push(`<div class="app-list">
        <div class="list-header" style="display:flex;justify-content:space-between;gap:12px;">
          <span>${esc(boardHeading(m, board))}</span>
          <span>${list.length} athlete${list.length === 1 ? "" : "s"}</span>
        </div>
        ${visible.map((s, i) => `
          <div class="list-item">
            <div class="item-place">${i + 1}</div>
            <div class="item-details">
              <div class="item-name">${athleteLink(s)}${s.pr && seasonal ? '<span class="scorer-tag">PR</span>' : ""}</div>
              <div class="item-meta">${esc(metaFor(s))}</div>
            </div>
            <div class="item-score">
              <div class="score-stack">
                <span class="score-rating">${fmt(s.best)}</span>
                <span class="score-predicted">${s.gain > 0
                  ? `−${fmt(s.gain)} from opener`
                  : (s.races > 1 ? "Opened at best" : "One race")}</span>
              </div>
            </div>
          </div>`).join("")}
        ${more}
      </div>`);
    });
    return blocks.join("") || `<div class="app-list"><div class="empty-state">No timed results for this school in this view yet.</div></div>`;
  }

  function subtitleFor(m) {
    if (m.season === "all") {
      return "All-time view — every athlete with a recorded race, including those who have graduated. Pick a season above to see just that squad.";
    }
    const distances = new Set(m.boards.map((b) => b.distance));
    const scopeNote = distances.size > 1
      ? ` Season bests are split by distance (${Array.from(distances).map(distanceLabel).join(", ")}).`
      : "";
    return `Season bests and personal records for the ${m.season} squad — ${m.athleteCount} athlete${m.athleteCount === 1 ? "" : "s"} raced.${scopeNote} Widen the Season filter above for all-time.`;
  }

  function render() {
    const section = document.getElementById("msm-analytics-section");
    if (!section) return;
    const m = buildModel();

    const scopeEl = document.getElementById("msm-insight-scope");
    if (scopeEl) scopeEl.textContent = subtitleFor(m);

    document.getElementById("msm-insight-cards").innerHTML = m.seriesCount ? cardsHtml(m) : "";
    document.getElementById("msm-improvers").innerHTML = improversHtml(m);
    document.getElementById("msm-boards").innerHTML = boardsHtml(m);
  }

  // ---------------------------------------------------------------
  //  Exports — every one follows the same season scope as the panel
  // ---------------------------------------------------------------
  function exportAllResultsCSV() {
    const m = buildModel();
    const rows = m.scoped.filter((r) => !isRelay(r) && secOf(r) != null);
    if (!rows.length) return notify(`No results to export for ${m.label.toLowerCase()}.`);

    const careers = careerBests();
    const bestAt = new Map(m.list.map((s) => [s.id, s.best]));
    const body = rows
      .slice()
      .sort((x, y) => String(dateOf(y) || "").localeCompare(String(dateOf(x) || "")))
      .map((r) => {
        const t = secOf(r);
        const key = keyOf(r);
        const distance = distanceOf(r);
        const career = careers.get(`${key}|${distance}`);
        return [
          dateOf(r) || "",
          meetNameOf(r),
          nameOf(r),
          genderCode(r) === "OTHER" ? "" : genderCode(r),
          distance ? distanceLabel(distance) : "",
          fmt(t),
          t.toFixed(2),
          r.place || "",
          bestAt.get(`${key}|${distance}`) === t ? "Season best" : "",
          career != null && t <= career + EPS ? "PR" : ""
        ].map(csvCell);
      });
    const csv = [["Date", "Meet", "Athlete", "Gender", "Distance", "Time", "Seconds", "Place", "Season best", "PR"].map(csvCell)]
      .concat(body).map((r) => r.join(",")).join("\n");

    save(`${schoolSlug}_${m.season}_results.csv`, "text/csv;charset=utf-8", csv);
    notify(`✓ ${rows.length} results exported (${m.label})`);
  }

  function exportAthleteAnalysisCSV() {
    const m = buildModel();
    const ranked = m.list.filter((s) => s.best != null);
    if (!ranked.length) return notify(`No timed results for ${m.label.toLowerCase()} yet.`);
    const rows = ranked.map((s) => [
      s.name, s.gender === "OTHER" ? "" : s.gender, s.classLabel,
      distanceLabel(s.distance),
      fmt(s.best), s.best.toFixed(2), s.careerBest == null ? "" : fmt(s.careerBest),
      s.gain > 0 ? s.gain.toFixed(2) : "0.00", s.races, s.meetCount, s.pr ? "PR" : ""
    ].map(csvCell));
    const csv = [["Athlete", "Gender", "Class", "Distance", "Season Best", "Season Best (sec)", "Career Best", "Improvement (sec)", "Races", "Meets", "PR"].map(csvCell)]
      .concat(rows).map((r) => r.join(",")).join("\n");
    save(`${schoolSlug}_${m.season}_athlete_analysis.csv`, "text/csv;charset=utf-8", csv);
    notify(`✓ ${rows.length} season bests exported for ${m.athleteCount} athletes (${m.label})`);
  }

  function exportSeasonJSON() {
    const m = buildModel();
    const scoringFiveJson = (code) => {
      const five = m.five[code] || {};
      if (!five.complete) return null;
      return {
        distance_m: five.distance,
        avg_sec: round2(five.avg),
        fifth_runner_sec: round2(five.fifth),
        spread_sec: round2(five.spread)
      };
    };
    const payload = {
      school: (typeof schoolObj === "object" && schoolObj && schoolObj.name) || schoolSlug,
      slug: schoolSlug,
      scope: m.season,
      scope_label: m.label,
      exported_at: new Date().toISOString(),
      coach_insights: {
        athletes_raced: m.athleteCount,
        timed_season_bests: m.seriesCount,
        personal_records: m.prCount,
        boys_scoring_five: scoringFiveJson("M"),
        girls_scoring_five: scoringFiveJson("F")
      },
      athletes: m.list.filter((s) => s.best != null).map((s) => ({
        name: s.name,
        gender: s.gender === "OTHER" ? null : s.gender,
        class: s.classLabel || null,
        distance_m: s.distance || null,
        distance: distanceLabel(s.distance),
        season_best_sec: round2(s.best),
        season_best: fmt(s.best),
        career_best_sec: round2(s.careerBest),
        improvement_sec: round2(s.gain > 0 ? s.gain : 0),
        races_at_distance: s.races,
        meets: s.meetCount,
        personal_record: s.pr
      }))
    };
    save(`${schoolSlug}_${m.season}_season.json`, "application/json", JSON.stringify(payload, null, 2));
    notify(`✓ Season data exported (${m.label})`);
  }

  // ---------------------------------------------------------------
  //  Panel + wiring
  // ---------------------------------------------------------------
  function panelMarkup() {
    return `
      <section class="section-block" id="msm-analytics-section">
        <div class="section-head" id="msm-analytics-head">
          <div>
            <h2 class="section-heading"><i class="fa-solid fa-gauge-high"></i> Coach &amp; Athlete Insights</h2>
            <p class="section-sub" id="msm-insight-scope">Loading this squad's season bests…</p>
          </div>
          <div class="export-row">
            <button class="xbtn" id="msm-export-all-csv" type="button"><i class="fa-solid fa-file-csv"></i> Results CSV</button>
            <button class="xbtn" id="msm-export-athletes-csv" type="button"><i class="fa-solid fa-user-chart"></i> Athlete CSV</button>
            <button class="xbtn" id="msm-export-json" type="button"><i class="fa-solid fa-code"></i> Season JSON</button>
            <button class="section-toggle" type="button" id="msm-analytics-toggle" aria-label="Toggle Coach and Athlete Insights"><i class="fa-solid fa-chevron-down"></i></button>
          </div>
        </div>
        <div class="section-body">
          <div id="msm-insight-cards"></div>
          <div id="msm-improvers"></div>
          <div id="msm-boards"></div>
        </div>
      </section>`;
  }

  function storageKey() {
    if (typeof collapseStorageKey === "function") return collapseStorageKey("msm-analytics-section");
    return "msm_school_section_msm-analytics-section";
  }

  function inject() {
    const existing = document.getElementById("msm-analytics-section");
    if (existing) { render(); return; }

    const holder = document.createElement("div");
    holder.innerHTML = panelMarkup();
    const panel = holder.firstElementChild;

    // The panel sits with the roster: who is on the team, and how fast.
    const sections = document.querySelectorAll(".content-section .section-block");
    const rosterSection = Array.from(sections).find((s) => s.querySelector("#roster-grid, #roster-search"));
    if (rosterSection && rosterSection.parentNode) {
      rosterSection.parentNode.insertBefore(panel, rosterSection);
    } else {
      const main = document.querySelector("main.content-section");
      if (main) main.appendChild(panel);
    }

    // Every other section on this page collapses when its header is clicked, so
    // the panel does too (the export toolbar keeps its clicks to itself).
    const toggle = () => {
      if (typeof toggleSection === "function") toggleSection("msm-analytics-section");
      else panel.classList.toggle("is-collapsed");
    };
    document.getElementById("msm-analytics-head").addEventListener("click", (event) => {
      if (event.target.closest(".export-row")) return;
      toggle();
    });
    document.getElementById("msm-analytics-toggle").addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });

    document.getElementById("msm-boards").addEventListener("click", (event) => {
      if (event.target.closest("[data-msm-toggle-more]")) { showAll = !showAll; render(); }
    });
    document.getElementById("msm-export-all-csv").addEventListener("click", exportAllResultsCSV);
    document.getElementById("msm-export-athletes-csv").addEventListener("click", exportAthleteAnalysisCSV);
    document.getElementById("msm-export-json").addEventListener("click", exportSeasonJSON);

    // school.html persists section state by id, so honour a collapsed panel.
    try {
      if (localStorage.getItem(storageKey()) === "1") panel.classList.add("is-collapsed");
    } catch (e) { /* private mode */ }

    render();
  }

  window.MSMSchoolAnalytics = {
    exportAllResultsCSV,
    exportAthleteAnalysisCSV,
    exportSeasonJSON,
    refresh: render
  };

  // The page dispatches MSMDataLoaded after its own rendering, and
  // MSMSeasonChanged when the Season filter moves.
  document.addEventListener("MSMDataLoaded", () => setTimeout(inject, 0));
  document.addEventListener("MSMSeasonChanged", () => { showAll = false; render(); });
})();
