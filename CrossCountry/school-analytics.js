// ============================================================
//  school-analytics.js  —  Advanced Analytics & Export add-on
//  Mountain State Miles / wvruns
//
//  Drop-in enhancement for CrossCountry/school.html.
//  The school page is already feature-rich; this LAYERS ON:
//    • Athlete Leaderboard (season best + improvement per runner)
//    • Coach insights (scoring 5 avg, 1-5 spread, PR rate, top improvers)
//    • Full CSV export of every result
//    • Athlete-analysis CSV (season best, meets run, improvement)
//    • Season JSON export
//
//  Reuses globals already defined in school.html:
//    schoolResults, schoolObj, schoolSlug, rosterData,
//    performanceMeetsSorted, personalBestMap, teamColorRgb,
//    formatTime(), escapeHtml(), athleteKey(), toast(), dl(),
//    getTeamColorRgbArray(), formatDateLong()
//
//  Install: add AFTER the page's own inline <script>:
//    <script src="school-analytics.js" defer></script>
// ============================================================

(function () {
  "use strict";

  const MILE_M = 1609.34;
  const nameOf = (r) => r.athlete_name || r.name || "Unknown";
  const secOf = (r) => { const t = parseFloat(r && r.time); return isNaN(t) || t <= 0 ? null : t; };
  const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  // ---- Per-athlete season summary ------------------------------------
  function athleteSummaries() {
    const map = {};
    (schoolResults || []).forEach((r) => {
      const key = athleteKey(r);
      const t = secOf(r);
      if (!key) return;
      if (!map[key]) {
        map[key] = {
          key, name: nameOf(r), gender: (r.gender || "").toUpperCase(),
          times: [], meets: new Set(), best: null, worst: null, first: null, last: null,
        };
      }
      const a = map[key];
      a.meets.add(r.meet_slug || r.meet_name || Math.random());
      if (t != null) {
        a.times.push({ t, date: r.date || (window.meetsBySlug && meetsBySlug[r.meet_slug] && meetsBySlug[r.meet_slug].date) || null });
        if (a.best == null || t < a.best) a.best = t;
        if (a.worst == null || t > a.worst) a.worst = t;
      }
    });
    // improvement = first dated race time - most recent dated race time (positive = faster now)
    return Object.values(map).map((a) => {
      const dated = a.times.filter((x) => x.date).sort((x, y) => x.date.localeCompare(y.date));
      let improvement = null;
      if (dated.length >= 2) improvement = dated[0].t - dated[dated.length - 1].t;
      return {
        ...a, meetCount: a.meets.size, raceCount: a.times.length,
        improvement, avg: a.times.length ? a.times.reduce((s, x) => s + x.t, 0) / a.times.length : null,
      };
    }).sort((x, y) => (x.best ?? Infinity) - (y.best ?? Infinity));
  }

  // ---- Coach insight numbers -----------------------------------------
  function coachInsights(summaries) {
    const withBest = summaries.filter((s) => s.best != null);
    const scoring5 = withBest.slice(0, 5);
    const scoringAvg = scoring5.length ? scoring5.reduce((s, a) => s + a.best, 0) / scoring5.length : null;
    const spread15 = scoring5.length >= 2 ? scoring5[scoring5.length - 1].best - scoring5[0].best : null;

    let prSetters = 0, totalRaces = 0;
    (schoolResults || []).forEach((r) => {
      const t = secOf(r); if (t == null) return; totalRaces++;
      if (personalBestMap[athleteKey(r)] === t) prSetters++;
    });
    const improvers = summaries.filter((s) => s.improvement != null && s.improvement > 0)
      .sort((a, b) => b.improvement - a.improvement).slice(0, 3);

    return { scoringAvg, spread15, prRate: totalRaces ? Math.round((prSetters / totalRaces) * 100) : 0, improvers, depth: withBest.length };
  }

  // =====================================================================
  //  RENDER: insight panel injected before the roster section
  // =====================================================================
  function statCell(label, value, sub) {
    return `<div style="background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;">
      <div style="font-size:0.78rem;color:var(--text-tertiary);font-weight:600;margin-bottom:4px;">${label}</div>
      <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;color:var(--text-primary);">${value}</div>
      ${sub ? `<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;">${sub}</div>` : ""}
    </div>`;
  }

  function buildPanel() {
    const summaries = athleteSummaries();
    const ci = coachInsights(summaries);

    const insightCards = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1.5rem;">
        ${statCell("Scoring 5 Avg", ci.scoringAvg != null ? formatTime(ci.scoringAvg) : "--", "Season-best of top 5")}
        ${statCell("1–5 Spread", ci.spread15 != null ? formatTime(ci.spread15) : "--", "Gap, fastest to 5th")}
        ${statCell("Scoring Depth", ci.depth, "Athletes with a time")}
        ${statCell("PR Rate", ci.prRate + "%", "Races that were a PR")}
      </div>`;

    const improversHtml = ci.improvers.length
      ? `<div style="margin-bottom:1.5rem;">
          <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-tertiary);margin-bottom:8px;">Top Improvers (first race → latest)</div>
          ${ci.improvers.map((a) => `<div style="display:flex;justify-content:space-between;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-md);margin-bottom:6px;background:var(--bg-primary);">
            <span style="font-weight:600;">${escapeHtml(a.name)}</span>
            <span style="color:var(--success,#10b981);font-weight:700;">−${formatTime(a.improvement)}</span>
          </div>`).join("")}
        </div>`
      : "";

    // Leaderboard table
    const rows = summaries.filter((s) => s.best != null).map((a, i) => `
      <tr>
        <td data-label="#">${i + 1}</td>
        <td data-label="Athlete">${escapeHtml(a.name)}</td>
        <td data-label="Gender">${a.gender ? `<span class="gender-pill ${a.gender.toLowerCase()}">${a.gender}</span>` : "—"}</td>
        <td data-label="Season Best">${formatTime(a.best)}</td>
        <td data-label="Races">${a.raceCount}</td>
        <td data-label="Improvement">${a.improvement != null ? (a.improvement > 0 ? `<span style="color:var(--success,#10b981);font-weight:700;">−${formatTime(a.improvement)}</span>` : a.improvement < 0 ? `<span style="color:var(--danger,#ef4444);">+${formatTime(-a.improvement)}</span>` : "—") : "—"}</td>
      </tr>`).join("");

    const leaderboard = `
      <div class="table-container" style="border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;">
        <table class="results-table">
          <thead><tr><th>#</th><th>Athlete</th><th>Gender</th><th>Season Best</th><th>Races</th><th>Improvement</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-secondary);">No timed results yet.</td></tr>'}</tbody>
        </table>
      </div>`;

    return `
      <section class="section-block" id="msm-analytics-section">
        <div class="section-head">
          <div>
            <h2 class="section-heading"><i class="fa-solid fa-gauge-high"></i> Coach &amp; Athlete Insights</h2>
            <p class="section-sub">Season-best leaderboard, scoring depth, and improvement — computed across all recorded meets.</p>
          </div>
          <div class="export-row">
            <button class="xbtn" id="msm-export-all-csv" type="button"><i class="fa-solid fa-file-csv"></i> All Results CSV</button>
            <button class="xbtn" id="msm-export-athletes-csv" type="button"><i class="fa-solid fa-user-chart"></i> Athlete Analysis CSV</button>
            <button class="xbtn" id="msm-export-json" type="button"><i class="fa-solid fa-code"></i> Season JSON</button>
          </div>
        </div>
        ${insightCards}
        ${improversHtml}
        ${leaderboard}
      </section>`;
  }

  // =====================================================================
  //  EXPORTS
  // =====================================================================
  function exportAllResultsCSV() {
    if (!schoolResults || !schoolResults.length) return toast("No results to export yet.");
    const rows = [["Date", "Meet", "Athlete", "Gender", "Time", "Seconds", "Place", "PR"]];
    (performanceMeetsSorted || []).forEach((meet) => (meet.results || []).forEach((r) => {
      const t = secOf(r);
      const isPR = t != null && personalBestMap[athleteKey(r)] === t;
      rows.push([formatDateLong(meet.date), meet.meet_name, nameOf(r), (r.gender || "").toUpperCase(), formatTime(t || 0), t != null ? t.toFixed(2) : "", r.place || "", isPR ? "PR" : ""].map(csvCell));
    }));
    dl(`${schoolSlug}_all_results.csv`, "text/csv;charset=utf-8", rows.map((r) => r.join(",")).join("\n"));
    toast("✓ All results exported as CSV");
  }

  function exportAthleteAnalysisCSV() {
    const summaries = athleteSummaries();
    if (!summaries.length) return toast("No athlete data to export yet.");
    const rows = [["Athlete", "Gender", "Season Best", "Season Avg", "Races", "Meets", "Improvement (sec)"]];
    summaries.forEach((a) => {
      rows.push([a.name, a.gender, a.best != null ? formatTime(a.best) : "", a.avg != null ? formatTime(a.avg) : "", a.raceCount, a.meetCount, a.improvement != null ? a.improvement.toFixed(2) : ""].map(csvCell));
    });
    dl(`${schoolSlug}_athlete_analysis.csv`, "text/csv;charset=utf-8", rows.map((r) => r.join(",")).join("\n"));
    toast("✓ Athlete analysis exported as CSV");
  }

  function exportSeasonJSON() {
    const summaries = athleteSummaries();
    const ci = coachInsights(summaries);
    const payload = {
      school: (schoolObj && schoolObj.name) || schoolSlug,
      slug: schoolSlug,
      exported_at: new Date().toISOString(),
      coach_insights: {
        scoring5_avg_sec: ci.scoringAvg, spread_1_5_sec: ci.spread15,
        scoring_depth: ci.depth, pr_rate_pct: ci.prRate,
      },
      athletes: summaries.map((a) => ({
        name: a.name, gender: a.gender,
        season_best_sec: a.best, season_best: a.best != null ? formatTime(a.best) : null,
        season_avg_sec: a.avg, races: a.raceCount, meets: a.meetCount,
        improvement_sec: a.improvement,
      })),
    };
    dl(`${schoolSlug}_season.json`, "application/json", JSON.stringify(payload, null, 2));
    toast("✓ Season data exported as JSON");
  }

  // =====================================================================
  //  WIRE-UP
  // =====================================================================
  function inject() {
    if (document.getElementById("msm-analytics-section")) return; // already added
    // Insert before the roster section (4th section-block) or append to main
    const sections = document.querySelectorAll(".content-section .section-block");
    const rosterSection = Array.from(sections).find((s) => s.querySelector("#roster-grid, #roster-search"));
    const wrapper = document.createElement("div");
    wrapper.innerHTML = buildPanel();
    const panel = wrapper.firstElementChild;
    if (rosterSection && rosterSection.parentNode) {
      rosterSection.parentNode.insertBefore(panel, rosterSection);
    } else {
      const main = document.querySelector("main.content-section");
      if (main) main.appendChild(panel);
    }
    document.getElementById("msm-export-all-csv").addEventListener("click", exportAllResultsCSV);
    document.getElementById("msm-export-athletes-csv").addEventListener("click", exportAthleteAnalysisCSV);
    document.getElementById("msm-export-json").addEventListener("click", exportSeasonJSON);
  }

  window.MSMSchoolAnalytics = { exportAllResultsCSV, exportAthleteAnalysisCSV, exportSeasonJSON };

  // school.html dispatches MSMDataLoaded after all data + rendering is done.
  document.addEventListener("MSMDataLoaded", () => setTimeout(inject, 0));
})();
