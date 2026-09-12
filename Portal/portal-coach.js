// ============================================================
//  portal-coach.js  —  Coach Toolkit
//  Mountain State Miles / wvruns
//
//  Extends the coach dashboard (rendered by portal-ui.js) with:
//    • Upcoming Meet Outlook — the meets ahead (with expected teams,
//      same source meet.html uses) and how your scoring 5 projects
//      against every likely opponent, statewide.
//    • Split Coach — a personal pacing plan per athlete, built from
//      their own Riegel exponent (how THEY fade, not an average).
//    • Mileage Plan Generator — a week-by-week build to a goal race
//      with down weeks, peak/taper, and day-by-day workouts anchored
//      to each athlete's training paces.
//
//  Depends on: window.MSMEngine (portal-engine.js), window.MSMAuth,
//  Chart.js, and #coachToolkit placeholders injected by portal-ui.js.
// ============================================================

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function E() { return window.MSMEngine; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function fmt(s) { return E().formatTime(s); }
  function clock(s) { return E().formatClock(s); }
  function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
  function cssUrl(u) { return String(u).replace(/["\\\n\r]/g, ""); }

  // Wire the toolkit for a coach profile + gender. Called on every dashboard
  // build — the markup is re-rendered each time, so handlers must be reattached.
  function init(profile, gender) {
    const root = $("coachToolkit");
    if (!root || typeof window.MSMEngine === "undefined") return;
    renderOutlook(profile, gender);
    renderSplitCoach(profile, gender);
    renderMileagePlan(profile, gender);
  }

  // =====================================================================
  //  1. UPCOMING MEET OUTLOOK
  // =====================================================================
  function renderOutlook(profile, gender) {
    const body = $("outlookBody");
    if (!body) return;
    const schoolSlug = profile.schoolSlug;
    const myName = (E().state.schoolsMap[schoolSlug] || {}).name || schoolSlug;

    // The engine snapshot already contains the meets records (including any
    // expected-teams lists) from the page load.
    const upcoming = E().listUpcomingMeets(10);
    if (!upcoming.length) {
      body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-calendar-days"></i><p>No upcoming meets on the calendar yet. Add meets (with a date) to see the outlook.</p></div>`;
      return;
    }

    body.innerHTML = upcoming.map((m, i) => {
      const d = new Date(m.date + "T00:00:00");
      const days = Math.round((d - new Date(new Date().toDateString())) / 86400000);
      const daysLabel = days === 0 ? "TODAY" : days === 1 ? "Tomorrow" : `in ${days} days`;
      const course = (E().state.coursesMap[m.course_slug] || {});
      const dist = course.distance ? parseInt(course.distance, 10) : 5000;
      const season = currentSeason();
      const mine = E().teamEntrants(schoolSlug, gender, season, m.course_slug, dist, "adjusted", null).slice(0, 7);
      const chips = (m.expected || []).map((t) =>
        `<a class="expected-team-chip" href="/CrossCountry/school.html?slug=${esc(t.slug)}" target="_blank" rel="noopener" title="Open ${esc(t.name)}">` +
        `<img src="/assets/team logos/${esc(t.slug)}.png" alt="" onerror="this.src='/assets/images/msmrunner.svg'">${esc(t.name)}</a>`).join("")
        || `<span class="section-sub">No expected-teams list on this meet record yet.</span>`;

      const rows = (m.expected || []).filter((t) => t.slug !== schoolSlug).map((t) => {
        const opp = E().teamEntrants(t.slug, gender, season, m.course_slug, dist, "adjusted", null);
        if (opp.length < 5) return `<tr><td data-label="Team">${esc(t.name)}</td><td colspan="5" class="section-sub">Fewer than 5 projected runners — incomplete</td></tr>`;
        const sim = E().simulateMeet({ teamList: [{ schoolSlug }, { schoolSlug: t.slug }], gender, season, courseSlug: m.course_slug, basis: "adjusted" });
        const me = sim.teams.find((x) => x.schoolSlug === schoolSlug);
        const them = sim.teams.find((x) => x.schoolSlug === t.slug);
        if (!me || !them || me.score == null || them.score == null) return `<tr><td data-label="Team">${esc(t.name)}</td><td colspan="5" class="section-sub">Can't project a full dual score yet</td></tr>`;
        const diff = me.score - them.score; // negative = we win
        const verdict = diff < 0
          ? `<span class="pill up">Win by ${-diff}</span>`
          : diff > 0
            ? `<span class="pill down">Lose by ${diff}</span>`
            : `<span class="pill flat">Tie</span>`;
        // Their scoring 5 vs our scoring 5 — where the meet is decided.
        const pairs = me.top5.map((r, k) => ({ mine: r, theirs: them.top5[k] }));
        const decidedBy = pairs.filter((p) => p.theirs && (p.mine.scoringPlace - p.theirs.scoringPlace) !== 0);
        const keyRace = decidedBy.length ? decidedBy[0] : null;
        return `<tr>
          <td data-label="Team"><a href="/CrossCountry/school.html?slug=${esc(t.slug)}" target="_blank" rel="noopener" style="color:inherit;font-weight:600;">${esc(t.name)}</a></td>
          <td data-label="Projected">${verdict} <span class="section-sub">${me.score}–${them.score}</span></td>
          <td data-label="Their Top 5 Avg" class="mark-col">${them.teamAvg != null ? fmt(them.teamAvg) : "—"}</td>
          <td data-label="Their 1–5 Spread">${them.spread15 != null ? fmt(them.spread15) : "—"}</td>
          <td data-label="Depth">${them.depth}</td>
          <td data-label="Key matchup">${keyRace ? `Our #${keyRace.mine.scoringPlace} vs their #${keyRace.theirs.scoringPlace}` : "—"}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="6" class="section-sub">No opponents listed on the meet record.</td></tr>`;

      const myTop5 = mine.slice(0, 5);
      return `<div class="card outlook-meet" style="margin-bottom:16px;">
        <div class="outlook-meet-head">
          <div>
            <div class="outlook-meet-name">${esc(m.name)}${i === 0 ? ' <span class="pill up" style="font-size:0.6rem;">NEXT UP</span>' : ""}</div>
            <div class="outlook-meet-meta">${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${esc(daysLabel)}${m.location ? " · " + esc(m.location) : ""}${course.name ? " · " + esc(course.name) : " · course TBD"}</div>
          </div>
          <div class="outlook-mylineup">
            <div class="stat-lbl">Your projected 7</div>
            <div class="outlook-seven">${mine.length ? mine.map((r, k) => `<span class="outlook-seven-item">${k < 5 ? `<strong>${k + 1}</strong>` : k + 1} ${esc(r.name)} <small>${fmt(r.timeSec)}</small></span>`).join("") : `<span class="section-sub">No runners with a projection yet.</span>`}</div>
          </div>
        </div>
        <div class="section-sub" style="margin:10px 0 6px;"><strong>${(m.expected || []).length} expected teams</strong> — from the meet record, same as meet.html.</div>
        <div class="expected-teams-list">${chips}</div>
        <div class="table-card" style="margin-top:12px;"><table class="rt">
          <thead><tr><th>Opponent</th><th>Projected dual</th><th>Their Top 5 Avg</th><th>Their 1–5 Spread</th><th>Depth</th><th>Key matchup</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="section-sub" style="margin-top:8px;">Duals project each opponent head-to-head against ${esc(myName)} on ${esc(course.name || "the meet course")} at ${E().distanceLabel(dist)}, course-adjusted times, ${season === "all" ? "all-time bests" : season + " season"}. Add the meet to your Meet Simulator below for a full multi-team score.</div>
      </div>`;
    }).join("");
  }

  // =====================================================================
  //  2. SPLIT COACH
  // =====================================================================
  function renderSplitCoach(profile, gender) {
    const sel = $("split-athlete");
    const body = $("splitBody");
    if (!sel || !body) return;
    const roster = E().rosterForSchool(profile.schoolSlug, gender, currentSeason()).filter((s) => s.best5k);
    sel.innerHTML = roster.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");

    const draw = () => {
      const s = roster.find((x) => x.name === sel.value) || roster[0];
      if (!s) { body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-stopwatch"></i><p>No runners with results yet.</p></div>`; return; }
      const dist = E().state.coursesMap[courseSelValue()] ? parseInt(E().state.coursesMap[courseSelValue()].distance, 10) : 5000;
      const courseSlug = courseSelValue();
      const courseName = (E().state.coursesMap[courseSlug] || {}).name || "goal race";
      const goalInput = $("split-goal");
      const plan = E().splitPlan(s, { distance: dist, goalTimeSec: goalInput && goalInput.value ? Number(goalInput.value) : null });
      if (!plan) { body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-stopwatch"></i><p>Not enough data for ${esc(s.name)}.</p></div>`; return; }

      const goalStr = fmt(plan.goalTimeSec);
      const stratRows = plan.strategy.map((seg) => {
        const delta = seg.paceSec - plan.evenKm;
        const dLabel = Math.abs(delta) < 0.5 ? "even" : `${delta > 0 ? "+" : "−"}${Math.abs(Math.round(delta))}s /km`;
        return `<div class="split-row"><span class="split-label">${esc(seg.label)}</span><span class="split-val">${fmt(seg.paceSec)}</span><span class="split-tag pill ${seg.tag === "Kick" || seg.tag === "Aggressive" ? "up" : "flat"}">${esc(seg.tag)} · ${dLabel}</span></div>`;
      }).join("");

      body.innerHTML = `
        <div class="card">
          <div style="font-weight:800;margin-bottom:2px;">${esc(s.name)} <span class="section-sub">· best MSM ${s.bestMsm ?? "—"} · exponent ${plan.exponent.toFixed(2)}</span></div>
          <div class="section-sub" style="margin-bottom:12px;">Goal ${goalStr} for ${E().distanceLabel(plan.distance)} on ${esc(courseName)} — even pace is <strong>${clock(plan.evenPaceMileSec)}/mi</strong> (${fmt(plan.evenKm)}/km).</div>
          <div class="tip tip-neutral"><span class="tip-tag">Read</span><span>${esc(plan.note)}</span></div>
          <div class="split-grid">${stratRows}</div>
          <div class="section-sub" style="margin:12px 0 6px;">Cumulative checkpoints (pass each mark at…)</div>
          <div class="split-checks">${plan.checkpoints.map((c) => `<span class="split-check"><strong>${c.km} km</strong> ${fmt(c.cumSec)}</span>`).join("")}</div>
          <div class="section-sub" style="margin-top:10px;">Built from ${esc(s.name)}'s own PB curve — a personal Riegel exponent, not a population average. Set a different goal above to regenerate.</div>
        </div>`;
    };

    sel.onchange = draw;
    const goal = $("split-goal");
    if (goal) goal.oninput = () => { clearTimeout(goal._t); goal._t = setTimeout(draw, 400); };
    const courseSel = $("split-course");
    if (courseSel) courseSel.onchange = draw;
    draw();
  }
  // helper: current value of the split-coach course select ("" = default 5K)
  function courseSelValue() {
    const sel = $("split-course");
    return sel ? sel.value : "";
  }

  // =====================================================================
  //  3. MILEAGE PLAN GENERATOR
  // =====================================================================
  function renderMileagePlan(profile, gender) {
    const btn = $("mp-generate");
    const body = $("mpBody");
    if (!btn || !body) return;

    const roster = () => E().rosterForSchool(profile.schoolSlug, gender, currentSeason()).filter((s) => s.best5k);

    btn.onclick = () => {
      const pacesFor = $("mp-anchor").value === "scorer"
        ? ((roster()[0] || {}).paces || null)
        : ($("mp-athlete").value ? ((roster().find((s) => s.name === $("mp-athlete").value) || {}).paces || null) : null);
      const plan = E().mileagePlan({
        currentMiles: $("mp-current").value,
        peakMiles: $("mp-peak").value,
        daysPerWeek: $("mp-days").value,
        goalDate: $("mp-date").value,
        raceName: $("mp-race").value,
        paces: pacesFor,
      });
      if (!plan) { body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn't build a plan — check the dates (goal must be within ~30 weeks).</p></div>`; return; }

      // Summary chart: weekly miles.
      const c = chartTheme();
      const card = document.createElement("canvas");
      card.id = "mpChart";
      const html = `
        <div class="stat-grid" style="margin-bottom:14px;">
          <div class="stat-card hl"><div class="stat-lbl">Weeks to Race</div><div class="stat-val">${plan.weeks.length}</div><div class="stat-sub">${esc(plan.raceName)}</div></div>
          <div class="stat-card"><div class="stat-lbl">Peak Week</div><div class="stat-val">${plan.peakMiles}</div><div class="stat-sub">3 weeks before race day</div></div>
          <div class="stat-card"><div class="stat-lbl">Total Volume</div><div class="stat-val">${plan.totalMiles}</div><div class="stat-sub">miles across the plan</div></div>
        </div>
        <div class="chart-card" style="margin-bottom:14px;"><div class="chart-card-head"><div><div class="chart-card-title">Weekly Mileage Build</div><div class="chart-card-sub">Down weeks shaded lighter</div></div></div><div class="chart-wrap" style="height:180px;"><canvas id="mpChart"></canvas></div></div>
        <div class="mp-weeks">${plan.weeks.map((w) => `
          <div class="mp-week mp-${w.phase.toLowerCase()}">
            <div class="mp-week-head">
              <span class="mp-week-n">Wk ${w.n}</span>
              <span class="pill ${w.phase === "Race" ? "down" : w.phase === "Taper" ? "flat" : "up"}">${w.phase}</span>
              <span class="mp-week-total">${w.total} mi</span>
              <span class="section-sub">week of ${esc(w.startISO)}</span>
            </div>
            <div class="mp-days">${w.days.map((d) => `
              <div class="mp-day ${d.type === "Rest" ? "mp-rest" : d.type.startsWith("Quality") ? "mp-quality" : d.type === "RACE" ? "mp-race" : d.type === "Pre-race" ? "mp-prerace" : "mp-easy"}">
                <span class="mp-day-name">${esc(d.day.slice(0, 3))}</span>
                <span class="mp-day-type">${esc(d.type)}</span>
                <span class="mp-day-miles">${d.miles ? d.miles + " mi" : "—"}</span>
                ${d.desc ? `<span class="mp-day-desc">${esc(d.desc)}</span>` : ""}
              </div>`).join("")}</div>
          </div>`).join("")}</div>
        <div class="section-sub" style="margin-top:10px;">${esc(plan.assumptions)}${pacesFor ? " Workout paces anchored to your top scorer's training zones." : " Add a top scorer to anchor workout paces to their training zones."}</div>`;

      body.innerHTML = html;
      const theme = c;
      const labels = plan.weeks.map((w) => "W" + w.n);
      const data = plan.weeks.map((w) => w.total);
      const colors = plan.weeks.map((w) => w.phase === "Peak" ? theme.line : w.phase === "Build" ? theme.fill : "rgba(150,150,150,0.35)");
      const opts = baseOptsCompat("Miles", "Week");
      opts.scales.x.ticks.font = { size: 9 };
      new Chart($("mpChart"), { type: "bar", data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: theme.line, borderWidth: 1.5, borderRadius: 4 }] }, options: opts });
      $("mpChart").scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    // Populate the anchor-athlete select once.
    const anchor = $("mp-athlete");
    if (anchor && !anchor.dataset.populated) {
      anchor.innerHTML = '<option value="">— pick a runner —</option>' + roster().map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
      anchor.dataset.populated = "1";
    }
  }

  // =====================================================================
  //  shared helpers
  // =====================================================================
  function currentSeason() {
    // Keep the toolkit in sync with the season filter rendered by portal-ui.js.
    const sel = $("seasonSelect");
    return sel && sel.value ? sel.value : "all";
  }
  function chartTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      grid: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
      text: dark ? "#808080" : "#999",
      line: dark ? "#fff" : "#000",
      fill: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    };
  }
  // Mirror of portal-ui.js's baseOpts (kept local so this file stays standalone).
  function baseOptsCompat(yTitle, xTitle, reverseY) {
    const c = chartTheme();
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#000", titleColor: "#fff", bodyColor: "#ddd", cornerRadius: 6, padding: 10, displayColors: false } },
      scales: {
        x: { title: { display: !!xTitle, text: xTitle, color: c.text }, ticks: { color: c.text, font: { size: 10 }, maxRotation: 40 }, grid: { color: c.grid } },
        y: { reverse: !!reverseY, title: { display: !!yTitle, text: yTitle, color: c.text }, ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid } },
      },
    };
  }

  window.MSMCoach = { init };
})();
