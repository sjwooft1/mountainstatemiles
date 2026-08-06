// ============================================================
//  meet-analytics.js  —  Advanced Analysis & Export Module
//  Mountain State Miles / wvruns
//
//  Drop-in enhancement for CrossCountry/meet.html
//  Depends on globals already defined in meet.html:
//    allResults, currentMeetData, activeGender, activeRaceType,
//    currentFilteredResults, activeViewMode,
//    formatTime(), calculatePacePerMile(), formatGrade(),
//    slugify(), normalizeSchoolName(), calculateTeamScores()
//
//  Load AFTER the inline <script> in meet.html:
//    <script src="meet-analytics.js" defer></script>
// ============================================================

(function () {
  "use strict";

  const MILE_M = 1609.34;

  // ---- small helpers -------------------------------------------------
  const secOf = (r) => {
    const t = parseFloat(r && r.time);
    return isNaN(t) || t <= 0 ? null : t;
  };
  const nameOf = (r) => r.athlete_name || r.name || "Unknown";
  const schoolOf = (r) => normalizeSchoolName(r.school_name || r.school || "Unknown");
  const distanceOf = (list) =>
    list && list.length ? parseFloat(list[0].distance) || 5000 : 5000;

  // CSV cell escaping (handles commas, quotes, newlines)
  const csvCell = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const downloadFile = (content, filename, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const meetSlugName = () =>
    slugify((currentMeetData && currentMeetData.name) || "meet-results");

  // The field currently on screen (sorted like the render does)
  function currentRaceField() {
    let data = allResults.filter(
      (r) =>
        r.normalizedGender === activeGender &&
        r.normalizedRaceType === activeRaceType
    );
    data.sort((a, b) => {
      if (a.place && b.place) return parseInt(a.place) - parseInt(b.place);
      return parseFloat(a.time) - parseFloat(b.time);
    });
    return data;
  }

  // =====================================================================
  //  ANALYSIS ENGINE
  // =====================================================================

  // ---- Athlete-level metrics ----------------------------------------
  // percentile = % of field this athlete beat (higher = faster)
  function athleteMetrics(runner, field, distance) {
    const t = secOf(runner);
    const times = field.map(secOf).filter((x) => x != null).sort((a, b) => a - b);
    const n = times.length;
    let percentile = null,
      beat = null;
    if (t != null && n > 1) {
      beat = times.filter((x) => x > t).length;
      percentile = Math.round((beat / (n - 1)) * 100);
    }
    const paceSecPerMile = t != null ? (t / distance) * MILE_M : null;

    // Riegel projections (t2 = t1 * (d2/d1)^1.06) to common XC/road distances
    const proj = {};
    if (t != null) {
      [
        ["1600m", 1600],
        ["3200m", 3200],
        ["5000m", 5000],
        ["8000m", 8000],
        ["10000m", 10000],
      ].forEach(([label, d]) => {
        if (Math.abs(d - distance) < 1) return; // skip same distance
        proj[label] = t * Math.pow(d / distance, 1.06);
      });
    }
    return { time: t, percentile, beat, fieldSize: n, paceSecPerMile, proj };
  }

  // ---- Team / coach-level metrics -----------------------------------
  // Extends calculateTeamScores() with pack dynamics coaches care about.
  function teamAnalytics(field) {
    const scores = calculateTeamScores(field); // has score, teamAvg, teamSplit, athletes(top5)
    // regroup ALL finishers per team for depth + 1-7 view
    const byTeam = {};
    field.forEach((r) => {
      const s = schoolOf(r);
      (byTeam[s] = byTeam[s] || []).push(r);
    });

    return scores.map((team) => {
      const roster = (byTeam[team.school] || [])
        .slice()
        .sort(
          (a, b) => (a.scoringPlace || 999) - (b.scoringPlace || 999)
        );
      const top7 = roster.slice(0, 7);
      const times = top7.map(secOf).filter((x) => x != null);
      const t1 = times.length ? times[0] : null;
      const t5 = team.athletes.length === 5 ? secOf(team.athletes[4]) : null;
      // "displacers" = 6th & 7th runners who push other teams' scorers back
      const sixth = roster[5];
      const seventh = roster[6];
      // pack score: avg gap between consecutive top-5 (tighter = better)
      let packGap = null;
      if (team.athletes.length === 5) {
        const ft = team.athletes.map(secOf).filter((x) => x != null);
        if (ft.length === 5) {
          let g = 0;
          for (let i = 1; i < 5; i++) g += ft[i] - ft[i - 1];
          packGap = g / 4;
        }
      }
      return {
        ...team,
        depth: roster.length,
        top7,
        spread15: t1 != null && t5 != null ? t5 - t1 : null,
        avgPackGap: packGap,
        sixthName: sixth ? nameOf(sixth) : null,
        sixthPlaceNum: sixth ? sixth.scoringPlace || sixth.place : null,
        seventhName: seventh ? nameOf(seventh) : null,
        seventhPlaceNum: seventh ? seventh.scoringPlace || seventh.place : null,
      };
    });
  }

  // =====================================================================
  //  ADVANCED EXPORTS
  // =====================================================================

  // 1) Full meet CSV — every race, every gender, one file
  function exportFullMeetCSV() {
    if (!allResults || !allResults.length) return alert("No results loaded.");
    const rows = [
      [
        "Gender",
        "Race",
        "Place",
        "Athlete",
        "Grade",
        "School",
        "Time",
        "Seconds",
        "Pace/Mile",
        "ScoringPlace",
      ],
    ];
    const sorted = allResults.slice().sort((a, b) => {
      if (a.normalizedGender !== b.normalizedGender)
        return a.normalizedGender < b.normalizedGender ? -1 : 1;
      if (a.normalizedRaceType !== b.normalizedRaceType)
        return a.normalizedRaceType < b.normalizedRaceType ? -1 : 1;
      return (parseInt(a.place) || 999) - (parseInt(b.place) || 999);
    });
    // scoringPlace is per-race, so recompute per race group
    const groups = {};
    sorted.forEach((r) => {
      const k = r.normalizedGender + "|" + r.normalizedRaceType;
      (groups[k] = groups[k] || []).push(r);
    });
    Object.values(groups).forEach((g) => calculateTeamScores(g));

    sorted.forEach((r) => {
      const t = secOf(r);
      const dist = parseFloat(r.distance) || 5000;
      rows.push([
        r.normalizedGender === "M" ? "Boys" : "Girls",
        r.normalizedRaceType,
        r.place || "",
        nameOf(r),
        formatGrade(r.gradYear || r.grade),
        r.school_name || r.school || "",
        formatTime(t || 0),
        t != null ? t.toFixed(2) : "",
        calculatePacePerMile(t || 0, dist),
        r.scoringPlace || "",
      ].map(csvCell));
    });
    downloadFile(
      rows.map((r) => r.join(",")).join("\n"),
      `${meetSlugName()}_FULL_MEET.csv`,
      "text/csv;charset=utf-8"
    );
  }

  // 2) Coach sheet CSV — team standings + pack analytics for current race
  function exportCoachSheetCSV() {
    const field = currentRaceField();
    if (!field.length) return alert("No results in this race.");
    const teams = teamAnalytics(field);
    if (!teams.length)
      return alert("No scoring teams (need 5+ finishers) in this race.");

    const gender = activeGender === "M" ? "Boys" : "Girls";
    const rows = [
      [`# ${currentMeetData?.name || "Meet"} — ${gender} ${activeRaceType}`],
      [
        "Rank",
        "School",
        "Score",
        "Top5 Avg",
        "1-5 Split",
        "Avg Pack Gap",
        "Finishers",
        "6th (displacer)",
        "7th (displacer)",
      ],
    ];
    teams.forEach((t, i) => {
      rows.push([
        i + 1,
        t.school,
        t.score,
        formatTime(t.teamAvg),
        t.spread15 != null ? formatTime(t.spread15) : "-",
        t.avgPackGap != null ? formatTime(t.avgPackGap) : "-",
        t.depth,
        t.sixthName ? `${t.sixthName} (#${t.sixthPlaceNum})` : "-",
        t.seventhName ? `${t.seventhName} (#${t.seventhPlaceNum})` : "-",
      ].map(csvCell));
    });
    downloadFile(
      rows.map((r) => r.join(",")).join("\n"),
      `${meetSlugName()}_${slugify(gender)}_${slugify(activeRaceType)}_COACH_SHEET.csv`,
      "text/csv;charset=utf-8"
    );
  }

  // 3) Athlete analysis CSV — per-runner metrics for current filtered view
  function exportAthleteAnalysisCSV() {
    const field = currentRaceField();
    const view =
      currentFilteredResults && currentFilteredResults.length
        ? currentFilteredResults
        : field;
    if (!view.length) return alert("No athletes to export.");
    const distance = distanceOf(field);
    const rows = [
      [
        "Place",
        "Athlete",
        "School",
        "Grade",
        "Time",
        "Pace/Mile",
        "Percentile",
        "Beat N Runners",
        "Proj 1600m",
        "Proj 3200m",
        "Proj 5000m",
      ],
    ];
    view.forEach((r) => {
      const m = athleteMetrics(r, field, distance);
      rows.push([
        r.place || "",
        nameOf(r),
        r.school_name || r.school || "",
        formatGrade(r.gradYear || r.grade),
        formatTime(m.time || 0),
        m.paceSecPerMile != null ? formatTime(m.paceSecPerMile) : "-",
        m.percentile != null ? m.percentile + "%" : "-",
        m.beat != null ? m.beat : "-",
        m.proj["1600m"] ? formatTime(m.proj["1600m"]) : "-",
        m.proj["3200m"] ? formatTime(m.proj["3200m"]) : "-",
        m.proj["5000m"] ? formatTime(m.proj["5000m"]) : "-",
      ].map(csvCell));
    });
    downloadFile(
      rows.map((r) => r.join(",")).join("\n"),
      `${meetSlugName()}_${slugify(activeRaceType)}_ATHLETE_ANALYSIS.csv`,
      "text/csv;charset=utf-8"
    );
  }

  // 4) JSON export — structured data for the current race (for devs / imports)
  function exportRaceJSON() {
    const field = currentRaceField();
    if (!field.length) return alert("No results in this race.");
    const distance = distanceOf(field);
    const payload = {
      meet: currentMeetData?.name || null,
      date: currentMeetData?.date || null,
      location: currentMeetData?.location || null,
      gender: activeGender === "M" ? "Boys" : "Girls",
      race: activeRaceType,
      distance_m: distance,
      exported_at: new Date().toISOString(),
      teams: teamAnalytics(field).map((t) => ({
        school: t.school,
        score: t.score,
        top5_avg_sec: t.teamAvg,
        spread_1_5_sec: t.spread15,
        avg_pack_gap_sec: t.avgPackGap,
        finishers: t.depth,
      })),
      athletes: field.map((r) => {
        const m = athleteMetrics(r, field, distance);
        return {
          place: r.place ? parseInt(r.place) : null,
          name: nameOf(r),
          school: r.school_name || r.school || null,
          grade: formatGrade(r.gradYear || r.grade) || null,
          time_sec: m.time,
          time: formatTime(m.time || 0),
          pace_per_mile: m.paceSecPerMile ? formatTime(m.paceSecPerMile) : null,
          percentile: m.percentile,
        };
      }),
    };
    downloadFile(
      JSON.stringify(payload, null, 2),
      `${meetSlugName()}_${slugify(activeRaceType)}.json`,
      "application/json"
    );
  }

  // =====================================================================
  //  ANALYSIS PANEL (on-page, toggleable)
  // =====================================================================
  function fmtMaybe(sec) {
    return sec != null ? formatTime(sec) : "-";
  }

  function buildAnalysisHTML() {
    const field = currentRaceField();
    if (!field.length)
      return '<div style="padding:20px;text-align:center;color:var(--text-secondary);">No data for this race.</div>';

    const distance = distanceOf(field);
    const times = field.map(secOf).filter((x) => x != null).sort((a, b) => a - b);
    const n = times.length;
    const median = n ? (n % 2 ? times[(n - 1) / 2] : (times[n / 2 - 1] + times[n / 2]) / 2) : null;
    const avg = n ? times.reduce((s, t) => s + t, 0) / n : null;
    const teams = teamAnalytics(field);

    // Field summary cards
    let html = `
      <div class="app-list" style="margin-top:16px;">
        <div class="list-header">Race Analysis — ${activeGender === "M" ? "Boys" : "Girls"} ${activeRaceType}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;background:var(--border);">
          ${statCell("Finishers", n)}
          ${statCell("Winner", times.length ? formatTime(times[0]) : "-")}
          ${statCell("Median", fmtMaybe(median))}
          ${statCell("Average", fmtMaybe(avg))}
          ${statCell("Field Spread", times.length ? formatTime(times[n - 1] - times[0]) : "-")}
          ${statCell("Scoring Teams", teams.length)}
        </div>
      </div>`;

    // Coach view: team pack analytics
    if (teams.length) {
      html += `<div class="app-list"><div class="list-header">Coach View — Team Pack Dynamics</div>`;
      teams.forEach((t, i) => {
        html += `
          <div class="list-item">
            <div class="item-place">${i + 1}</div>
            <div class="item-details">
              <div class="item-name">${t.school} <span style="font-weight:600;color:var(--text-secondary);">· ${t.score} pts</span></div>
              <div class="item-meta">
                1–5 Split: <strong>${fmtMaybe(t.spread15)}</strong> ·
                Avg Gap: <strong>${fmtMaybe(t.avgPackGap)}</strong> ·
                Depth: <strong>${t.depth}</strong>
                ${t.sixthName ? `· 6th: ${t.sixthName}` : ""}
              </div>
            </div>
            <div class="item-score" style="font-size:0.95rem;">${fmtMaybe(t.teamAvg)}<br><span style="font-size:0.65rem;color:var(--text-tertiary);font-weight:600;">TOP-5 AVG</span></div>
          </div>`;
      });
      html += `</div>`;
    }

    // Athlete view: top movers by percentile + projections for leaders
    html += `<div class="app-list"><div class="list-header">Athlete View — Projections (Riegel)</div>
      <div class="list-header" style="text-transform:none;font-weight:600;color:var(--text-tertiary);">Equivalent times at other distances for the top 5 finishers</div>`;
    field.slice(0, 5).forEach((r) => {
      const m = athleteMetrics(r, field, distance);
      const p = m.proj;
      html += `
        <div class="list-item">
          <div class="item-place">${r.place || "-"}</div>
          <div class="item-details">
            <div class="item-name">${nameOf(r)}</div>
            <div class="item-meta">
              ${m.percentile != null ? `Top ${100 - m.percentile}% · ` : ""}
              1600m ${p["1600m"] ? formatTime(p["1600m"]) : "-"} ·
              3200m ${p["3200m"] ? formatTime(p["3200m"]) : "-"} ·
              8000m ${p["8000m"] ? formatTime(p["8000m"]) : "-"}
            </div>
          </div>
          <div class="item-score">${formatTime(m.time || 0)}</div>
        </div>`;
    });
    html += `</div>`;

    return html;
  }

  function statCell(label, value) {
    return `<div style="background:var(--bg-primary);padding:14px 10px;text-align:center;">
      <div style="font-size:1.25rem;font-weight:800;color:var(--text-primary);">${value}</div>
      <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;color:var(--text-tertiary);">${label}</div>
    </div>`;
  }

  let analysisOpen = false;
  function toggleAnalysis() {
    const box = document.getElementById("analysis-box");
    if (!box) return;
    analysisOpen = !analysisOpen;
    const btn = document.getElementById("btn-analysis");
    if (analysisOpen) {
      box.innerHTML = buildAnalysisHTML();
      box.style.display = "block";
      if (btn) btn.textContent = "📈 Hide Analysis";
    } else {
      box.style.display = "none";
      if (btn) btn.textContent = "📈 Analysis";
    }
  }

  // Refresh panel when the race selection changes, if it's open
  function refreshAnalysisIfOpen() {
    if (analysisOpen) {
      const box = document.getElementById("analysis-box");
      if (box) box.innerHTML = buildAnalysisHTML();
    }
  }

  // =====================================================================
  //  WIRE-UP: inject buttons + panel, patch render function
  // =====================================================================
  function injectUI() {
    const utilityBar = document.querySelector(".utility-bar");
    if (!utilityBar) return;

    // Replace single CSV/PDF with a richer export menu + analysis toggle
    const analysisBtn = document.createElement("button");
    analysisBtn.className = "action-btn";
    analysisBtn.id = "btn-analysis";
    analysisBtn.textContent = "📈 Analysis";
    analysisBtn.onclick = toggleAnalysis;

    // Export dropdown (native <select> styled as action-btn)
    const exportSel = document.createElement("select");
    exportSel.className = "action-btn";
    exportSel.style.outline = "none";
    exportSel.innerHTML = `
      <option value="">⬇ Export…</option>
      <option value="full">Full Meet CSV (all races)</option>
      <option value="coach">Coach Sheet CSV (team + pack)</option>
      <option value="athlete">Athlete Analysis CSV</option>
      <option value="json">Race JSON</option>`;
    exportSel.onchange = () => {
      switch (exportSel.value) {
        case "full": exportFullMeetCSV(); break;
        case "coach": exportCoachSheetCSV(); break;
        case "athlete": exportAthleteAnalysisCSV(); break;
        case "json": exportRaceJSON(); break;
      }
      exportSel.value = "";
    };

    utilityBar.appendChild(analysisBtn);
    utilityBar.appendChild(exportSel);

    // Panel container, placed above the results list
    const panel = document.createElement("div");
    panel.id = "analysis-box";
    panel.style.display = "none";
    const resultsBox = document.getElementById("results-box");
    resultsBox.parentNode.insertBefore(panel, resultsBox);

    // Patch renderTableForSelection so the panel stays in sync
    if (typeof window.renderTableForSelection === "function") {
      const orig = window.renderTableForSelection;
      window.renderTableForSelection = function () {
        orig.apply(this, arguments);
        refreshAnalysisIfOpen();
      };
    }
  }

  // Expose for inline onclick fallbacks if needed
  window.MSMAnalytics = {
    exportFullMeetCSV,
    exportCoachSheetCSV,
    exportAthleteAnalysisCSV,
    exportRaceJSON,
    toggleAnalysis,
  };

  // meet.html dispatches MSMDataLoaded after data + controls are ready
  document.addEventListener("MSMDataLoaded", () => {
    // small delay so the selector UI exists
    setTimeout(injectUI, 0);
  });
})();
