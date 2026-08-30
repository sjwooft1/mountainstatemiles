// ============================================================
//  portal-ui.js  —  Portal controller (auth gate, onboarding, dashboards)
//  Mountain State Miles / wvruns
//
//  Depends on: portal-engine.js (window.MSMEngine), portal-auth.js
//  (window.MSMAuth), Chart.js, jsPDF (+autotable), and portal.html markup.
// ============================================================

(function () {
  "use strict";

  const E = () => window.MSMEngine;
  const A = () => window.MSMAuth;
  const $ = (id) => document.getElementById(id);
  const charts = {};

  // Global season filter, shared across every dashboard. "all" = all-time.
  // Defaults to the most recent season with data once the engine loads.
  let currentSeason = "all";
  let seasonInitialized = false;

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = msg;
    $("toastTray").appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function fmt(s) { return E().formatTime(s); }
  function clock(s) { return E().formatClock(s); }
  function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
  function dl(name, type, content) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); }
  function csvRow(cells) { return cells.map((c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(","); }

  // ---------- view switching ----------
  const views = ["authGate", "onboard", "dash"];
  function show(view) { views.forEach((v) => $(v).classList.toggle("hidden", v !== view)); }

  // =====================================================================
  //  AUTH GATE
  // =====================================================================
  let authMode = "signin";
  function wireAuth() {
    const setMode = (m) => {
      authMode = m;
      $("tabSignIn").classList.toggle("active", m === "signin");
      $("tabSignUp").classList.toggle("active", m === "signup");
      $("nameField").style.display = m === "signup" ? "" : "none";
      $("authSubmit").innerHTML = m === "signup"
        ? '<i class="fa-solid fa-user-plus"></i> Create Account'
        : '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
      msg("");
    };
    const msg = (t, cls) => { const el = $("authMsg"); el.textContent = t; el.className = "auth-msg" + (cls ? " " + cls : ""); };

    $("tabSignIn").onclick = () => setMode("signin");
    $("tabSignUp").onclick = () => setMode("signup");

    $("authSubmit").onclick = async () => {
      const username = $("authUser").value.trim();
      const pass = $("authPass").value;
      const name = $("authName").value.trim();
      if (!username || !pass) return msg("Enter your username and password.", "err");
      $("authSubmit").disabled = true;
      try {
        if (authMode === "signup") await A().signUp(username, pass, name);
        else await A().signIn(username, pass);
      } catch (e) { msg((e && e.message) || "Something went wrong.", "err"); }
      finally { $("authSubmit").disabled = false; }
    };
  }

  // =====================================================================
  //  ONBOARDING
  // =====================================================================
  let obRole = null, obAthlete = null;
  function wireOnboard() {
    $("roleGrid").querySelectorAll(".role-card").forEach((card) => {
      card.onclick = () => {
        obRole = card.dataset.role;
        $("roleGrid").querySelectorAll(".role-card").forEach((c) => c.classList.toggle("sel", c === card));
        $("onboardDetails").classList.remove("hidden");
        $("onboardAthlete").classList.toggle("hidden", obRole !== "athlete");
        $("onboardCoach").classList.toggle("hidden", obRole !== "coach");
        $("onboardFan").classList.toggle("hidden", obRole !== "fan");
        if (obRole === "coach") fillSchoolSelect($("obSchoolSelect"));
      };
    });

    typeahead($("obAthleteInput"), $("obAthleteDrop"), () => E().listAthleteNames(), (item) => {
      obAthlete = item; $("obAthleteInput").value = item.name;
    });

    $("obSave").onclick = async () => {
      if (!obRole) return toast("Pick a role first.");
      const patch = { role: obRole };
      if (obRole === "athlete") {
        if (!obAthlete) return toast("Select your athlete name.");
        patch.athleteName = obAthlete.name;
        patch.schoolSlug = obAthlete.school_slug || "";
        patch.gender = obAthlete.gender || "";
      } else if (obRole === "coach") {
        patch.schoolSlug = $("obSchoolSelect").value;
        if (!patch.schoolSlug) return toast("Select your school.");
      }
      try { await A().saveProfile(patch); toast("✓ Profile saved"); }
      catch (e) { toast("Couldn't save: " + (e.message || e.code)); }
    };
  }

  function fillSchoolSelect(sel) {
    const schools = E().listSchools();
    sel.innerHTML = '<option value="">Select a school…</option>' +
      schools.map((s) => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join("");
  }

  // generic typeahead
  function typeahead(input, drop, getItems, onPick) {
    let items = [], hl = -1;
    const render = (q) => {
      const nq = q.toLowerCase();
      items = getItems().filter((it) => it.name.toLowerCase().includes(nq)).slice(0, 40);
      drop.innerHTML = items.map((it, i) =>
        `<div class="ta-item" data-i="${i}">${esc(it.name)}${it.school_slug ? ` <small>· ${esc(it.school_slug)}</small>` : ""}</div>`).join("")
        || '<div class="ta-item"><small>No matches</small></div>';
      drop.classList.add("open"); hl = -1;
      drop.querySelectorAll(".ta-item[data-i]").forEach((el) => {
        el.onclick = () => { onPick(items[+el.dataset.i]); drop.classList.remove("open"); };
      });
    };
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("focus", () => { if (input.value) render(input.value); });
    input.addEventListener("keydown", (e) => {
      const els = drop.querySelectorAll(".ta-item[data-i]");
      if (e.key === "ArrowDown") { hl = Math.min(hl + 1, els.length - 1); }
      else if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); }
      else if (e.key === "Enter" && hl >= 0 && items[hl]) { onPick(items[hl]); drop.classList.remove("open"); return; }
      else return;
      els.forEach((el, i) => el.classList.toggle("hl", i === hl));
      e.preventDefault();
    });
    document.addEventListener("click", (e) => { if (!drop.contains(e.target) && e.target !== input) drop.classList.remove("open"); });
  }

  // =====================================================================
  //  CHART HELPERS
  // =====================================================================
  function chartTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      grid: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
      text: dark ? "#808080" : "#999",
      line: dark ? "#fff" : "#000",
      fill: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    };
  }
  function baseOpts(yTitle, xTitle, reverseY) {
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
  function makeChart(id, cfg) { if (charts[id]) charts[id].destroy(); const el = $(id); if (!el) return; charts[id] = new Chart(el, cfg); }
  function destroyCharts() { Object.keys(charts).forEach((k) => { charts[k].destroy(); delete charts[k]; }); }

  // =====================================================================
  //  DASHBOARD ROUTER
  // =====================================================================
  function renderDash(profile) {
    destroyCharts();
    const role = profile.role;
    $("dashActions").innerHTML = "";
    const roleChip = { athlete: "Athlete", coach: "Coach", fan: "Fan" }[role] || "Member";
    $("dashChips").innerHTML =
      `<span class="hero-chip"><i class="fa-solid fa-id-badge"></i>${roleChip}</span>` +
      `<span class="hero-chip"><i class="fa-solid fa-user"></i>${esc((A().user && A().user.username) || "")}</span>`;

    // Default season to the newest one with data (first render only).
    if (!seasonInitialized) {
      const seasons = E().listSeasons();
      if (seasons.length) currentSeason = String(seasons[0]);
      seasonInitialized = true;
    }
    addSeasonSelect(profile);
    addAction("switch", '<i class="fa-solid fa-repeat"></i> Change Role', () => { show("onboard"); resetOnboard(); });
    addAction("signout", '<i class="fa-solid fa-arrow-right-from-bracket"></i> Sign Out', () => A().signOut());

    if (role === "athlete") renderAthlete(profile);
    else if (role === "coach") renderCoach(profile);
    else renderFan(profile);
  }
  function addSeasonSelect(profile) {
    const seasons = E().listSeasons();
    const sel = document.createElement("select");
    sel.className = "plain-select";
    sel.id = "seasonSelect";
    sel.title = "Season";
    sel.innerHTML = `<option value="all">All-Time</option>` +
      seasons.map((y) => `<option value="${y}">${y} Season</option>`).join("");
    sel.value = currentSeason;
    sel.onchange = () => { currentSeason = sel.value; renderDash(profile); };
    $("dashActions").appendChild(sel);
  }
  function addAction(id, html, fn) { const b = document.createElement("button"); b.className = "xbtn"; b.innerHTML = html; b.onclick = fn; $("dashActions").appendChild(b); }
  function resetOnboard() { obRole = null; obAthlete = null; $("onboardDetails").classList.add("hidden"); $("roleGrid").querySelectorAll(".role-card").forEach((c) => c.classList.remove("sel")); }

  // =====================================================================
  //  ATHLETE DASHBOARD
  // =====================================================================
  function renderAthlete(profile) {
    const sum = E().athleteSummary(profile.athleteName, currentSeason);
    $("dashTitle").textContent = profile.athleteName || "Athlete";
    if (!sum) {
      $("dashSub").textContent = "";
      $("dashBody").innerHTML = `<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i><p>No results for “${esc(profile.athleteName)}”${currentSeason !== "all" ? ` in the ${currentSeason} season` : ""}. Try a different season, or Change Role to reselect your name.</p></div>`;
      return;
    }
    const rank = E().stateRank(sum.name, sum.gender, currentSeason);
    const genderLabel = sum.gender === "M" ? "Boys" : sum.gender === "F" ? "Girls" : "";
    const schoolsText = sum.schools.length > 1
      ? sum.schools.map((s) => esc(s.name)).join(" → ")
      : (sum.schools[0] ? esc(sum.schools[0].name) : "");
    $("dashSub").textContent = `${genderLabel ? genderLabel + " · " : ""}${schoolsText ? schoolsText + " · " : ""}${sum.raceCount} races · ${sum.meetCount} meets`;

    const fc = sum.forecast;
    const trendPill = fc ? `<span class="pill ${fc.trend === "improving" ? "up" : fc.trend === "declining" ? "down" : "flat"}">${fc.trend}</span>` : "";

    $("dashBody").innerHTML = `
      <section class="section-block">
        <div class="section-head"><div><h2 class="section-heading">Season Snapshot</h2></div>
          <div class="export-row">
            <button class="xbtn" id="ath-csv"><i class="fa-solid fa-file-csv"></i> Results CSV</button>
            <button class="xbtn" id="ath-json"><i class="fa-solid fa-code"></i> JSON</button>
            <button class="xbtn" id="ath-pdf"><i class="fa-solid fa-file-pdf"></i> PDF Report</button>
            <button class="xbtn" id="ath-png"><i class="fa-solid fa-image"></i> Chart PNG</button>
          </div>
        </div>
        <div class="stat-grid">
          <div class="stat-card hl"><div class="stat-lbl">Best MSM Rating</div><div class="stat-val">${sum.bestMsm ?? "—"}</div><div class="stat-sub">Course + field adjusted</div></div>
          <div class="stat-card hl"><div class="stat-lbl">${genderLabel || ""} State Rank</div><div class="stat-val">${rank ? rank.rank + `<span style="font-size:1rem;vertical-align:super;">${ordinal(rank.rank)}</span>` : "—"}</div><div class="stat-sub">${rank ? "of " + rank.total : ""}</div></div>
          <div class="stat-card"><div class="stat-lbl">5K Equivalent</div><div class="stat-val">${sum.best5k ? fmt(E().riegel(sum.best5k.timeSec, sum.best5k.distance, 5000)) : "—"}</div><div class="stat-sub">From best effort</div></div>
          <div class="stat-card"><div class="stat-lbl">Trajectory</div><div class="stat-val" style="font-size:1.3rem;">${trendPill || "—"}</div><div class="stat-sub">${fc ? (fc.slopePerWeek > 0 ? "−" : "+") + Math.abs(fc.slopePerWeek).toFixed(1) + " pts/wk" : "Need 2+ races"}</div></div>
        </div>
      </section>

      <section class="section-block">
        <div class="section-head"><div><h2 class="section-heading">Performance</h2><p class="section-sub">Race-time progression and rating trend over the season.</p></div></div>
        <div class="charts-grid">
          <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Time Progression</div><div class="chart-card-sub">Lower = faster</div></div><select class="event-select" id="ath-dist"></select></div><div class="chart-wrap"><canvas id="chartProg"></canvas></div></div>
          <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">MSM Rating Trend + Forecast</div><div class="chart-card-sub">Dashed = 3-week projection</div></div></div><div class="chart-wrap"><canvas id="chartRating"></canvas></div></div>
          <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Personal Bests by Distance</div></div></div><div class="chart-wrap"><canvas id="chartPB"></canvas></div></div>
          <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Race Predictions (Riegel)</div><div class="chart-card-sub">Equivalent times at other distances</div></div></div><div class="chart-wrap"><canvas id="chartPred"></canvas></div></div>
        </div>
      </section>

      <section class="section-block">
        <div class="section-head"><div><h2 class="section-heading">Race Predictions</h2><p class="section-sub">Projected from your best effort using the Riegel model.</p></div>
          <div class="export-row"><button class="xbtn" id="pred-csv"><i class="fa-solid fa-file-csv"></i> Predictions CSV</button></div></div>
        <div class="table-card"><table class="rt"><thead><tr><th>Distance</th><th>Predicted Time</th><th>Pace / Mile</th></tr></thead><tbody id="predBody"></tbody></table></div>
      </section>

      <section class="section-block">
        <div class="section-head"><div><h2 class="section-heading">Training Paces</h2><p class="section-sub">Zones derived from your ${sum.best5k ? E().distanceLabel(sum.best5k.distance) : "best"} effort. Guidance only — pair with your coach's plan.</p></div></div>
        <div class="pace-grid" id="paceGrid"></div>
      </section>

      <section class="section-block">
        <div class="section-head"><div><h2 class="section-heading">All Results</h2></div></div>
        <div class="table-card"><table class="rt"><thead><tr><th>Date</th><th>Meet</th><th>Division</th><th>Time</th><th>MSM</th><th>Place</th></tr></thead><tbody id="resBody"></tbody></table></div>
      </section>
    `;

    // distance select
    const dists = [...new Set(sum.rows.map((r) => Number(r.distance)).filter((v) => v))].sort((a, b) => a - b);
    $("ath-dist").innerHTML = dists.map((d) => `<option value="${d}">${E().distanceLabel(d)}</option>`).join("");
    const drawProg = () => athProgChart(sum, Number($("ath-dist").value));
    $("ath-dist").onchange = drawProg;
    drawProg();
    athRatingChart(sum);
    athPBChart(sum);
    athPredChart(sum);

    // predictions table
    $("predBody").innerHTML = (sum.predictions || []).map((p) =>
      `<tr><td>${p.label}</td><td class="mark-col">${fmt(p.seconds)}</td><td>${clock((p.seconds / p.distance) * E().MILE_M)}</td></tr>`).join("")
      || `<tr><td colspan="3" style="text-align:center;padding:1.5rem;">Not enough data.</td></tr>`;

    // paces
    renderPaces(sum.paces);

    // results table
    $("resBody").innerHTML = sum.rows.map((r) => {
      const distKey = String(Math.round(Number(r.distance)));
      const isPB = sum.pbs[distKey] && sum.pbs[distKey].timeSec === r.timeSec;
      return `<tr>
        <td>${r.date ? new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
        <td>${esc(r.meet?.name || r.meet_slug || "—")}</td>
        <td>${esc(r.race_type || "—")}</td>
        <td class="mark-col">${fmt(r.timeSec)}${isPB ? ' <span class="pill up" style="font-size:0.6rem;">PB</span>' : ""}</td>
        <td>${r.msm ?? "—"}</td>
        <td>${r.place ? r.place + ordinal(r.place) : "—"}</td>
      </tr>`;
    }).join("");

    // exports
    $("ath-csv").onclick = () => {
      const rows = [["Date", "Meet", "Division", "Time", "Seconds", "MSM", "Place"]];
      sum.rows.forEach((r) => rows.push([r.date ? new Date(r.date).toLocaleDateString() : "", r.meet?.name || r.meet_slug || "", r.race_type || "", fmt(r.timeSec), r.timeSec ?? "", r.msm ?? "", r.place ?? ""]));
      dl(`${E().slugify(sum.name)}_results.csv`, "text/csv", rows.map(csvRow).join("\n")); toast("✓ Results CSV");
    };
    $("ath-json").onclick = () => {
      dl(`${E().slugify(sum.name)}_profile.json`, "application/json", JSON.stringify({
        name: sum.name, gender: sum.gender, best_msm: sum.bestMsm, state_rank: rank,
        pbs: Object.values(sum.pbs).map((p) => ({ distance: p.distance, time: fmt(p.timeSec), seconds: p.timeSec })),
        predictions: sum.predictions, training_paces_sec_per_mile: sum.paces, forecast: sum.forecast,
        results: sum.rows.map((r) => ({ date: r.date, meet: r.meet?.name, division: r.race_type, seconds: r.timeSec, msm: r.msm, place: r.place })),
      }, null, 2)); toast("✓ JSON exported");
    };
    $("ath-pdf").onclick = () => athletePDF(sum, rank);
    $("ath-png").onclick = () => exportPNG("chartProg", `${E().slugify(sum.name)}_progression.png`);
    $("pred-csv").onclick = () => {
      const rows = [["Distance", "Predicted Time", "Seconds", "Pace/Mile"]];
      (sum.predictions || []).forEach((p) => rows.push([p.label, fmt(p.seconds), p.seconds.toFixed(1), clock((p.seconds / p.distance) * E().MILE_M)]));
      dl(`${E().slugify(sum.name)}_predictions.csv`, "text/csv", rows.map(csvRow).join("\n")); toast("✓ Predictions CSV");
    };
  }

  function renderPaces(paces) {
    if (!paces) { $("paceGrid").innerHTML = '<p class="section-sub">Not enough data to compute paces.</p>'; return; }
    const zones = [
      ["z-easy", "Easy", paces.easy, "Recovery & base miles"],
      ["z-marathon", "Steady", paces.marathon, "Long-run / marathon effort"],
      ["z-threshold", "Threshold", paces.threshold, "Tempo / comfortably hard"],
      ["z-interval", "Interval", paces.interval, "VO₂max, ~3–5K effort"],
      ["z-rep", "Repetition", paces.repetition, "Speed / mile pace"],
    ];
    $("paceGrid").innerHTML = zones.map(([cls, name, val, desc]) =>
      `<div class="pace-card ${cls}"><div class="pace-name">${name}</div><div class="pace-val">${clock(val)}</div><div class="pace-desc">${desc} / mi</div></div>`).join("");
  }

  function athProgChart(sum, dist) {
    const pts = sum.rows.filter((r) => r.timeSec != null && r.date && (!dist || Number(r.distance) === dist))
      .map((r) => ({ x: r.date, y: r.timeSec, meet: r.meet?.name || r.meet_slug })).sort((a, b) => a.x.localeCompare(b.x));
    const c = chartTheme();
    const opts = baseOpts("Time", "Meet Date", true);
    opts.scales.y.ticks.callback = (v) => fmt(v);
    opts.plugins.tooltip.callbacks = { title: (ctx) => pts[ctx[0].dataIndex]?.meet || "", label: (ctx) => "Time: " + fmt(pts[ctx.dataIndex].y) };
    makeChart("chartProg", { type: "line", data: { labels: pts.map((p) => new Date(p.x).toLocaleDateString("en-US", { month: "short", day: "numeric" })), datasets: [{ data: pts.map((p) => p.y), borderColor: c.line, backgroundColor: c.fill, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.3, fill: true }] }, options: opts });
  }

  function athRatingChart(sum) {
    const pts = sum.datedRatings.slice().sort((a, b) => a.date.localeCompare(b.date));
    const c = chartTheme();
    const labels = pts.map((p) => new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    const data = pts.map((p) => p.rating);
    const datasets = [{ label: "MSM Rating", data, borderColor: c.line, backgroundColor: c.fill, borderWidth: 2, pointRadius: 4, tension: 0.25, fill: true }];
    if (sum.forecast && pts.length >= 2) {
      const proj = data.map(() => null); proj[proj.length - 1] = data[data.length - 1];
      labels.push("+3wk"); proj.push(sum.forecast.projectedRating); data.push(null);
      datasets[0].data = data;
      datasets.push({ label: "Forecast", data: proj, borderColor: c.line, borderDash: [6, 4], borderWidth: 2, pointRadius: 4, pointStyle: "triangle", fill: false });
    }
    const opts = baseOpts("Rating", "Meet Date");
    opts.plugins.tooltip.callbacks = { label: (ctx) => ctx.raw == null ? "" : `${ctx.dataset.label}: ${ctx.raw}` };
    makeChart("chartRating", { type: "line", data: { labels, datasets }, options: opts });
  }

  function athPBChart(sum) {
    const entries = Object.values(sum.pbs).sort((a, b) => a.distance - b.distance);
    const c = chartTheme();
    const opts = baseOpts("Best Time", "Distance");
    opts.scales.y.ticks.callback = (v) => fmt(v);
    opts.plugins.tooltip.callbacks = { label: (ctx) => "PB: " + fmt(entries[ctx.dataIndex].timeSec) };
    makeChart("chartPB", { type: "bar", data: { labels: entries.map((e) => E().distanceLabel(e.distance)), datasets: [{ data: entries.map((e) => e.timeSec), backgroundColor: c.fill, borderColor: c.line, borderWidth: 1.5, borderRadius: 4 }] }, options: opts });
  }

  function athPredChart(sum) {
    const preds = sum.predictions || [];
    const c = chartTheme();
    const opts = baseOpts("Predicted Time", "Distance");
    opts.scales.y.ticks.callback = (v) => fmt(v);
    opts.plugins.tooltip.callbacks = { label: (ctx) => fmt(preds[ctx.dataIndex].seconds) };
    makeChart("chartPred", { type: "bar", data: { labels: preds.map((p) => p.label), datasets: [{ data: preds.map((p) => p.seconds), backgroundColor: c.fill, borderColor: c.line, borderWidth: 1.5, borderRadius: 4 }] }, options: opts });
  }

  function athletePDF(sum, rank) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text(`${sum.name} — Athlete Report`, 14, 20);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    const rankLine = rank ? ` · State Rank ${rank.rank}${ordinal(rank.rank)} of ${rank.total}` : "";
    doc.text(`Mountain State Miles · ${new Date().toLocaleDateString()}${sum.bestMsm != null ? ` · Best MSM ${sum.bestMsm}` : ""}${rankLine}`, 14, 27);
    doc.autoTable({ head: [["Distance", "Personal Best"]], body: Object.values(sum.pbs).sort((a, b) => a.distance - b.distance).map((p) => [E().distanceLabel(p.distance), fmt(p.timeSec)]), startY: 33, styles: { fontSize: 10 }, headStyles: { fillColor: [0, 0, 0] } });
    if (sum.predictions) doc.autoTable({ head: [["Predicted Distance", "Time", "Pace/Mile"]], body: sum.predictions.map((p) => [p.label, fmt(p.seconds), clock((p.seconds / p.distance) * E().MILE_M)]), startY: doc.lastAutoTable.finalY + 8, styles: { fontSize: 10 }, headStyles: { fillColor: [0, 0, 0] } });
    if (sum.paces) doc.autoTable({ head: [["Training Zone", "Pace / Mile"]], body: [["Easy", clock(sum.paces.easy)], ["Steady", clock(sum.paces.marathon)], ["Threshold", clock(sum.paces.threshold)], ["Interval", clock(sum.paces.interval)], ["Repetition", clock(sum.paces.repetition)]], startY: doc.lastAutoTable.finalY + 8, styles: { fontSize: 10 }, headStyles: { fillColor: [0, 0, 0] } });
    doc.save(`${E().slugify(sum.name)}_report.pdf`); toast("✓ PDF report");
  }

  function exportPNG(canvasId, filename) {
    const cv = $(canvasId); if (!cv) return;
    const url = cv.toDataURL("image/png");
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); toast("✓ Chart PNG");
  }

  // =====================================================================
  //  COACH DASHBOARD
  // =====================================================================
  function renderCoach(profile) {
    const school = E().state.schoolsMap[profile.schoolSlug] || { name: profile.schoolSlug };
    $("dashTitle").textContent = school.name || "Team";
    let gender = "M";
    const build = () => {
      const roster = E().rosterForSchool(profile.schoolSlug, gender, currentSeason);
      const ci = E().teamInsights(roster);
      $("dashSub").textContent = `${gender === "M" ? "Boys" : "Girls"} · ${roster.length} athletes with results`;

      $("dashBody").innerHTML = `
        <section class="section-block">
          <div class="section-head">
            <div><h2 class="section-heading">Team Insights</h2><p class="section-sub">Scoring depth, pack dynamics, and improvers — best efforts across the season.</p></div>
            <div class="export-row">
              <select class="plain-select" id="coach-gender"><option value="M">Boys</option><option value="F">Girls</option></select>
              <button class="xbtn" id="coach-csv"><i class="fa-solid fa-file-csv"></i> Roster CSV</button>
              <button class="xbtn" id="coach-json"><i class="fa-solid fa-code"></i> JSON</button>
              <button class="xbtn" id="coach-pdf"><i class="fa-solid fa-file-pdf"></i> Coach Sheet PDF</button>
            </div>
          </div>
          <div class="stat-grid">
            <div class="stat-card hl"><div class="stat-lbl">Scoring 5 Avg</div><div class="stat-val">${ci.scoringAvg != null ? fmt(ci.scoringAvg) : "—"}</div><div class="stat-sub">Top-5 best efforts</div></div>
            <div class="stat-card hl"><div class="stat-lbl">1–5 Spread</div><div class="stat-val">${ci.spread15 != null ? fmt(ci.spread15) : "—"}</div><div class="stat-sub">Fastest → 5th</div></div>
            <div class="stat-card"><div class="stat-lbl">Avg Pack Gap</div><div class="stat-val">${ci.packGap != null ? fmt(ci.packGap) : "—"}</div><div class="stat-sub">Between scorers</div></div>
            <div class="stat-card"><div class="stat-lbl">Scoring Depth</div><div class="stat-val">${ci.depth}</div><div class="stat-sub">Runners with a time</div></div>
          </div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Team Shape</h2><p class="section-sub">Where your top 7 sit and who's trending up.</p></div></div>
          <div class="charts-grid">
            <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Top 7 — Best Efforts</div></div></div><div class="chart-wrap"><canvas id="chartTop7"></canvas></div></div>
            <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Rating Distribution</div><div class="chart-card-sub">Team depth by MSM rating</div></div></div><div class="chart-wrap"><canvas id="chartDist"></canvas></div></div>
          </div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Projected Scoring Lineup</h2><p class="section-sub">Top 5 by best effort — your scoring core.</p></div></div>
          <div class="table-card"><table class="rt"><thead><tr><th>#</th><th>Athlete</th><th>Best Effort</th><th>Best MSM</th><th>Races</th><th>Trend</th></tr></thead><tbody id="lineupBody"></tbody></table></div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Top Improvers</h2><p class="section-sub">Fastest rising ratings this season.</p></div></div>
          <div class="table-card"><table class="rt"><thead><tr><th>Athlete</th><th>Current</th><th>Rate</th><th>3-wk Projection</th></tr></thead><tbody id="improveBody"></tbody></table></div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Top 5 / Top 7 & Splits</h2><p class="section-sub">Scoring core, displacers, and how tight your pack runs.</p></div>
            <div class="export-row"><div class="seg" id="pack-seg"><button class="seg-btn active" data-n="5">Top 5</button><button class="seg-btn" data-n="7">Top 7</button></div></div>
          </div>
          <div class="stat-grid" id="packStats"></div>
          <div class="table-card" style="margin-top:1rem;"><table class="rt"><thead><tr><th>#</th><th>Athlete</th><th>Best Effort</th><th>Best MSM</th><th>Gap to Prev</th><th>Role</th></tr></thead><tbody id="packBody"></tbody></table></div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Statewide Team Comparison</h2><p class="section-sub">WV teams ranked by scoring-5 MSM rating (in-season races only), so distances and courses compare fairly.</p></div></div>
          <div class="stat-grid" id="swStats"></div>
          <div class="table-card" style="margin-top:1rem;"><table class="rt"><thead><tr><th>Rank</th><th>School</th><th>Scoring 5 Rating</th><th>1–5 Rating Gap</th><th>Depth</th></tr></thead><tbody id="swBody"></tbody></table></div>
        </section>

        <section class="section-block" id="simSection">
          <div class="section-head"><div><h2 class="section-heading">Meet Simulator</h2><p class="section-sub">Pick a course, build the field, and project places + team scores. Times are course-adjusted from each runner's season.</p></div>
            <div class="export-row"><button class="xbtn" id="sim-csv"><i class="fa-solid fa-file-csv"></i> Sim CSV</button><button class="xbtn" id="sim-pdf"><i class="fa-solid fa-file-pdf"></i> Sim PDF</button></div>
          </div>
          <div class="card">
            <div class="sim-controls">
              <div class="field-inline"><label class="stat-lbl">Field source</label>
                <div class="seg" id="sim-mode"><button class="seg-btn active" data-m="teams">Pick teams</button><button class="seg-btn" data-m="meet">Load a meet</button></div>
              </div>
              <div class="field-inline"><label class="stat-lbl">Course</label><select class="plain-select" id="sim-course"></select></div>
              <div class="field-inline"><label class="stat-lbl">Time basis</label><select class="plain-select" id="sim-basis"><option value="adjusted">Course-adjusted</option><option value="raw">Season-best raw</option></select></div>
            </div>
            <div id="sim-teams-mode" style="margin-top:14px;">
              <div class="ta-wrap"><label class="stat-lbl">Add opponent teams</label><input class="ta-input" id="sim-team-input" placeholder="Search schools to add…"><div class="ta-drop" id="sim-team-drop"></div></div>
              <div class="follow-chips" id="sim-team-chips"></div>
            </div>
            <div id="sim-meet-mode" class="hidden" style="margin-top:14px;">
              <label class="stat-lbl">Meet</label><select class="plain-select" id="sim-meet-select" style="min-width:280px;"></select>
            </div>
            <div style="margin-top:14px;"><button class="btn-primary" id="sim-run" style="width:auto;"><i class="fa-solid fa-play"></i> Run Simulation</button>
              <button class="xbtn" id="sim-lineup-toggle" style="margin-left:8px;"><i class="fa-solid fa-user-pen"></i> Edit my lineup</button></div>
            <div id="sim-lineup" class="hidden" style="margin-top:14px;"></div>
          </div>
          <div id="sim-results" style="margin-top:1rem;"></div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Advanced Training Tips</h2><p class="section-sub">Individualized guidance for each scoring runner — trajectory, racing load, pacing.</p></div>
            <div class="export-row"><select class="plain-select" id="tips-athlete"></select></div>
          </div>
          <div id="tipsBody"></div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Full Roster</h2></div></div>
          <div class="table-card"><table class="rt"><thead><tr><th>Athlete</th><th>Best Effort</th><th>Best MSM</th><th>5K Equiv</th><th>Races</th><th>Meets</th></tr></thead><tbody id="rosterBody"></tbody></table></div>
        </section>
      `;
      $("coach-gender").value = gender;
      $("coach-gender").onchange = (e) => { gender = e.target.value; build(); };

      coachTop7Chart(ci.scoring5.length ? roster.slice(0, 7) : roster.slice(0, 7));
      coachDistChart(roster);

      $("lineupBody").innerHTML = ci.scoring5.map((s, i) => {
        const t = s.forecast ? s.forecast.trend : "flat";
        return `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td class="mark-col">${fmt(s.best5k.timeSec)}</td><td>${s.bestMsm ?? "—"}</td><td>${s.raceCount}</td><td><span class="pill ${t === "improving" ? "up" : t === "declining" ? "down" : "flat"}">${t}</span></td></tr>`;
      }).join("") || `<tr><td colspan="6" style="text-align:center;padding:1.5rem;">Need 5 runners with times.</td></tr>`;

      $("improveBody").innerHTML = ci.improvers.map((s) =>
        `<tr><td>${esc(s.name)}</td><td>${s.forecast.current}</td><td class="pos">+${s.forecast.slopePerWeek.toFixed(1)}/wk</td><td>${s.forecast.projectedRating}</td></tr>`).join("")
        || `<tr><td colspan="4" style="text-align:center;padding:1.5rem;">No clear improvers yet.</td></tr>`;

      $("rosterBody").innerHTML = roster.map((s) =>
        `<tr><td>${esc(s.name)}</td><td class="mark-col">${s.best5k ? fmt(s.best5k.timeSec) : "—"}</td><td>${s.bestMsm ?? "—"}</td><td>${s.best5k ? fmt(E().riegel(s.best5k.timeSec, s.best5k.distance, 5000)) : "—"}</td><td>${s.raceCount}</td><td>${s.meetCount}</td></tr>`).join("")
        || `<tr><td colspan="6" style="text-align:center;padding:1.5rem;">No athletes found for this school.</td></tr>`;

      // exports
      $("coach-csv").onclick = () => {
        const rows = [["Athlete", "Best Effort", "Best MSM", "5K Equiv", "Races", "Meets", "Trend"]];
        roster.forEach((s) => rows.push([s.name, s.best5k ? fmt(s.best5k.timeSec) : "", s.bestMsm ?? "", s.best5k ? fmt(E().riegel(s.best5k.timeSec, s.best5k.distance, 5000)) : "", s.raceCount, s.meetCount, s.forecast ? s.forecast.trend : ""]));
        dl(`${profile.schoolSlug}_${gender}_roster.csv`, "text/csv", rows.map(csvRow).join("\n")); toast("✓ Roster CSV");
      };
      $("coach-json").onclick = () => {
        dl(`${profile.schoolSlug}_${gender}_team.json`, "application/json", JSON.stringify({
          school: school.name, slug: profile.schoolSlug, gender,
          insights: { scoring5_avg_sec: ci.scoringAvg, spread_1_5_sec: ci.spread15, avg_pack_gap_sec: ci.packGap, depth: ci.depth },
          roster: roster.map((s) => ({ name: s.name, best_effort_sec: s.best5k?.timeSec ?? null, best_msm: s.bestMsm, races: s.raceCount, meets: s.meetCount, forecast: s.forecast })),
        }, null, 2)); toast("✓ Team JSON");
      };
      $("coach-pdf").onclick = () => coachPDF(school, gender, ci, roster);

      // New advanced sections
      renderPack(roster, 5);
      wirePackSeg(roster);
      renderStatewide(profile.schoolSlug, gender);
      renderTips(roster);
      setupSimulator(profile, gender);
      $("sim-csv").onclick = simExportCSV;
      $("sim-pdf").onclick = simExportPDF;
    };
    build();
  }

  // ---- Top 5/7 + splits ----
  function packMetrics(roster, n) {
    const withBest = roster.filter((s) => s.best5k).slice(0, n);
    const ts = withBest.map((s) => s.best5k.timeSec);
    const avg = ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null;
    const spread = ts.length >= 2 ? ts[ts.length - 1] - ts[0] : null;
    let gap = null;
    if (ts.length >= 2) { let g = 0; for (let i = 1; i < ts.length; i++) g += ts[i] - ts[i - 1]; gap = g / (ts.length - 1); }
    return { withBest, avg, spread, gap };
  }
  function renderPack(roster, n) {
    const m = packMetrics(roster, n);
    $("packStats").innerHTML =
      `<div class="stat-card hl"><div class="stat-lbl">Top ${n} Avg</div><div class="stat-val">${m.avg != null ? fmt(m.avg) : "—"}</div></div>` +
      `<div class="stat-card hl"><div class="stat-lbl">1–${n} Spread</div><div class="stat-val">${m.spread != null ? fmt(m.spread) : "—"}</div><div class="stat-sub">Tighter = stronger pack</div></div>` +
      `<div class="stat-card"><div class="stat-lbl">Avg Gap</div><div class="stat-val">${m.gap != null ? fmt(m.gap) : "—"}</div><div class="stat-sub">Between runners</div></div>` +
      `<div class="stat-card"><div class="stat-lbl">Runners Counted</div><div class="stat-val">${m.withBest.length}</div></div>`;
    let prev = null;
    $("packBody").innerHTML = m.withBest.map((s, i) => {
      const t = s.best5k.timeSec;
      const gap = prev != null ? t - prev : null; prev = t;
      const role = i < 5 ? "Scorer" : "Displacer";
      return `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td class="mark-col">${fmt(t)}</td><td>${s.bestMsm ?? "—"}</td><td>${gap != null ? "+" + fmt(gap) : "—"}</td><td><span class="pill ${i < 5 ? "up" : "flat"}">${role}</span></td></tr>`;
    }).join("") || `<tr><td colspan="6" style="text-align:center;padding:1.5rem;">No timed runners.</td></tr>`;
  }
  function wirePackSeg(roster) {
    $("pack-seg").querySelectorAll(".seg-btn").forEach((b) => {
      b.onclick = () => { $("pack-seg").querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b)); renderPack(roster, +b.dataset.n); };
    });
  }

  // ---- Statewide team comparison ----
  function renderStatewide(schoolSlug, gender) {
    const cmp = E().teamStatewideComparison(schoolSlug, gender, currentSeason);
    $("swStats").innerHTML = cmp.rank
      ? `<div class="stat-card hl"><div class="stat-lbl">State Team Rank</div><div class="stat-val">${cmp.rank}<span style="font-size:1rem;vertical-align:super;">${ordinal(cmp.rank)}</span></div><div class="stat-sub">of ${cmp.total} scoring teams · in-season, WV</div></div>` +
        `<div class="stat-card"><div class="stat-lbl">Your Scoring 5 Rating</div><div class="stat-val">${cmp.me ? cmp.me.avgRating : "—"}</div><div class="stat-sub">${cmp.me ? "≈ " + fmt(cmp.me.scoringAvg) + " 5K" : ""}</div></div>` +
        `<div class="stat-card"><div class="stat-lbl">State Best</div><div class="stat-val">${cmp.teams[0] ? cmp.teams[0].avgRating : "—"}</div><div class="stat-sub">${cmp.teams[0] ? esc(cmp.teams[0].school) : ""}</div></div>`
      : `<div class="stat-card"><div class="stat-lbl">State Team Rank</div><div class="stat-val">—</div><div class="stat-sub">Need 5 scoring runners</div></div>`;
    // Show a window around this team (or top 15 if unranked).
    let list = cmp.teams;
    if (cmp.rank && cmp.rank > 8) list = cmp.teams.slice(Math.max(0, cmp.rank - 5), cmp.rank + 3);
    else list = cmp.teams.slice(0, 15);
    $("swBody").innerHTML = list.map((t) => {
      const isMe = t.schoolSlug === schoolSlug;
      const rank = cmp.teams.indexOf(t) + 1;
      return `<tr style="${isMe ? "background:var(--bg-secondary);font-weight:700;" : ""}"><td>${rank}</td><td>${esc(t.school)}${isMe ? ' <span class="pill up" style="font-size:0.6rem;">YOU</span>' : ""}</td><td class="mark-col">${t.avgRating}</td><td>${t.spreadRating != null ? t.spreadRating : "—"}</td><td>${t.depth}</td></tr>`;
    }).join("") || `<tr><td colspan="5" style="text-align:center;padding:1.5rem;">No scoring teams this season.</td></tr>`;
  }

  // ---- Advanced training tips ----
  function renderTips(roster) {
    const scorers = roster.filter((s) => s.best5k).slice(0, 7);
    const sel = $("tips-athlete");
    sel.innerHTML = scorers.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join("");
    const draw = () => {
      const s = scorers[+sel.value] || scorers[0];
      if (!s) { $("tipsBody").innerHTML = '<p class="section-sub">No runners with results.</p>'; return; }
      const tips = E().advancedTips(s);
      $("tipsBody").innerHTML = `<div class="card"><div style="font-weight:700;margin-bottom:10px;">${esc(s.name)} <span class="section-sub">· best MSM ${s.bestMsm ?? "—"} · ${s.raceCount} races</span></div>` +
        (tips.map((t) => `<div class="tip tip-${t.tone}"><span class="tip-tag">${t.tag}</span><span>${esc(t.text)}</span></div>`).join("") || '<p class="section-sub">Not enough data for tips yet.</p>') + `</div>`;
    };
    sel.onchange = draw; draw();
  }

  function coachTop7Chart(top7) {
    const c = chartTheme();
    const opts = baseOpts("Best Effort", "", true);
    opts.indexAxis = "y";
    opts.scales.x.ticks.callback = (v) => fmt(v);
    opts.plugins.tooltip.callbacks = { label: (ctx) => fmt(top7[ctx.dataIndex].best5k.timeSec) };
    makeChart("chartTop7", { type: "bar", data: { labels: top7.map((s) => s.name), datasets: [{ data: top7.map((s) => s.best5k ? s.best5k.timeSec : 0), backgroundColor: c.fill, borderColor: c.line, borderWidth: 1.5, borderRadius: 4 }] }, options: opts });
  }
  function coachDistChart(roster) {
    const c = chartTheme();
    const ratings = roster.map((s) => s.bestMsm).filter((v) => v != null);
    // bucket ratings into 5 bins
    if (!ratings.length) { makeChart("chartDist", { type: "bar", data: { labels: [], datasets: [] }, options: baseOpts() }); return; }
    const min = Math.min(...ratings), max = Math.max(...ratings);
    const bins = 5, size = Math.max(1, (max - min) / bins);
    const counts = new Array(bins).fill(0), labels = [];
    for (let i = 0; i < bins; i++) labels.push(`${Math.round(min + i * size)}–${Math.round(min + (i + 1) * size)}`);
    ratings.forEach((r) => { let idx = Math.min(bins - 1, Math.floor((r - min) / size)); counts[idx]++; });
    const opts = baseOpts("Athletes", "MSM Rating");
    makeChart("chartDist", { type: "bar", data: { labels, datasets: [{ data: counts, backgroundColor: c.fill, borderColor: c.line, borderWidth: 1.5, borderRadius: 4 }] }, options: opts });
  }
  function coachPDF(school, gender, ci, roster) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text(`${school.name} — ${gender === "M" ? "Boys" : "Girls"} Coach Sheet`, 14, 20);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Mountain State Miles · ${new Date().toLocaleDateString()} · Scoring-5 Avg ${ci.scoringAvg != null ? fmt(ci.scoringAvg) : "—"} · 1–5 Spread ${ci.spread15 != null ? fmt(ci.spread15) : "—"}`, 14, 27);
    doc.autoTable({ head: [["#", "Athlete", "Best Effort", "Best MSM", "Races", "Trend"]], body: ci.scoring5.map((s, i) => [i + 1, s.name, fmt(s.best5k.timeSec), s.bestMsm ?? "—", s.raceCount, s.forecast ? s.forecast.trend : "—"]), startY: 33, styles: { fontSize: 10 }, headStyles: { fillColor: [0, 0, 0] } });
    doc.autoTable({ head: [["Athlete", "Best Effort", "Best MSM", "Races", "Meets"]], body: roster.map((s) => [s.name, s.best5k ? fmt(s.best5k.timeSec) : "—", s.bestMsm ?? "—", s.raceCount, s.meetCount]), startY: doc.lastAutoTable.finalY + 8, styles: { fontSize: 9 }, headStyles: { fillColor: [0, 0, 0] } });
    doc.save(`${school.name || "team"}_coach_sheet.pdf`); toast("✓ Coach sheet PDF");
  }

  // =====================================================================
  //  MEET SIMULATOR (coach)
  // =====================================================================
  const simState = { mode: "teams", opponents: [], myLineup: null };
  function setupSimulator(profile, gender) {
    simState.mode = "teams";
    simState.opponents = [];
    simState.myLineup = null; // null = auto top 7
    const school = E().state.schoolsMap[profile.schoolSlug] || { name: profile.schoolSlug };

    // Course select (default to a 5K course if present)
    const courses = E().listCourses();
    $("sim-course").innerHTML = courses.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}${c.difficulty ? " · " + esc(c.difficulty) : ""}</option>`).join("");

    // Meet select
    $("sim-meet-select").innerHTML = E().listMeets().map((m) => `<option value="${esc(m.slug)}">${esc(m.name)}${m.date ? " (" + String(m.date).split("T")[0] + ")" : ""}</option>`).join("");

    // Mode toggle
    $("sim-mode").querySelectorAll(".seg-btn").forEach((b) => {
      b.onclick = () => {
        simState.mode = b.dataset.m;
        $("sim-mode").querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
        $("sim-teams-mode").classList.toggle("hidden", simState.mode !== "teams");
        $("sim-meet-mode").classList.toggle("hidden", simState.mode !== "meet");
      };
    });

    // Opponent typeahead (exclude own school + already-added)
    typeahead($("sim-team-input"), $("sim-team-drop"),
      () => E().listSchools().filter((s) => s.slug !== profile.schoolSlug && !simState.opponents.includes(s.slug)).map((s) => ({ name: s.name, slug: s.slug })),
      (item) => { simState.opponents.push(item.slug); $("sim-team-input").value = ""; renderOppChips(); });
    renderOppChips();

    // When meet-mode meet changes, auto-pick that meet's course.
    $("sim-meet-select").onchange = () => {
      const m = E().listMeets().find((x) => x.slug === $("sim-meet-select").value);
      if (m && m.course_slug) $("sim-course").value = m.course_slug;
    };

    // Lineup editor
    $("sim-lineup-toggle").onclick = () => {
      const box = $("sim-lineup");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) renderLineupEditor(profile, gender);
    };

    $("sim-run").onclick = () => runSim(profile, gender, school);
  }

  function renderOppChips() {
    $("sim-team-chips").innerHTML = simState.opponents.map((slug) => {
      const name = (E().state.schoolsMap[slug] || {}).name || slug;
      return `<span class="follow-chip">${esc(name)} <button data-slug="${esc(slug)}">&times;</button></span>`;
    }).join("") || '<span class="section-sub">Add at least one opponent (your team is always included).</span>';
    $("sim-team-chips").querySelectorAll("button[data-slug]").forEach((b) => {
      b.onclick = () => { simState.opponents = simState.opponents.filter((s) => s !== b.dataset.slug); renderOppChips(); };
    });
  }

  function renderLineupEditor(profile, gender) {
    const roster = E().rosterForSchool(profile.schoolSlug, gender, currentSeason).filter((s) => s.best5k);
    if (!simState.myLineup) simState.myLineup = roster.slice(0, 7).map((s) => s.name);
    const set = new Set(simState.myLineup.map((n) => n.toLowerCase()));
    $("sim-lineup").innerHTML = `<div class="section-sub" style="margin-bottom:8px;">Check the runners to enter (default: top 7 by projected time).</div>` +
      `<div class="lineup-grid">` + roster.map((s) =>
        `<label class="lineup-item"><input type="checkbox" data-n="${esc(s.name)}" ${set.has(s.name.toLowerCase()) ? "checked" : ""}> ${esc(s.name)} <small>${fmt(s.best5k.timeSec)}</small></label>`).join("") + `</div>`;
    $("sim-lineup").querySelectorAll("input[data-n]").forEach((cb) => {
      cb.onchange = () => {
        const chosen = [...$("sim-lineup").querySelectorAll("input[data-n]:checked")].map((x) => x.dataset.n);
        simState.myLineup = chosen;
      };
    });
  }

  let lastSim = null;
  function runSim(profile, gender, school) {
    const courseSlug = $("sim-course").value;
    const basis = $("sim-basis").value;
    let teamList = [];

    if (simState.mode === "meet") {
      const meetSlug = $("sim-meet-select").value;
      // Teams that actually competed at that meet (this gender).
      const slugs = new Set();
      E().state.results.forEach((r) => { if (r.meet_slug === meetSlug && r.gender === gender && r.school_slug) slugs.add(r.school_slug); });
      slugs.add(profile.schoolSlug);
      teamList = [...slugs].map((s) => ({ schoolSlug: s, includedNames: s === profile.schoolSlug ? simState.myLineup : null }));
    } else {
      if (!simState.opponents.length) return toast("Add at least one opponent team.");
      teamList = [{ schoolSlug: profile.schoolSlug, includedNames: simState.myLineup }]
        .concat(simState.opponents.map((s) => ({ schoolSlug: s, includedNames: null })));
    }

    const sim = E().simulateMeet({ teamList, gender, season: currentSeason, courseSlug, basis });
    lastSim = { sim, gender, courseName: (E().state.coursesMap[courseSlug] || {}).name || courseSlug, mySlug: profile.schoolSlug };
    renderSimResults(lastSim);
  }

  function renderSimResults(ctx) {
    const { sim, mySlug, courseName } = ctx;
    if (!sim.field.length) { $("sim-results").innerHTML = `<div class="empty-state"><i class="fa-solid fa-flag-checkered"></i><p>No runners to simulate. Check your teams and season.</p></div>`; return; }
    const distLabel = E().distanceLabel(sim.distance);
    const basisLabel = sim.basis === "raw" ? "season-best raw times" : "course-adjusted projections";

    const standings = sim.teams.map((t, i) =>
      `<tr style="${t.schoolSlug === mySlug ? "background:var(--bg-secondary);font-weight:700;" : ""}">
        <td>${t.complete ? i + 1 : "—"}</td>
        <td>${esc(t.school)}${t.schoolSlug === mySlug ? ' <span class="pill up" style="font-size:0.6rem;">YOU</span>' : ""}${t.complete ? "" : ' <span class="section-sub">(incomplete)</span>'}</td>
        <td class="mark-col">${t.score != null ? t.score : "—"}</td>
        <td>${t.teamAvg != null ? fmt(t.teamAvg) : "—"}</td>
        <td>${t.spread15 != null ? fmt(t.spread15) : "—"}</td>
        <td>${t.top5.map((r) => "#" + r.scoringPlace).filter((x) => !x.includes("null")).join(" ")}</td>
      </tr>`).join("");

    const field = sim.field.map((e) =>
      `<tr style="${e.schoolSlug === mySlug ? "background:var(--bg-secondary);" : ""}">
        <td>${e.place}</td>
        <td>${esc(e.name)}</td>
        <td>${esc((E().state.schoolsMap[e.schoolSlug] || {}).name || e.schoolSlug)}</td>
        <td class="mark-col">${fmt(e.timeSec)}</td>
        <td>${clock((e.timeSec / sim.distance) * E().MILE_M)}</td>
        <td>${e.scoringPlace ? "+" + e.scoringPlace : "—"}</td>
      </tr>`).join("");

    $("sim-results").innerHTML = `
      <div class="section-sub" style="margin-bottom:10px;">Simulated on <strong>${esc(courseName)}</strong> at ${distLabel}, using ${basisLabel}. ${sim.teams.filter((t) => t.complete).length} scoring teams · ${sim.field.length} runners.</div>
      <div class="section-head" style="margin-bottom:0.6rem;"><h3 class="section-heading" style="font-size:1.05rem;">Projected Team Standings</h3></div>
      <div class="table-card" style="margin-bottom:1.25rem;"><table class="rt"><thead><tr><th>Place</th><th>School</th><th>Score</th><th>Top-5 Avg</th><th>1–5 Split</th><th>Scorers</th></tr></thead><tbody>${standings}</tbody></table></div>
      <div class="section-head" style="margin-bottom:0.6rem;"><h3 class="section-heading" style="font-size:1.05rem;">Projected Individual Finish</h3></div>
      <div class="table-card"><table class="rt"><thead><tr><th>Place</th><th>Athlete</th><th>School</th><th>Proj Time</th><th>Pace/Mi</th><th>Pts</th></tr></thead><tbody>${field}</tbody></table></div>
    `;
  }

  function simExportCSV() {
    if (!lastSim) return toast("Run a simulation first.");
    const { sim } = lastSim;
    const rows = [["PROJECTED TEAM STANDINGS"], ["Place", "School", "Score", "Top5 Avg", "1-5 Split"]];
    sim.teams.forEach((t, i) => rows.push([t.complete ? i + 1 : "", t.school, t.score ?? "", t.teamAvg != null ? fmt(t.teamAvg) : "", t.spread15 != null ? fmt(t.spread15) : ""]));
    rows.push([], ["PROJECTED INDIVIDUAL FINISH"], ["Place", "Athlete", "School", "Proj Time", "Pace/Mile", "Scoring Place"]);
    sim.field.forEach((e) => rows.push([e.place, e.name, (E().state.schoolsMap[e.schoolSlug] || {}).name || e.schoolSlug, fmt(e.timeSec), clock((e.timeSec / sim.distance) * E().MILE_M), e.scoringPlace ?? ""]));
    dl(`meet_simulation_${lastSim.gender}.csv`, "text/csv", rows.map(csvRow).join("\n")); toast("✓ Simulation CSV");
  }
  function simExportPDF() {
    if (!lastSim) return toast("Run a simulation first.");
    const { jsPDF } = window.jspdf; const doc = new jsPDF(); const { sim, courseName, gender } = lastSim;
    doc.setFontSize(16); doc.setFont("helvetica", "bold");
    doc.text(`Meet Simulation — ${gender === "M" ? "Boys" : "Girls"}`, 14, 18);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`${courseName} · ${E().distanceLabel(sim.distance)} · ${sim.basis === "raw" ? "raw times" : "course-adjusted"} · ${new Date().toLocaleDateString()}`, 14, 25);
    doc.autoTable({ head: [["Place", "School", "Score", "Top-5 Avg", "1-5 Split"]], body: sim.teams.map((t, i) => [t.complete ? i + 1 : "—", t.school, t.score ?? "—", t.teamAvg != null ? fmt(t.teamAvg) : "—", t.spread15 != null ? fmt(t.spread15) : "—"]), startY: 31, styles: { fontSize: 9 }, headStyles: { fillColor: [0, 0, 0] } });
    doc.autoTable({ head: [["Place", "Athlete", "School", "Proj Time", "Pace/Mi", "Pts"]], body: sim.field.map((e) => [e.place, e.name, (E().state.schoolsMap[e.schoolSlug] || {}).name || e.schoolSlug, fmt(e.timeSec), clock((e.timeSec / sim.distance) * E().MILE_M), e.scoringPlace ?? "—"]), startY: doc.lastAutoTable.finalY + 8, styles: { fontSize: 8 }, headStyles: { fillColor: [0, 0, 0] } });
    doc.save(`meet_simulation_${gender}.pdf`); toast("✓ Simulation PDF");
  }

  // =====================================================================
  //  FAN DASHBOARD
  // =====================================================================
  function renderFan(profile) {
    $("dashTitle").textContent = "Fan Zone";
    $("dashSub").textContent = "Follow runners and teams, compare head-to-head, watch the leaderboards.";
    const follows = (profile.follows) || { athletes: [], schools: [] };

    $("dashBody").innerHTML = `
      <section class="section-block card">
        <h2 class="section-heading" style="font-size:1.15rem;">Follow Athletes</h2>
        <p class="section-sub" style="margin-bottom:10px;">Search and tap to follow. Followed runners show up in your compare tool.</p>
        <div class="ta-wrap"><input class="ta-input" id="fanFollowInput" placeholder="Search athletes to follow…"><div class="ta-drop" id="fanFollowDrop"></div></div>
        <div class="follow-chips" id="followChips"></div>
      </section>

      <section class="section-block">
        <div class="section-head"><div><h2 class="section-heading">Head-to-Head Compare</h2><p class="section-sub">Overlay two runners' progression and see the gap.</p></div>
          <div class="export-row"><button class="xbtn" id="cmp-png"><i class="fa-solid fa-image"></i> PNG</button><button class="xbtn" id="cmp-csv"><i class="fa-solid fa-file-csv"></i> CSV</button></div></div>
        <div class="card">
          <div class="compare-controls">
            <div class="ta-wrap"><label class="stat-lbl">Runner A</label><input class="ta-input" id="cmpAInput" placeholder="Search…"><div class="ta-drop" id="cmpADrop"></div></div>
            <div class="ta-wrap"><label class="stat-lbl">Runner B</label><input class="ta-input" id="cmpBInput" placeholder="Search…"><div class="ta-drop" id="cmpBDrop"></div></div>
          </div>
          <div class="stat-grid" id="cmpStats" style="margin-top:16px;"></div>
          <div class="chart-wrap" style="height:280px;margin-top:16px;"><canvas id="chartCompare"></canvas></div>
        </div>
      </section>

      <section class="section-block">
        <div class="section-head"><div><h2 class="section-heading">State Leaderboard</h2><p class="section-sub">Top MSM ratings, all-time.</p></div>
          <div class="export-row"><select class="plain-select" id="lb-gender"><option value="M">Boys</option><option value="F">Girls</option></select><button class="xbtn" id="lb-csv"><i class="fa-solid fa-file-csv"></i> CSV</button></div></div>
        <div class="table-card"><table class="rt"><thead><tr><th>#</th><th>Athlete</th><th>School</th><th>Best MSM</th></tr></thead><tbody id="lbBody"></tbody></table></div>
      </section>
    `;

    // follow typeahead
    typeahead($("fanFollowInput"), $("fanFollowDrop"), () => E().listAthleteNames(), async (item) => {
      $("fanFollowInput").value = "";
      await A().toggleFollowAthlete(item.name);
    });
    renderFollowChips();

    // compare
    let cmpA = follows.athletes[0] ? E().athleteSummary(follows.athletes[0], currentSeason) : null;
    let cmpB = follows.athletes[1] ? E().athleteSummary(follows.athletes[1], currentSeason) : null;
    const drawCompare = () => renderCompare(cmpA, cmpB);
    typeahead($("cmpAInput"), $("cmpADrop"), () => E().listAthleteNames(), (item) => { $("cmpAInput").value = item.name; cmpA = E().athleteSummary(item.name, currentSeason); drawCompare(); });
    typeahead($("cmpBInput"), $("cmpBDrop"), () => E().listAthleteNames(), (item) => { $("cmpBInput").value = item.name; cmpB = E().athleteSummary(item.name, currentSeason); drawCompare(); });
    if (cmpA) $("cmpAInput").value = cmpA.name;
    if (cmpB) $("cmpBInput").value = cmpB.name;
    drawCompare();
    $("cmp-png").onclick = () => exportPNG("chartCompare", "compare.png");
    $("cmp-csv").onclick = () => {
      if (!cmpA && !cmpB) return toast("Pick runners first.");
      const rows = [["Runner", "Date", "Meet", "Seconds", "MSM"]];
      [cmpA, cmpB].filter(Boolean).forEach((s) => s.rows.forEach((r) => rows.push([s.name, r.date, r.meet?.name || r.meet_slug, r.timeSec ?? "", r.msm ?? ""])));
      dl("compare.csv", "text/csv", rows.map(csvRow).join("\n")); toast("✓ Compare CSV");
    };

    // leaderboard
    let lbGender = "M";
    const drawLB = () => renderLeaderboard(lbGender);
    $("lb-gender").onchange = (e) => { lbGender = e.target.value; drawLB(); };
    drawLB();
    $("lb-csv").onclick = () => {
      const list = leaderboardData(lbGender);
      const rows = [["Rank", "Athlete", "School", "Best MSM"]];
      list.forEach((x, i) => rows.push([i + 1, x.name, x.school, x.rating]));
      dl(`leaderboard_${lbGender}.csv`, "text/csv", rows.map(csvRow).join("\n")); toast("✓ Leaderboard CSV");
    };
  }

  function renderFollowChips() {
    const follows = (A().profile && A().profile.follows) || { athletes: [] };
    const box = $("followChips");
    if (!box) return;
    box.innerHTML = (follows.athletes || []).map((n) =>
      `<span class="follow-chip">${esc(n)} <button data-n="${esc(n)}" title="Unfollow">&times;</button></span>`).join("")
      || '<span class="section-sub">Not following anyone yet.</span>';
    box.querySelectorAll("button[data-n]").forEach((b) => { b.onclick = async () => { await A().toggleFollowAthlete(b.dataset.n); }; });
  }

  function renderCompare(a, b) {
    const box = $("cmpStats");
    const list = [a, b].filter(Boolean);
    box.innerHTML = list.map((s, i) => {
      const rank = E().stateRank(s.name, s.gender, currentSeason);
      return `<div class="stat-card${i === 0 ? " hl" : ""}"><div class="stat-lbl">${esc(s.name)}</div><div class="stat-val">${s.bestMsm ?? "—"}</div><div class="stat-sub">${s.best5k ? "5K eq " + fmt(E().riegel(s.best5k.timeSec, s.best5k.distance, 5000)) : ""}${rank ? " · #" + rank.rank : ""}</div></div>`;
    }).join("") || '<p class="section-sub">Pick two runners to compare.</p>';

    const c = chartTheme();
    const datasets = [];
    const allDates = new Set();
    list.forEach((s) => s.datedRatings.forEach((d) => allDates.add(d.date)));
    const dates = [...allDates].sort();
    const palette = [c.line, "#f97316"];
    list.forEach((s, i) => {
      const map = {}; s.datedRatings.forEach((d) => { map[d.date] = d.rating; });
      datasets.push({ label: s.name, data: dates.map((d) => map[d] ?? null), borderColor: palette[i], backgroundColor: "transparent", borderWidth: 2, pointRadius: 4, tension: 0.25, spanGaps: true });
    });
    const opts = baseOpts("MSM Rating", "Meet Date");
    opts.plugins.legend = { display: true, labels: { color: c.text, boxWidth: 10 } };
    makeChart("chartCompare", { type: "line", data: { labels: dates.map((d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })), datasets }, options: opts });
  }

  function leaderboardData(gender) {
    const best = {};
    E().state.results.forEach((r) => {
      if (r.gender !== gender || r.msm == null) return;
      if (!E().seasonMatch(r, currentSeason)) return;
      const k = E().norm(r.athlete_name);
      if (!k) return;
      if (!best[k] || r.msm > best[k].rating) best[k] = { name: r.athlete_name, school: (E().state.schoolsMap[r.school_slug] || {}).name || r.school_slug || "", rating: r.msm };
    });
    return Object.values(best).sort((a, b) => b.rating - a.rating).slice(0, 100);
  }
  function renderLeaderboard(gender) {
    const list = leaderboardData(gender);
    $("lbBody").innerHTML = list.map((x, i) =>
      `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td>${esc(x.school)}</td><td class="mark-col">${x.rating}</td></tr>`).join("")
      || `<tr><td colspan="4" style="text-align:center;padding:1.5rem;">No data.</td></tr>`;
  }

  // =====================================================================
  //  BOOT
  // =====================================================================
  let engineReady = false, dataError = null;
  async function ensureEngine() {
    if (engineReady) return true;
    try { await E().load(); engineReady = true; return true; }
    catch (e) { dataError = e; console.error(e); return false; }
  }

  function route() {
    const user = A().user, profile = A().profile;
    if (!user) { show("authGate"); return; }
    // signed in — need engine data before onboarding/dash
    ensureEngine().then((ok) => {
      if (!ok) { show("dash"); $("dashTitle").textContent = "Couldn't load data"; $("dashBody").innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>${esc(dataError && dataError.message || "Data unavailable.")}</p></div>`; return; }
      populateOnboardData();
      if (!profile || !profile.role) { show("onboard"); }
      else { show("dash"); renderDash(profile); }
    });
  }
  let onboardPopulated = false;
  function populateOnboardData() {
    if (onboardPopulated) return; onboardPopulated = true;
    // athlete typeahead + school select are wired in wireOnboard; data now available
  }

  // rebuild charts on theme toggle
  new MutationObserver(() => {
    const p = A().profile;
    if (p && p.role && !$("dash").classList.contains("hidden")) renderDash(p);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function boot() {
    wireAuth();
    wireOnboard();
    A().onChange((user, profile) => {
      // re-render follow chips live when profile updates on the fan dash
      if (user && profile && profile.role === "fan" && !$("dash").classList.contains("hidden")) {
        renderFollowChips();
      }
      route();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
