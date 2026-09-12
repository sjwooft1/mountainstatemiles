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
  let navObserver = null;
    function buildSectionNav(items) {
      const nav = $("dashNav"), inner = $("dashNavInner");
      if (!nav || !inner) return;
      const present = items.filter(([id]) => document.getElementById(id));
      if (present.length < 2) { nav.classList.add("hidden"); return; }
      inner.innerHTML = present.map(([id, label], i) =>
        `<a href="#${id}" data-target="${id}"${i === 0 ? ' class="active"' : ""}>${esc(label)}</a>`).join("");
      nav.classList.remove("hidden");
  
      inner.querySelectorAll("a").forEach((a) => {
        a.onclick = (e) => {
          e.preventDefault();
          const t = document.getElementById(a.dataset.target);
          if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
        };
      });
  
      // Scroll-spy: highlight the section nearest the top.
      if (navObserver) navObserver.disconnect();
      navObserver = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          inner.querySelectorAll("a").forEach((a) =>
            a.classList.toggle("active", a.dataset.target === en.target.id));
        });
      }, { rootMargin: "-64px 0px -70% 0px", threshold: 0 });
      present.forEach(([id]) => { const el = document.getElementById(id); if (el) navObserver.observe(el); });
    }
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
    
        applyHeroPersonalization(profile);

    // Default season to the newest one with data (first render only).
    if (!seasonInitialized) {
      const seasons = E().listSeasons();
      if (seasons.length) currentSeason = String(seasons[0]);
      seasonInitialized = true;
    }
    addSeasonSelect(profile);
    addAction("switch", '<i class="fa-solid fa-repeat"></i> Change Role', () => { show("onboard"); resetOnboard(); });
    addAction("signout", '<i class="fa-solid fa-arrow-right-from-bracket"></i> Sign Out', () => A().signOut());

    const navEl = $("dashNav"); if (navEl) navEl.classList.add("hidden");
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
  // ---------- athlete hero personalization ----------
    function applyHeroPersonalization(profile) {
      const hero = $("dashHero");
      const media = $("dashHeroMedia");
      const avatar = $("dashAvatar");
      const heroImg = profile.heroImage || "";
      const avaImg = profile.avatar || "";
  
      // Banner
      if (heroImg) {
        media.style.backgroundImage = `url("${cssUrl(heroImg)}")`;
        hero.classList.add("has-media");
      } else {
        media.style.backgroundImage = "";
        hero.classList.remove("has-media");
      }
  
      // Avatar
      if (avaImg) {
        avatar.src = avaImg;
        avatar.classList.remove("hidden");
      } else {
        avatar.removeAttribute("src");
        avatar.classList.add("hidden");
      }
  
      // Customize is available on every dashboard — athletes, coaches, and fans
      // can all personalize their hero banner + avatar.
      addAction("customize", '<i class="fa-solid fa-image"></i> Customize', () => openImageEditor(profile));
    }
  
    // Escape a URL for safe use inside a CSS url("...") value.
    function cssUrl(u) { return String(u).replace(/["\\\n\r]/g, ""); }
  
    function openImageEditor(profile) {
      const back = document.createElement("div");
      back.className = "img-editor-backdrop";
      back.innerHTML = `
        <div class="img-editor" role="dialog" aria-modal="true">
          <h3>Make it yours</h3>
          <p class="section-sub">Paste an image link (https://…) for your banner and avatar. Great sources: a race photo, your team hero shot, or a favorite trail.</p>
          <div class="img-editor-preview" id="ieBannerPrev">${profile.heroImage ? "" : "Banner preview"}</div>
          <div class="field"><label>Banner image URL</label><input id="ieBanner" type="url" placeholder="https://…" value="${esc(profile.heroImage || "")}"></div>
          <div class="field"><label>Avatar image URL</label><input id="ieAvatar" type="url" placeholder="https://…" value="${esc(profile.avatar || "")}"></div>
          <div class="img-editor-actions">
            <button class="btn-primary" id="ieSave"><i class="fa-solid fa-check"></i> Save</button>
            <button class="btn-ghost" id="ieClear">Remove images</button>
            <button class="btn-ghost" id="ieCancel">Cancel</button>
          </div>
        </div>`;
      document.body.appendChild(back);
  
      const prev = back.querySelector("#ieBannerPrev");
      const banner = back.querySelector("#ieBanner");
      const syncPrev = () => {
        const v = banner.value.trim();
        prev.style.backgroundImage = v ? `url("${cssUrl(v)}")` : "";
        prev.textContent = v ? "" : "Banner preview";
      };
      syncPrev(); banner.addEventListener("input", syncPrev);
  
      const close = () => back.remove();
      back.addEventListener("click", (e) => { if (e.target === back) close(); });
      back.querySelector("#ieCancel").onclick = close;
      back.querySelector("#ieClear").onclick = async () => {
        try { await A().saveProfile({ heroImage: "", avatar: "" }); toast("✓ Images removed"); }
        catch (e) { toast("Couldn't save: " + (e.message || e.code)); }
        close();
      };
      back.querySelector("#ieSave").onclick = async () => {
        const heroImage = banner.value.trim();
        const avatar = back.querySelector("#ieAvatar").value.trim();
        if ((heroImage && !/^https?:\/\//i.test(heroImage)) || (avatar && !/^https?:\/\//i.test(avatar)))
          return toast("Use full https:// image links.");
        try { await A().saveProfile({ heroImage, avatar }); toast("✓ Saved"); }
        catch (e) { toast("Couldn't save: " + (e.message || e.code)); }
        close();
      };
    }

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
      <section class="section-block" id="sec-snapshot">
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

      <section class="section-block" id="sec-performance">
        <div class="section-head"><div><h2 class="section-heading">Performance</h2><p class="section-sub">Race-time progression and rating trend over the season.</p></div></div>
        <div class="charts-grid">
          <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Time Progression</div><div class="chart-card-sub">Lower = faster</div></div><select class="event-select" id="ath-dist"></select></div><div class="chart-wrap"><canvas id="chartProg"></canvas></div></div>
          <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">MSM Rating Trend + Forecast</div><div class="chart-card-sub">Dashed = 3-week projection</div></div></div><div class="chart-wrap"><canvas id="chartRating"></canvas></div></div>
          <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Personal Bests by Distance</div></div></div><div class="chart-wrap"><canvas id="chartPB"></canvas></div></div>
          <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Race Predictions (Riegel)</div><div class="chart-card-sub">Equivalent times at other distances</div></div></div><div class="chart-wrap"><canvas id="chartPred"></canvas></div></div>
        </div>
      </section>

      <section class="section-block" id="sec-predictions">
        <div class="section-head"><div><h2 class="section-heading">Race Predictions</h2><p class="section-sub">Projected from your best effort using the Riegel model.</p></div>
          <div class="export-row"><button class="xbtn" id="pred-csv"><i class="fa-solid fa-file-csv"></i> Predictions CSV</button></div></div>
        <div class="table-card"><table class="rt"><thead><tr><th>Distance</th><th>Predicted Time</th><th>Pace / Mile</th></tr></thead><tbody id="predBody"></tbody></table></div>
      </section>

      <section class="section-block" id="sec-paces">
        <div class="section-head"><div><h2 class="section-heading">Training Paces</h2><p class="section-sub">Zones derived from your ${sum.best5k ? E().distanceLabel(sum.best5k.distance) : "best"} effort. Guidance only — pair with your coach's plan.</p></div></div>
        <div class="pace-grid" id="paceGrid"></div>
      </section>

      <section class="section-block" id="sec-results">
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
          `<tr><td data-label="Distance">${p.label}</td><td data-label="Predicted Time" class="mark-col">${fmt(p.seconds)}</td><td data-label="Pace / Mile">${clock((p.seconds / p.distance) * E().MILE_M)}</td></tr>`).join("")
          || `<tr><td colspan="3" style="text-align:center;padding:1.5rem;">Not enough data.</td></tr>`;

    // paces
    renderPaces(sum.paces);

    // results table
    $("resBody").innerHTML = sum.rows.map((r) => {
          const distKey = String(Math.round(Number(r.distance)));
          const isPB = sum.pbs[distKey] && sum.pbs[distKey].timeSec === r.timeSec;
          return `<tr>
            <td data-label="Date">${r.date ? new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
            <td data-label="Meet">${esc(r.meet?.name || r.meet_slug || "—")}</td>
            <td data-label="Division">${esc(r.race_type || "—")}</td>
            <td data-label="Time" class="mark-col">${fmt(r.timeSec)}${isPB ? ' <span class="pill up" style="font-size:0.6rem;">PB</span>' : ""}</td>
            <td data-label="MSM">${r.msm ?? "—"}</td>
            <td data-label="Place">${r.place ? r.place + ordinal(r.place) : "—"}</td>
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
    buildSectionNav([
          ["sec-snapshot", "Snapshot"],
          ["sec-performance", "Performance"],
          ["sec-predictions", "Predictions"],
          ["sec-paces", "Paces"],
          ["sec-results", "Results"],
        ]);
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
          <div class="section-head"><div><h2 class="section-heading">Meet Simulator</h2><p class="section-sub">Pick a course, build the field, and project places + team scores from recent meet form. The default uses the last three selected results — not lifetime PRs.</p></div>
            <div class="export-row"><button class="xbtn" id="sim-csv"><i class="fa-solid fa-file-csv"></i> Sim CSV</button><button class="xbtn" id="sim-pdf"><i class="fa-solid fa-file-pdf"></i> Sim PDF</button></div>
          </div>
          <div class="card">
            <div class="sim-controls">
              <div class="field-inline"><label class="stat-lbl">Field source</label>
                <div class="seg" id="sim-mode"><button class="seg-btn active" data-m="teams">Pick teams</button><button class="seg-btn" data-m="meet">Load a meet</button></div>
              </div>
              <div class="field-inline"><label class="stat-lbl">Course</label><select class="plain-select" id="sim-course"></select></div>
              <div class="field-inline"><label class="stat-lbl">Time basis</label><select class="plain-select" id="sim-basis"><option value="recent">Recent form · last 3 meets</option><option value="adjusted">Best course-adjusted effort</option><option value="raw">Fastest raw time · what-if</option></select></div>
              <div class="field-inline"><label class="stat-lbl">Division</label><div class="seg" id="sim-gender"><button class="seg-btn active" data-g="M">Boys</button><button class="seg-btn" data-g="F">Girls</button></div></div>
            </div>
            <div id="sim-teams-mode" style="margin-top:14px;">
              <div class="ta-wrap"><label class="stat-lbl">Add opponent teams</label><input class="ta-input" id="sim-team-input" placeholder="Search schools to add…"><div class="ta-drop" id="sim-team-drop"></div></div>
              <div class="follow-chips" id="sim-team-chips"></div>
            </div>
            <div id="sim-meet-mode" class="hidden" style="margin-top:14px;">
              <label class="stat-lbl">Load a meet field</label><select class="plain-select" id="sim-meet-select" style="min-width:280px;"></select>
              <div id="sim-meet-field"></div>
            </div>
            <div id="sim-source-meets" style="margin-top:14px;"><label class="stat-lbl">Use results from selected meets <span class="section-sub">(empty = all current-season results)</span></label><div id="sim-source-list" class="lineup-grid"></div></div>
            <div style="margin-top:14px;"><button class="btn-primary" id="sim-run" style="width:auto;"><i class="fa-solid fa-play"></i> Run Simulation</button>
              <button class="xbtn" id="sim-lineup-toggle" style="margin-left:8px;"><i class="fa-solid fa-user-pen"></i> Edit my lineup</button></div>
            <div id="sim-lineup" class="hidden" style="margin-top:14px;"></div>
          </div>
          <div id="sim-results" style="margin-top:1rem;"></div>
        </section>

        <section class="section-block" id="coachToolkit">
          <div class="section-head"><div><h2 class="section-heading">Upcoming Meet Outlook</h2><p class="section-sub">The meets ahead (with expected teams, same source as meet.html) and how your scoring 5 projects against every likely opponent.</p></div></div>
          <div id="outlookBody"><div class="spin"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Split Coach</h2><p class="section-sub">A pacing plan per athlete — built from their own PB curve, not a population average.</p></div>
            <div class="export-row">
              <select class="plain-select" id="split-course"><option value="">Default 5K course</option></select>
              <select class="plain-select" id="split-athlete"></select>
              <input class="plain-select" id="split-goal" type="number" min="300" step="1" placeholder="Goal time (sec, optional)" style="max-width:190px;">
            </div>
          </div>
          <div id="splitBody"></div>
        </section>

        <section class="section-block">
          <div class="section-head"><div><h2 class="section-heading">Mileage Plan Generator</h2><p class="section-sub">A week-by-week build to a goal race — down weeks, peak, taper, and day-by-day workouts.</p></div>
            <div class="export-row">
              <input class="plain-select" id="mp-race" type="text" placeholder="Race name (e.g. Regional)">
              <input class="plain-select" id="mp-date" type="date">
              <input class="plain-select" id="mp-current" type="number" min="5" max="120" value="25" title="Current weekly miles">
              <input class="plain-select" id="mp-peak" type="number" min="10" max="140" value="35" title="Peak weekly miles">
              <select class="plain-select" id="mp-days"><option value="6">6 days/wk</option><option value="7">7 days/wk</option><option value="5">5 days/wk</option><option value="4">4 days/wk</option><option value="3">3 days/wk</option></select>
              <select class="plain-select" id="mp-anchor"><option value="scorer">Paces: top scorer</option><option value="athlete">Paces: pick runner</option></select>
              <select class="plain-select" id="mp-athlete"><option value="">— pick a runner —</option></select>
              <button class="xbtn" id="mp-generate"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Plan</button>
            </div>
          </div>
          <div id="mpBody"><div class="empty-state" style="padding:1.5rem;"><i class="fa-solid fa-wand-magic-sparkles"></i><p>Set current & peak miles, a goal date, and Generate.</p></div></div>
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
        return `<tr><td data-label="#">${i + 1}</td><td data-label="Athlete">${esc(s.name)}</td><td data-label="Best Effort" class="mark-col">${fmt(s.best5k.timeSec)}</td><td data-label="Best MSM">${s.bestMsm ?? "—"}</td><td data-label="Races">${s.raceCount}</td><td data-label="Trend"><span class="pill ${t === "improving" ? "up" : t === "declining" ? "down" : "flat"}">${t}</span></td></tr>`;
      }).join("") || `<tr><td colspan="6" style="text-align:center;padding:1.5rem;">Need 5 runners with times.</td></tr>`;

      $("improveBody").innerHTML = ci.improvers.map((s) =>
              `<tr><td data-label="Athlete">${esc(s.name)}</td><td data-label="Current">${s.forecast.current}</td><td data-label="Rate" class="pos">+${s.forecast.slopePerWeek.toFixed(1)}/wk</td><td data-label="3-wk Projection">${s.forecast.projectedRating}</td></tr>`).join("")
              || `<tr><td colspan="4" style="text-align:center;padding:1.5rem;">No clear improvers yet.</td></tr>`;

      $("rosterBody").innerHTML = roster.map((s) =>
              `<tr><td data-label="Athlete">${esc(s.name)}</td><td data-label="Best Effort" class="mark-col">${s.best5k ? fmt(s.best5k.timeSec) : "—"}</td><td data-label="Best MSM">${s.bestMsm ?? "—"}</td><td data-label="5K Equiv">${s.best5k ? fmt(E().riegel(s.best5k.timeSec, s.best5k.distance, 5000)) : "—"}</td><td data-label="Races">${s.raceCount}</td><td data-label="Meets">${s.meetCount}</td></tr>`).join("")
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
      setupCoachToolkit(profile, gender);
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
      return `<tr><td data-label="#">${i + 1}</td><td data-label="Athlete">${esc(s.name)}</td><td data-label="Best Effort" class="mark-col">${fmt(t)}</td><td data-label="Best MSM">${s.bestMsm ?? "—"}</td><td data-label="Gap to Prev">${gap != null ? "+" + fmt(gap) : "—"}</td><td data-label="Role"><span class="pill ${i < 5 ? "up" : "flat"}">${role}</span></td></tr>`;
    }).join("")
    || `<tr><td colspan="6" style="text-align:center;padding:1.5rem;">No athletes found for this school.</td></tr>`;
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
    $("swBody").innerHTML = `<div class="app-list"><div class="list-header">Statewide Team Comparison</div>${list.map((t) => {
      const isMe = t.schoolSlug === schoolSlug;
      const rank = cmp.teams.indexOf(t) + 1;
      return `<div class="list-item">
        <div class="item-place">${rank}</div>
        <div class="item-details"><div class="item-name">${esc(t.school)}${isMe ? ' <span class="pill up" style="font-size:0.6rem;">YOU</span>' : ""}</div><div class="item-meta">Depth ${t.depth} · 1–5 gap ${t.spreadRating != null ? t.spreadRating : "—"}</div></div>
        <div class="item-score"><div class="score-stack"><span class="score-rating">${t.avgRating}</span><span class="score-predicted">Scoring 5 rating</span></div></div>
      </div>`;
    }).join("") || '<div class="empty-state">No data.</div>'}</div>`;
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

  function setupCoachToolkit(profile, gender) {
    // Fill the split-coach course select (all courses, 5K default first).
    const sel = $("split-course");
    if (sel && !sel.dataset.populated) {
      sel.innerHTML = '<option value="">Default 5K course</option>' +
        E().listCourses().map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}${c.difficulty ? " · " + esc(c.difficulty) : ""}</option>`).join("");
      sel.dataset.populated = "1";
    }
    if (window.MSMCoach) window.MSMCoach.init(profile, gender);
  }

  // =====================================================================
  //  MEET SIMULATOR (coach)
  // =====================================================================
  const simState = { mode: "teams", gender: "M", opponents: [], myLineup: null, sourceMeetSlugs: [] };
  function setupSimulator(profile, gender) {
    simState.mode = "teams";
    simState.gender = gender || "M";
    simState.opponents = [];
    simState.myLineup = null; // null = auto top 7
    simState.sourceMeetSlugs = [];
    const school = E().state.schoolsMap[profile.schoolSlug] || { name: profile.schoolSlug };

    // Course select (default to a 5K course if present)
    const courses = E().listCourses();
    $("sim-course").innerHTML = courses.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}${c.difficulty ? " · " + esc(c.difficulty) : ""}</option>`).join("");

    // Meet select used for the field itself.
    $("sim-meet-select").innerHTML = '<option value="">— Select a meet —</option>' +
      E().listMeets().map((m) => `<option value="${esc(m.slug)}">${esc(m.name)}${m.date ? " (" + String(m.date).split("T")[0] + ")" : ""}</option>`).join("");

    // Gender toggle: both divisions live in the same simulator. Rebuilding
    // the source selector also resets the default lineup to this division.
    $("sim-gender").querySelectorAll(".seg-btn").forEach((b) => {
      b.onclick = () => {
        simState.gender = b.dataset.g;
        $("sim-gender").querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
        setupSimulationSources(profile);
        renderLineupEditor(profile, simState.gender);
      };
    });

    // Mode toggle
    $("sim-mode").querySelectorAll(".seg-btn").forEach((b) => {
      b.onclick = () => {
        simState.mode = b.dataset.m;
        $("sim-mode").querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
        $("sim-teams-mode").classList.toggle("hidden", simState.mode !== "teams");
        $("sim-meet-mode").classList.toggle("hidden", simState.mode !== "meet");
      };
    });

    typeahead($("sim-team-input"), $("sim-team-drop"),
      () => E().listSchools().filter((s) => s.slug !== profile.schoolSlug && !simState.opponents.includes(s.slug)).map((s) => ({ name: s.name, slug: s.slug })),
      (item) => { simState.opponents.push(item.slug); $("sim-team-input").value = ""; renderOppChips(); });
    renderOppChips();

    $("sim-meet-select").onchange = () => {
      const slug = $("sim-meet-select").value;
      const m = E().listMeets().find((x) => x.slug === slug);
      if (m && m.course_slug) $("sim-course").value = m.course_slug;
      renderMeetFieldPreview(slug);
    };
    $("sim-course").onchange = () => { if ($("sim-meet-select").value) renderMeetFieldPreview($("sim-meet-select").value); };

    $("sim-lineup-toggle").onclick = () => {
      const box = $("sim-lineup");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) renderLineupEditor(profile, simState.gender);
    };

    $("sim-run").onclick = () => runSim(profile, simState.gender, school);
    setupSimulationSources(profile);
  }

  function setupSimulationSources(profile) {
    const box = $("sim-source-list");
    if (!box) return;
    const g = simState.gender;
    const seasonRows = E().state.results.filter((r) => r.gender === g && r.timeSec != null && r.school_slug && r.school_slug !== "unattached" && String(currentSeason) === String(new Date(r.date).getFullYear()) && !E().isNonCompetitive(r.meet_slug));
    const counts = {};
    seasonRows.forEach((r) => { counts[r.meet_slug] = (counts[r.meet_slug] || 0) + 1; });
    const meets = E().listMeets().filter((m) => counts[m.slug]).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    simState.sourceMeetSlugs = meets.slice(0, 3).map((m) => m.slug);
    box.innerHTML = meets.map((m) => `<label class="lineup-item"><input type="checkbox" data-sim-source="${esc(m.slug)}" ${simState.sourceMeetSlugs.includes(m.slug) ? "checked" : ""}> ${esc(m.name)} <small>${counts[m.slug]} results</small></label>`).join("") || '<div class="section-sub">No current-season results available for this division.</div>';
    box.querySelectorAll("input[data-sim-source]").forEach((cb) => cb.onchange = () => {
      simState.sourceMeetSlugs = [...box.querySelectorAll("input[data-sim-source]:checked")].map((x) => x.dataset.simSource);
    });
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

  // ---- Meet-mode field preview (expected teams, same source as meet.html) ----
  function renderMeetFieldPreview(meetSlug) {
    const box = $("sim-meet-field");
    if (!box) return;
    if (!meetSlug) { box.innerHTML = ""; return; }
    const meet = E().state.meetsMap[meetSlug] || {};
    const expected = E().meetExpectedTeams(meetSlug);
    const raced = new Set(E().state.results.filter((r) => r.meet_slug === meetSlug).map((r) => r.school_slug).filter(Boolean));
    if (!expected.length) {
      box.innerHTML = `<div class="section-sub" style="margin-top:10px;">No expected-teams list on this meet record — the sim will load the teams that raced there${meet.date ? " on " + esc(String(meet.date).split("T")[0]) : ""}.</div>`;
      return;
    }
    const chips = expected.map((t) =>
      `<a class="expected-team-chip" href="/CrossCountry/school.html?slug=${esc(t.slug)}" target="_blank" rel="noopener" title="Open ${esc(t.name)}">` +
      `<img src="/assets/team logos/${esc(t.slug)}.png" alt="" onerror="this.src='/assets/images/msmrunner.svg'">${esc(t.name)}</a>`).join("");
    box.innerHTML = `<div class="section-sub" style="margin-top:10px;"><strong>${expected.length} expected teams</strong> from the meet record.${expected.some((t) => raced.has(t.slug)) ? " Teams that have already raced there this season use their results from that meet when you run the sim." : ""}</div><div class="expected-teams-list">${chips}</div>`;
  }

  let lastSim = null;
  function runSim(profile, gender, school) {
    const courseSlug = $("sim-course").value;
    const basis = $("sim-basis").value;
    let teamList = [];

    if (simState.mode === "meet") {
      const meetSlug = $("sim-meet-select").value;
      if (!meetSlug) return toast("Pick a meet to load its field.");
      // Expected teams from the meet record (mirrors meet.html's
      // teams || expected_teams), unioned with teams that actually raced
      // there at this gender, plus the coach's own squad.
      const slugs = new Set(E().meetExpectedTeams(meetSlug).map((t) => t.slug));
      E().state.results.forEach((r) => { if (r.meet_slug === meetSlug && r.gender === gender && r.school_slug) slugs.add(r.school_slug); });
      slugs.add(profile.schoolSlug);
      teamList = [...slugs].map((s) => ({ schoolSlug: s, includedNames: s === profile.schoolSlug ? simState.myLineup : null }));
    } else {
      if (!simState.opponents.length) return toast("Add at least one opponent team.");
      teamList = [{ schoolSlug: profile.schoolSlug, includedNames: simState.myLineup }]
        .concat(simState.opponents.map((s) => ({ schoolSlug: s, includedNames: null })));
    }

    const sim = E().simulateMeet({ teamList, gender, season: currentSeason, courseSlug, basis, sourceMeetSlugs: simState.sourceMeetSlugs });
    const meetName = simState.mode === "meet" ? ((E().state.meetsMap[$("sim-meet-select").value] || {}).name || "") : "";
    lastSim = { sim, gender, courseName: (E().state.coursesMap[courseSlug] || {}).name || courseSlug, mySlug: profile.schoolSlug, meetName };
    renderSimResults(lastSim);
  }

  function renderSimResults(ctx) {
    const { sim, mySlug, courseName } = ctx;
    if (!sim.field.length) { $("sim-results").innerHTML = `<div class="empty-state"><i class="fa-solid fa-flag-checkered"></i><p>No runners to simulate. Check your teams and season.</p></div>`; return; }
    const distLabel = E().distanceLabel(sim.distance);
    const basisLabel = sim.basis === "raw" ? "fastest raw times (what-if)" : sim.basis === "recent" ? "weighted recent form from selected meets" : "best course-adjusted effort";

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

    // Determine winner (lowest score wins)
    const winnerSlug = sim.teams.filter((t) => t.score != null).sort((a, b) => a.score - b.score)[0]?.schoolSlug || "";

    // Team standings — wrap each row in a card with animation
    const standingsHTML = sim.teams.map((t, i) => {
      const isWinner = t.schoolSlug === winnerSlug && t.score != null;
      const isMine = t.schoolSlug === mySlug;
      return `<div class="sim-team-card${isWinner ? ' sim-winner' : ''}" style="margin-bottom:8px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-primary);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span class="sim-place" style="font-family:var(--font-display);font-size:1.4rem;font-weight:800;min-width:32px;">${t.complete ? i + 1 : "—"}</span>
        <span style="font-weight:700;font-size:0.9rem;flex:1;">${esc(t.school)}${isMine ? ' <span class="pill up" style="font-size:0.6rem;">YOU</span>' : ""}${t.complete ? "" : ' <span class="section-sub">(incomplete)</span>'}</span>
        <span class="sim-score" style="font-family:var(--font-display);font-size:1.3rem;font-weight:800;color:${isWinner ? 'var(--success, #10b981)' : 'var(--text-primary)'};">${t.score != null ? t.score : "—"}</span>
        <span style="font-size:0.78rem;color:var(--text-tertiary);">${t.teamAvg != null ? fmt(t.teamAvg) + ' avg' : ''}${t.spread15 != null ? ' · ' + fmt(t.spread15) + ' spread' : ''}</span>
        <span style="font-size:0.78rem;color:var(--text-tertiary);margin-left:auto;">${t.top5.map((r) => "#" + r.scoringPlace).filter((x) => !x.includes("null")).join(" ") || "—"}</span>
      </div>`;
    }).join("");

    const fieldHTML = sim.field.map((e) => {
      const isWinner = e.schoolSlug === winnerSlug && e.scoringPlace != null && e.scoringPlace <= 5;
      return `<tr style="${e.schoolSlug === mySlug ? "background:var(--bg-secondary);" : ""}${isWinner && e.place <= 7 ? "background:rgba(16,185,129,0.08);" : ""}">
        <td class="mark-col sim-place" style="font-family:var(--font-display);font-weight:800;">${e.place}</td>
        <td data-label="Athlete">${esc(e.name)}${isWinner ? ' <span class="pill up" style="font-size:0.55rem;">🏆</span>' : ""}</td>
        <td data-label="School">${esc((E().state.schoolsMap[e.schoolSlug] || {}).name || e.schoolSlug)}</td>
        <td class="mark-col">${fmt(e.timeSec)}</td>
        <td>${clock((e.timeSec / sim.distance) * E().MILE_M)}</td>
        <td class="mark-col">${e.scoringPlace ? "+" + e.scoringPlace : "—"}</td>
      </tr>`;
    }).join("");

    $("sim-results").innerHTML = `
      <div class="section-sub" style="margin-bottom:12px;">${ctx.meetName ? `Projected field for <strong>${esc(ctx.meetName)}</strong> — ` : ""}simulated on <strong>${esc(courseName)}</strong> at ${distLabel}, using ${basisLabel}. ${sim.teams.filter((t) => t.complete).length} scoring teams · ${sim.field.length} runners.</div>
      <div class="section-head" style="margin-bottom:0.6rem;"><h3 class="section-heading" style="font-size:1.05rem;">Projected Team Standings</h3></div>
      <div class="sim-results animating">${standingsHTML}</div>
      <div class="section-head" style="margin-bottom:0.6rem;margin-top:1rem;"><h3 class="section-heading" style="font-size:1.05rem;">Projected Individual Finish</h3></div>
      <div class="table-card"><table class="rt"><thead><tr><th>Place</th><th>Athlete</th><th>School</th><th>Proj Time</th><th>Pace/Mi</th><th>Pts</th></tr></thead><tbody>${fieldHTML}</tbody></table></div>
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
    doc.text(`${courseName} · ${E().distanceLabel(sim.distance)} · ${sim.basis === "raw" ? "fastest raw what-if" : sim.basis === "recent" ? "weighted recent form" : "best course-adjusted effort"} · ${new Date().toLocaleDateString()}`, 14, 25);
    doc.autoTable({ head: [["Place", "School", "Score", "Top-5 Avg", "1-5 Split"]], body: sim.teams.map((t, i) => [t.complete ? i + 1 : "—", t.school, t.score ?? "—", t.teamAvg != null ? fmt(t.teamAvg) : "—", t.spread15 != null ? fmt(t.spread15) : "—"]), startY: 31, styles: { fontSize: 9 }, headStyles: { fillColor: [0, 0, 0] } });
    doc.autoTable({ head: [["Place", "Athlete", "School", "Proj Time", "Pace/Mi", "Pts"]], body: sim.field.map((e) => [e.place, e.name, (E().state.schoolsMap[e.schoolSlug] || {}).name || e.schoolSlug, fmt(e.timeSec), clock((e.timeSec / sim.distance) * E().MILE_M), e.scoringPlace ?? "—"]), startY: doc.lastAutoTable.finalY + 8, styles: { fontSize: 8 }, headStyles: { fillColor: [0, 0, 0] } });
    doc.save(`meet_simulation_${gender}.pdf`); toast("✓ Simulation PDF");
  }

  // =====================================================================
  //  FAN DASHBOARD — enhanced with live feed, team review, expected teams, rankings
  // =====================================================================
  const FAN_SECTIONS = ["liveFeed", "teamReview", "expectedTeams", "meetSim", "rankings", "follow"];
  const FAN_SECTION_LABELS = { liveFeed: "Live Feed", teamReview: "Team Review", expectedTeams: "Expected Teams", meetSim: "Meet Sim", rankings: "Rankings", follow: "Follow" };
  let fanActiveSection = "liveFeed";

  function renderFan(profile) {
    $("dashTitle").textContent = "Fan Zone";
    $("dashSub").textContent = "Live results, team matchups, meet sims, and the state rankings.";
    const follows = (profile.follows) || { athletes: [], schools: [] };

    $("dashBody").innerHTML = `
      <!-- Fan section nav -->
      <div class="fan-nav" id="fanNav"></div>

      <!-- Live Results Feed -->
      <section class="section-block" id="sec-liveFeed">
        <div class="section-head"><div><h2 class="section-heading"><i class="fa-solid fa-bolt" style="color:var(--danger, #ef4444);"></i> Live Results Feed</h2><p class="section-sub">Recent results across West Virginia — updates as races are logged.</p></div>
          <div class="export-row">
            <select class="plain-select" id="live-gender"><option value="all">All</option><option value="M">Boys</option><option value="F">Girls</option></select>
            <select class="plain-select" id="live-limit"><option value="20">Last 20</option><option value="50">Last 50</option><option value="100">Last 100</option></select>
          </div>
        </div>
        <div class="card" style="padding:0;overflow:hidden;">
          <div class="live-ticker" id="liveTicker" style="overflow-y:auto;max-height:480px;"></div>
        </div>
      </section>

      <!-- Team Review -->
      <section class="section-block" id="sec-teamReview">
        <div class="section-head"><div><h2 class="section-heading"><i class="fa-solid fa-clipboard-list"></i> Team Review</h2><p class="section-sub">Dive into any school's roster, recent results, and trends.</p></div></div>
        <div class="card">
          <div class="sim-controls" style="margin-bottom:14px;">
            <div class="field-inline"><label class="stat-lbl">School</label><select class="plain-select" id="teamReview-school" style="min-width:280px;"></select></div>
            <div class="field-inline"><label class="stat-lbl">Gender</label><select class="plain-select" id="teamReview-gender"><option value="M">Boys</option><option value="F">Girls</option></select></div>
            <div class="field-inline"><label class="stat-lbl">Season</label><select class="plain-select" id="teamReview-season"></select></div>
          </div>
          <div id="teamReview-body"><div class="spin"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div></div>
        </div>
      </section>

      <!-- Expected Teams Matchup -->
      <section class="section-block" id="sec-expectedTeams">
        <div class="section-head"><div><h2 class="section-heading"><i class="fa-solid fa-trophy"></i> Expected Teams</h2><p class="section-sub">Load a meet's expected field (same source as meet.html), see every team as a chip, and head-to-head any two.</p></div></div>
        <div class="card">
          <div class="sim-controls" style="margin-bottom:14px;">
            <div class="field-inline"><label class="stat-lbl">Meet</label><select class="plain-select" id="exp-meet-picker" style="min-width:280px;"></select></div>
            <div class="field-inline" style="flex:1;"><label class="stat-lbl">Course</label><select class="plain-select" id="exp-course"></select></div>
            <div class="field-inline"><label class="stat-lbl">Team A</label><select class="plain-select" id="exp-teamA" style="min-width:200px;"></select></div>
            <div class="field-inline"><label class="stat-lbl">Team B</label><select class="plain-select" id="exp-teamB" style="min-width:200px;"></select></div>
            <div class="field-inline"><label class="stat-lbl">Time basis</label><select class="plain-select" id="exp-basis"><option value="adjusted">Course-adjusted</option><option value="raw">Season-best raw</option></select></div>
          </div>
          <div id="exp-field" style="margin-bottom:14px;"></div>
          <div id="exp-results"><div class="empty-state"><i class="fa-solid fa-columns"></i><p>Select two teams to compare.</p></div></div>
        </div>
      </section>

      <!-- Meet Simulation (enhanced) -->
      <section class="section-block" id="sec-meetSim">
        <div class="section-head"><div><h2 class="section-heading"><i class="fa-solid fa-flag-checkered"></i> Meet Simulator</h2><p class="section-sub">Build the field, project places & team scores. Times are course-adjusted from each runner's season.</p></div>
          <div class="export-row"><button class="xbtn" id="sim-csv"><i class="fa-solid fa-file-csv"></i> Sim CSV</button><button class="xbtn" id="sim-pdf"><i class="fa-solid fa-file-pdf"></i> Sim PDF</button><button class="xbtn" id="sim-reset"><i class="fa-solid fa-rotate-left"></i> Reset</button></div></div></div>
        <div class="card">
          <div class="sim-controls">
            <div class="field-inline"><label class="stat-lbl">Your school</label><select class="plain-select" id="sim-my-school" style="min-width:200px;"></select></div>
            <div class="field-inline"><label class="stat-lbl">Field source</label>
              <div class="seg" id="sim-mode"><button class="seg-btn active" data-m="teams">Pick teams</button><button class="seg-btn" data-m="meet">Load a meet</button></div>
            </div>
            <div class="field-inline"><label class="stat-lbl">Course</label><select class="plain-select" id="sim-course"></select></div>
            <div class="field-inline"><label class="stat-lbl">Time basis</label><select class="plain-select" id="sim-basis"><option value="recent">Recent form · last 3 meets</option><option value="adjusted">Best course-adjusted effort</option><option value="raw">Fastest raw time · what-if</option></select></div>
            <div class="field-inline"><label class="stat-lbl">Division</label><div class="seg" id="sim-gender"><button class="seg-btn active" data-g="M">Boys</button><button class="seg-btn" data-g="F">Girls</button></div></div>
          </div>
          <div id="sim-teams-mode" style="margin-top:14px;">
            <div class="ta-wrap"><label class="stat-lbl">Add opponent teams</label><input class="ta-input" id="sim-team-input" placeholder="Search schools to add…"><div class="ta-drop" id="sim-team-drop"></div></div>
            <div class="follow-chips" id="sim-team-chips"></div>
          </div>
          <div id="sim-meet-mode" class="hidden" style="margin-top:14px;">
            <label class="stat-lbl">Load a meet field</label><select class="plain-select" id="sim-meet-select" style="min-width:280px;"></select>
            <div id="sim-meet-field"></div>
          </div>
          <div id="sim-source-meets" style="margin-top:14px;"><label class="stat-lbl">Use results from selected meets <span class="section-sub">(empty = all current-season results)</span></label><div id="sim-source-list" class="lineup-grid"></div></div>
          <div style="margin-top:14px;"><button class="btn-primary" id="sim-run" style="width:auto;"><i class="fa-solid fa-play"></i> Run Simulation</button>
            <button class="xbtn" id="sim-lineup-toggle" style="margin-left:8px;"><i class="fa-solid fa-user-pen"></i> Edit my lineup</button></div>
          <div id="sim-lineup" class="hidden" style="margin-top:14px;"></div>
        </div>
        <div id="sim-results" style="margin-top:1rem;"></div>
      </section>

      <!-- Rankings -->
      <section class="section-block" id="sec-rankings">
        <div class="section-head"><div><h2 class="section-heading"><i class="fa-solid fa-list-ol"></i> State Leaderboard</h2><p class="section-sub">Top MSM ratings. Filter by gender, season, and school.</p></div>
          <div class="export-row">
            <select class="plain-select" id="lb-gender"><option value="M">Boys</option><option value="F">Girls</option></select>
            <select class="plain-select" id="lb-season"><option value="all">All-Time</option></select>
            <select class="plain-select" id="lb-school"><option value="">All Schools</option></select>
            <button class="xbtn" id="lb-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
          </div>
        </div>
        <div class="table-card"><table class="rt"><thead><tr><th>#</th><th>Athlete</th><th>School</th><th>Best MSM</th><th>5K Equiv</th><th>Trend</th></tr></thead><tbody id="lbBody"></tbody></table></div>
      </section>

      <!-- Follow Athletes (collapsible) -->
      <section class="section-block" id="sec-follow">
        <div class="section-head"><div><h2 class="section-heading"><i class="fa-solid fa-heart"></i> Follow Athletes</h2><p class="section-sub">Follow runners to see them in compare and your feed.</p></div></div>
        <div class="card">
          <div class="ta-wrap"><input class="ta-input" id="fanFollowInput" placeholder="Search athletes to follow…"><div class="ta-drop" id="fanFollowDrop"></div></div>
          <div class="follow-chips" id="followChips" style="margin-top:12px;"></div>
        </div>
      </section>
    `;

    // --- Fan section navigation ---
    buildFanNav();
    switchFanSection(fanActiveSection);

    // --- Live feed ---
    wireLiveFeed();

    // --- Team review ---
    wireTeamReview(profile);

    // --- Expected teams ---
    wireExpectedTeams();

    // --- Meet sim (fan-friendly: let them pick a school) ---
    setupSimulatorFan(profile);
    $("sim-csv").onclick = simExportCSV;
    $("sim-pdf").onclick = simExportPDF;
    $("sim-reset").onclick = () => { simState.opponents = []; simState.myLineup = null; renderOppChips(); $("sim-results").innerHTML = ""; };

    // --- Rankings ---
    wireRankings();

    // --- Follow ---
    typeahead($("fanFollowInput"), $("fanFollowDrop"), () => E().listAthleteNames(), async (item) => {
      $("fanFollowInput").value = "";
      await A().toggleFollowAthlete(item.name);
    });
    renderFollowChips();

  }

  // ---- Fan section navigation ----
  function buildFanNav() {
    const nav = $("fanNav");
    if (!nav) return;
    nav.innerHTML = FAN_SECTIONS.map((id) => {
      const label = FAN_SECTION_LABELS[id];
      return `<button class="fan-nav-btn${id === fanActiveSection ? ' active' : ''}" data-section="${id}">${label}</button>`;
    }).join("");
    nav.querySelectorAll(".fan-nav-btn").forEach((btn) => {
      btn.onclick = () => switchFanSection(btn.dataset.section);
    });
  }
  function switchFanSection(id) {
    fanActiveSection = id;
    $("fanNav").querySelectorAll(".fan-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.section === id));
    FAN_SECTIONS.forEach((sid) => {
      const el = document.getElementById("sec-" + sid);
      if (el) el.classList.toggle("hidden", sid !== id);
    });
    // Re-draw dynamic content when switching to a section
    if (id === "liveFeed") wireLiveFeed();
    else if (id === "teamReview") wireTeamReview(A().profile);
    else if (id === "expectedTeams") wireExpectedTeams();
    else if (id === "rankings") wireRankings();
  }

  // ---- Live results feed ----
  let liveFeedObserver = null;
  function wireLiveFeed() {
    const genderSel = $("live-gender"); const limitSel = $("live-limit");
    const ticker = $("liveTicker");
    if (!ticker) return;
    const gender = genderSel ? genderSel.value : "all";
    const limit = limitSel ? parseInt(limitSel.value, 10) : 20;

    // Build the feed from current data
    const rows = E().state.results
      .filter((r) => gender === "all" || r.gender === gender)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, limit);

    if (!rows.length) {
      ticker.innerHTML = '<div class="empty-state"><i class="fa-solid fa-flag"></i><p>No results yet. Check back after the next race.</p></div>';
      return;
    }

    // Group by meet for a cleaner display
    const byMeet = {};
    rows.forEach((r) => {
      const m = r.meet_slug || "unknown";
      if (!byMeet[m]) byMeet[m] = { meet: r.meet, meet_slug: m, date: r.date, results: [] };
      byMeet[m].results.push(r);
    });

    ticker.innerHTML = Object.values(byMeet)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .map((group) => {
        const meetName = group.meet?.name || group.meet_slug;
        const dateStr = group.date ? new Date(group.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
        return `<div class="live-meet-group">
          <div class="live-meet-head">
            <span class="live-meet-name">${esc(meetName)}</span>
            <span class="live-meet-date">${dateStr}</span>
          </div>
          <table class="rt"><thead><tr><th>Athlete</th><th>School</th><th>Time</th><th>MSM</th><th>Place</th></tr></thead>
          <tbody>${group.results.map((r) => `<tr>
            <td data-label="Athlete">${esc(r.athlete_name)}</td>
            <td data-label="School">${esc((E().state.schoolsMap[r.school_slug] || {}).name || r.school_slug)}</td>
            <td data-label="Time" class="mark-col">${fmt(r.timeSec)}</td>
            <td data-label="MSM">${r.msm ?? "—"}</td>
            <td data-label="Place">${r.place ? r.place + ordinal(r.place) : "—"}</td>
          </tr>`).join("")}</tbody>
        </div>`;
      }).join("");

    // Note: For true live updates, you'd attach a Firebase observer here.
    // The current implementation shows the latest loaded data.
  }

  // ---- Team review ----
  let teamReviewData = null;
  function wireTeamReview(profile) {
    const schoolSel = $("teamReview-school");
    const genderSel = $("teamReview-gender");
    const seasonSel = $("teamReview-season");
    const body = $("teamReview-body");
    if (!schoolSel || !body) return;

    // Populate school select
    if (!schoolSel.dataset.populated) {
      const schools = E().listSchools();
      schoolSel.innerHTML = schools.map((s) => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join("");
      schoolSel.dataset.populated = "1";
    }

    // Populate season select
    if (!seasonSel.dataset.populated) {
      const seasons = E().listSeasons();
      seasonSel.innerHTML = '<option value="all">All-Time</option>' + seasons.map((y) => `<option value="${y}">${y} Season</option>`).join("");
      seasonSel.dataset.populated = "1";
    }

    const slug = schoolSel.value || (profile.schoolSlug || "");
    const gender = genderSel.value;
    const season = seasonSel.value;
    schoolSel.value = slug;

    drawTeamReview(slug, gender, season);

    schoolSel.onchange = () => drawTeamReview(schoolSel.value, genderSel.value, seasonSel.value);
    genderSel.onchange = () => drawTeamReview(schoolSel.value, genderSel.value, seasonSel.value);
    seasonSel.onchange = () => drawTeamReview(schoolSel.value, genderSel.value, seasonSel.value);
  }
  function drawTeamReview(slug, gender, season) {
    const body = $("teamReview-body");
    if (!body) return;
    const school = E().state.schoolsMap[slug] || { name: slug };
    const roster = E().rosterForSchool(slug, gender, season);
    const insights = E().teamInsights(roster);

    if (!roster.length) {
      body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-school"></i><p>No results for ${esc(school.name)} in this season.</p></div>`;
      return;
    }

    const cmp = E().teamStatewideComparison(slug, gender, season);

    body.innerHTML = `
      <div class="section-head" style="margin-bottom:14px;">
        <div><h3 class="section-heading" style="font-size:1.1rem;">${esc(school.name)}</h3><p class="section-sub">${gender === "M" ? "Boys" : "Girls"} · ${roster.length} athletes · ${season === "all" ? "all-time" : season + " season"}</p></div>
        <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);gap:8px;">
          <div class="stat-card hl"><div class="stat-lbl">Scoring 5 Avg</div><div class="stat-val" style="font-size:1.2rem;">${insights.scoringAvg != null ? fmt(insights.scoringAvg) : "—"}</div></div>
          <div class="stat-card"><div class="stat-lbl">1–5 Spread</div><div class="stat-val" style="font-size:1.2rem;">${insights.spread15 != null ? fmt(insights.spread15) : "—"}</div></div>
          <div class="stat-card"><div class="stat-lbl">State Rank</div><div class="stat-val" style="font-size:1.2rem;">${cmp.rank ? cmp.rank + ordinal(cmp.rank) : "—"}</div><div class="stat-sub">of ${cmp.total}</div></div>
        </div>
      </div>

      <div class="charts-grid" style="grid-template-columns:1fr 1fr;">
        <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Top 7 — Best Efforts</div></div></div><div class="chart-wrap" style="height:200px;"><canvas id="tr-chartTop7"></canvas></div></div>
        <div class="chart-card"><div class="chart-card-head"><div><div class="chart-card-title">Rating Distribution</div></div></div><div class="chart-wrap" style="height:200px;"><canvas id="tr-chartDist"></canvas></div></div>
      </div>

      <div class="table-card" style="margin-top:1rem;"><table class="rt"><thead><tr><th>#</th><th>Athlete</th><th>Best Effort</th><th>Best MSM</th><th>5K Equiv</th><th>Races</th><th>Trend</th></tr></thead><tbody>${roster.map((s, i) => `<tr>
        <td data-label="#">${i + 1}</td>
        <td data-label="Athlete">${esc(s.name)}</td>
        <td data-label="Best Effort" class="mark-col">${s.best5k ? fmt(s.best5k.timeSec) : "—"}</td>
        <td data-label="Best MSM">${s.bestMsm ?? "—"}</td>
        <td data-label="5K Equiv">${s.best5k ? fmt(E().riegel(s.best5k.timeSec, s.best5k.distance, 5000)) : "—"}</td>
        <td data-label="Races">${s.raceCount}</td>
        <td data-label="Trend"><span class="pill ${s.forecast && s.forecast.trend === "improving" ? "up" : s.forecast && s.forecast.trend === "declining" ? "down" : "flat"}">${s.forecast ? s.forecast.trend : "—"}</span></td>
      </tr>`).join("")}</tbody></table></div>
    `;

    // Charts
    if (charts["tr-chartTop7"]) charts["tr-chartTop7"].destroy();
    const c = chartTheme();
    const top7 = roster.slice(0, 7);
    makeChart("tr-chartTop7", {
      type: "bar", data: { labels: top7.map((s) => s.name), datasets: [{ data: top7.map((s) => s.best5k ? s.best5k.timeSec : 0), backgroundColor: c.fill, borderColor: c.line, borderWidth: 1.5, borderRadius: 4 }] },
      options: Object.assign({}, baseOpts("Best Effort", "", true), { indexAxis: "y", scales: Object.assign({}, baseOpts().scales, { x: Object.assign({}, baseOpts().scales.x, { ticks: Object.assign({}, baseOpts().scales.x.ticks, { callback: (v) => fmt(v) }) }) }) })
    });

    if (charts["tr-chartDist"]) charts["tr-chartDist"].destroy();
    const ratings = roster.map((s) => s.bestMsm).filter((v) => v != null);
    if (ratings.length) {
      const min = Math.min(...ratings), max = Math.max(...ratings);
      const bins = 5, size = Math.max(1, (max - min) / bins);
      const counts = new Array(bins).fill(0), labels = [];
      for (let i = 0; i < bins; i++) labels.push(`${Math.round(min + i * size)}–${Math.round(min + (i + 1) * size)}`);
      ratings.forEach((r) => { let idx = Math.min(bins - 1, Math.floor((r - min) / size)); counts[idx]++; });
      makeChart("tr-chartDist", { type: "bar", data: { labels, datasets: [{ data: counts, backgroundColor: c.fill, borderColor: c.line, borderWidth: 1.5, borderRadius: 4 }] }, options: baseOpts("Athletes", "MSM Rating") });
    }
  }

  // ---- Expected teams matchup ----
  let expState = { teamA: "", teamB: "", course: "", basis: "adjusted", meetSlug: "" };
  let expLoadedMeets = [];
  function wireExpectedTeams() {
    const courseSel = $("exp-course");
    const teamASel = $("exp-teamA");
    const teamBSel = $("exp-teamB");
    const basisSel = $("exp-basis");
    const meetPicker = $("exp-meet-picker");
    const results = $("exp-results");
    if (!courseSel || !teamASel || !teamBSel || !results) return;

    // Populate
    if (!courseSel.dataset.populated) {
      const courses = E().listCourses();
      courseSel.innerHTML = courses.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}${c.difficulty ? " · " + esc(c.difficulty) : ""}</option>`).join("");
      courseSel.dataset.populated = "1";
    }
    if (!teamASel.dataset.populated) {
      const schools = E().listSchools();
      teamASel.innerHTML = schools.map((s) => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join("");
      teamBSel.innerHTML = schools.map((s) => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join("");
      teamASel.dataset.populated = "1"; teamBSel.dataset.populated = "1";
    }

    // Populate meet picker from Firebase meets that have expected_teams
    if (!meetPicker.dataset.populated) {
      const upcomingOption = document.createElement("option");
      upcomingOption.value = "";
      upcomingOption.textContent = "Pick a meet (optional)…";
      meetPicker.appendChild(upcomingOption);
      meetPicker.dataset.populated = "1";
    }

    const courses = E().listCourses();
    const course = courses[0] ? courses[0].slug : "";
    courseSel.value = course; expState.course = course;

    const defaultA = teamASel.options[0] ? teamASel.options[0].value : "";
    const defaultB = teamBSel.options[1] ? teamBSel.options[1].value : "";
    teamASel.value = defaultA; teamBSel.value = defaultB;
    expState.teamA = defaultA; expState.teamB = defaultB;

    drawExpectedTeams();

    courseSel.onchange = () => { expState.course = courseSel.value; drawExpectedTeams(); };
    teamASel.onchange = () => { expState.teamA = teamASel.value; drawExpectedTeams(); };
    teamBSel.onchange = () => { expState.teamB = teamBSel.value; drawExpectedTeams(); };
    basisSel.onchange = () => { expState.basis = basisSel.value; drawExpectedTeams(); };
    meetPicker.onchange = () => {
      expState.meetSlug = meetPicker.value;
      const meet = expLoadedMeets.find((m) => m.slug === meetPicker.value);
      if (meet && meet.expected && meet.expected.length >= 2) {
        const teams = meet.expected.map((t) => t.slug).filter(Boolean);
        teamASel.value = teams[0];
        teamBSel.value = teams[1];
        expState.teamA = teams[0];
        expState.teamB = teams[1];
        if (meet.course_slug) { courseSel.value = meet.course_slug; expState.course = meet.course_slug; }
        drawExpectedTeams();
      } else {
        drawExpectedTeams();
      }
    };

    // Load meets with expected teams from Firebase, then preselect the
    // soonest one so the section is alive on first open (meet.html parity).
    loadExpectedTeamsMeets().then(() => {
      if (expLoadedMeets.length) {
        meetPicker.value = expLoadedMeets[0].slug;
        meetPicker.onchange();
      }
    });
  }
  async function loadExpectedTeamsMeets() {
    const meetPicker = $("exp-meet-picker");
    if (!meetPicker) return;
    try {
      const db = window.firebaseDatabase;
      if (!db) { console.warn("Firebase not ready for expected teams"); return; }
      const snapshot = await db.ref("crosscountry/meets").once("value");
      const meets = [];
      snapshot.forEach((child) => {
        const m = child.val();
        // Accept either spelling; resolve entries to {slug, name} like meet.html.
        const raw = m && (m.teams || m.expected_teams);
        const count = Array.isArray(raw) ? raw.length : (raw ? Object.keys(raw).length : 0);
        if (m && count >= 2 && m.date) {
          // Resolve by the record's own slug (the meets map is keyed by slug,
          // not by the Firebase push key).
          meets.push({ slug: child.key, ...m, expected: E().meetExpectedTeams(m.slug || child.key) });
        }
      });
      // Sort by date, most recent first
      // Upcoming meets first (soonest), then past meets (most recent) —
      // the default pick should always be the next meet on the calendar.
      const todayStr = new Date().toISOString().split("T")[0];
      const up = meets.filter((m) => String(m.date).split("T")[0] >= todayStr).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const past = meets.filter((m) => String(m.date).split("T")[0] < todayStr).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      expLoadedMeets = up.concat(past);

      // Keep the placeholder, remove old options
      Array.from(meetPicker.options).slice(1).forEach((o) => o.remove());

      meets.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.slug;
        const dateStr = m.date ? new Date(m.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
        const teamCount = (m.expected_teams || []).length;
        opt.textContent = `${esc(m.name || m.slug)} — ${esc(dateStr)} (${teamCount} teams)`;
        meetPicker.appendChild(opt);
      });
    } catch (e) {
      console.warn("Could not load expected teams meets:", e);
    }
  }
  function drawExpectedTeams() {
    const results = $("exp-results");
    if (!results) return;
    const { teamA, teamB, course, basis } = expState;

    // Full expected field for the selected meet, rendered as chips (meet.html style).
    const fieldBox = $("exp-field");
    if (fieldBox) {
      const meet = expLoadedMeets.find((m) => m.slug === expState.meetSlug);
      if (meet) {
        const raced = new Set(E().state.results.filter((r) => r.meet_slug === meet.slug).map((r) => r.school_slug).filter(Boolean));
        fieldBox.innerHTML = `<div class="section-sub" style="margin:10px 0 6px;"><strong>${meet.expected.length} expected teams</strong> for ${esc(meet.name || meet.slug)}${meet.date ? " · " + esc(String(meet.date).split("T")[0]) : ""} — from the meet record, same as meet.html. Click a chip to open the team page.</div>` +
          `<div class="expected-teams-list">` + meet.expected.map((t) =>
            `<a class="expected-team-chip" href="/CrossCountry/school.html?slug=${esc(t.slug)}" target="_blank" rel="noopener" title="Open ${esc(t.name)}">` +
            `<img src="/assets/team logos/${esc(t.slug)}.png" alt="" onerror="this.src='/assets/images/msmrunner.svg'">${esc(t.name)}</a>`).join("") + `</div>`;
      } else {
        fieldBox.innerHTML = `<div class="section-sub" style="margin:10px 0 6px;">Pick a meet to load its expected field, or choose any two schools below for a head-to-head.</div>`;
      }
    }

    if (!teamA || !teamB || teamA === teamB) {
      results.innerHTML = '<div class="empty-state"><i class="fa-solid fa-columns"></i><p>Select two different teams to compare.</p></div>';
      return;
    }

    const season = currentSeason;
    const dist = course ? (E().state.coursesMap[course] && parseInt(E().state.coursesMap[course].distance, 10)) || 5000 : 5000;

    const rosterA = E().rosterForSchool(teamA, "M", season);
    const rosterB = E().rosterForSchool(teamB, "M", season);
    const summaryA = rosterA.map((s) => ({ name: s.name, proj: E().athleteProjectedTime(s, course, dist, basis) }));
    const summaryB = rosterB.map((s) => ({ name: s.name, proj: E().athleteProjectedTime(s, course, dist, basis) }));

    const field = [];
    summaryA.forEach((e) => { if (e.proj) field.push({ name: e.name, schoolSlug: teamA, timeSec: e.proj.timeSec, projected: e.proj.projected, source: e.proj.source }); });
    summaryB.forEach((e) => { if (e.proj) field.push({ name: e.name, schoolSlug: teamB, timeSec: e.proj.timeSec, projected: e.proj.projected, source: e.proj.source }); });
    field.sort((a, b) => a.timeSec - b.timeSec);
    field.forEach((e, i) => { e.place = i + 1; });

    const bySchool = {};
    field.forEach((e) => { (bySchool[e.schoolSlug] = bySchool[e.schoolSlug] || []).push(e); });
    const scoringSchools = new Set(Object.keys(bySchool).filter((s) => bySchool[s].length >= 5));
    let counter = 0;
    field.forEach((e) => { e.scoringPlace = scoringSchools.has(e.schoolSlug) ? ++counter : null; });

    const teamAInfo = bySchool[teamA] ? {
      score: (bySchool[teamA].filter((e) => e.scoringPlace).length === 5 && scoringSchools.has(teamA))
        ? bySchool[teamA].filter((e) => e.scoringPlace).slice(0, 5).reduce((s, r) => s + r.scoringPlace, 0) : null,
      avg: bySchool[teamA].slice(0, 5).reduce((s, r) => s + r.timeSec, 0) / Math.min(5, bySchool[teamA].length),
      runners: bySchool[teamA].slice(0, 7),
      depth: bySchool[teamA].length,
    } : null;
    const teamBInfo = bySchool[teamB] ? {
      score: (bySchool[teamB].filter((e) => e.scoringPlace).length === 5 && scoringSchools.has(teamB))
        ? bySchool[teamB].filter((e) => e.scoringPlace).slice(0, 5).reduce((s, r) => s + r.scoringPlace, 0) : null,
      avg: bySchool[teamB].slice(0, 5).reduce((s, r) => s + r.timeSec, 0) / Math.min(5, bySchool[teamB].length),
      runners: bySchool[teamB].slice(0, 7),
      depth: bySchool[teamB].length,
    } : null;

    const winner = teamAInfo && teamBInfo && teamAInfo.score != null && teamBInfo.score != null
      ? (teamAInfo.score < teamBInfo.score ? teamA : teamB)
      : (teamAInfo && teamBInfo && teamAInfo.avg < teamBInfo.avg ? teamA : teamB);

    const courseName = (E().state.coursesMap[course] || {}).name || course;

    results.innerHTML = `
      <div class="section-sub" style="margin-bottom:12px;">Projected matchup on <strong>${esc(courseName)}</strong> at ${E().distanceLabel(dist)} · ${basis === "raw" ? "season-best raw times" : "course-adjusted projections"}.</div>

      <div class="stat-grid" style="margin-bottom:1rem;gap:12px;">
        <div class="exp-team-card" style="padding:16px 18px;border:2px solid ${teamA === winner ? 'var(--success, #10b981)' : 'var(--border)'};border-radius:var(--radius-lg);background:var(--bg-primary);animation:fadeSlideUp 0.3s ease both;">
          <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary);margin-bottom:4px;">${esc((E().state.schoolsMap[teamA] || {}).name || teamA)}</div>
          <div class="exp-team-score" style="font-family:var(--font-display);font-size:2rem;font-weight:800;color:${teamA === winner ? 'var(--success, #10b981)' : 'var(--text-primary)'};line-height:1;">${teamAInfo && teamAInfo.score != null ? teamAInfo.score : "—"}</div>
          <div style="font-size:0.78rem;color:var(--text-tertiary);margin-top:4px;">${teamAInfo ? teamAInfo.depth + ' runners · ' + (teamAInfo.avg != null ? fmt(teamAInfo.avg) + ' avg' : '') : ''}</div>
        </div>
        <div class="exp-team-card" style="padding:16px 18px;border:2px solid ${teamB === winner ? 'var(--success, #10b981)' : 'var(--border)'};border-radius:var(--radius-lg);background:var(--bg-primary);animation:fadeSlideUp 0.3s ease 0.05s both;">
          <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary);margin-bottom:4px;">${esc((E().state.schoolsMap[teamB] || {}).name || teamB)}</div>
          <div class="exp-team-score" style="font-family:var(--font-display);font-size:2rem;font-weight:800;color:${teamB === winner ? 'var(--success, #10b981)' : 'var(--text-primary)'};line-height:1;">${teamBInfo && teamBInfo.score != null ? teamBInfo.score : "—"}</div>
          <div style="font-size:0.78rem;color:var(--text-tertiary);margin-top:4px;">${teamBInfo ? teamBInfo.depth + ' runners · ' + (teamBInfo.avg != null ? fmt(teamBInfo.avg) + ' avg' : '') : ''}</div>
        </div>
      </div>

      <div class="section-sub" style="margin-bottom:8px;color:var(--text-tertiary);font-size:0.82rem;">${winner ? esc((E().state.schoolsMap[winner] || {}).name || winner) + ' wins' : 'Select two teams to compare'}</div>

      <div class="table-card"><table class="rt"><thead><tr><th>Place</th><th>Athlete</th><th>School</th><th>Proj Time</th><th>Pace/Mi</th><th>Pts</th></tr></thead><tbody>
        ${field.map((e) => `<tr style="${e.schoolSlug === winner && e.place <= 5 ? "background:rgba(16,185,129,0.08);font-weight:600;" : ""}">
          <td class="mark-col sim-place" style="font-family:var(--font-display);font-weight:800;">${e.place}</td>
          <td data-label="Athlete">${esc(e.name)}${e.schoolSlug === winner && e.place <= 5 ? ' <span class="pill up" style="font-size:0.55rem;">🏆</span>' : ""}</td>
          <td data-label="School">${esc((E().state.schoolsMap[e.schoolSlug] || {}).name || e.schoolSlug)}</td>
          <td class="mark-col">${fmt(e.timeSec)}</td>
          <td>${clock((e.timeSec / dist) * E().MILE_M)}</td>
          <td class="mark-col">${e.scoringPlace ? "+" + e.scoringPlace : "—"}</td>
        </tr>`).join("")}
      </tbody></table></div>
    `;
  }

  // ---- Rankings with filters ----
  let rankGender = "M", rankSeason = "all", rankSchool = "";
  function wireRankings() {
    const genderSel = $("lb-gender");
    const seasonSel = $("lb-season");
    const schoolSel = $("lb-school");
    if (!genderSel || !seasonSel || !schoolSel) return;

    // Populate seasons
    if (!seasonSel.dataset.populated) {
      const seasons = E().listSeasons();
      seasonSel.innerHTML = '<option value="all">All-Time</option>' + seasons.map((y) => `<option value="${y}">${y} Season</option>`).join("");
      seasonSel.dataset.populated = "1";
    }

    // Populate schools
    if (!schoolSel.dataset.populated) {
      const schools = E().listSchools();
      schoolSel.innerHTML = '<option value="">All Schools</option>' + schools.map((s) => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join("");
      schoolSel.dataset.populated = "1";
    }

    rankGender = genderSel.value;
    rankSeason = seasonSel.value;
    rankSchool = schoolSel.value;

    drawRankings();
    genderSel.onchange = () => { rankGender = genderSel.value; drawRankings(); };
    seasonSel.onchange = () => { rankSeason = seasonSel.value; drawRankings(); };
    schoolSel.onchange = () => { rankSchool = schoolSel.value; drawRankings(); };
  }
  function drawRankings() {
    const body = $("lbBody");
    if (!body) return;

    const list = leaderboardData(rankGender, rankSeason, rankSchool);
    body.innerHTML = `<div class="app-list"><div class="list-header">State Leaderboard</div>${list.map((x, i) => {
      const trend = x.forecast ? (x.forecast.trend === "improving" ? '<span class="pill up">↑</span>' : x.forecast.trend === "declining" ? '<span class="pill down">↓</span>' : '<span class="pill flat">—</span>') : "";
      return `<div class="list-item">
        <div class="item-place">${i + 1}</div>
        <div class="item-details"><div class="item-name">${esc(x.name)}</div><div class="item-school">${esc(x.school)}</div><div class="item-meta">5K equivalent · ${x.equiv5k != null ? fmt(x.equiv5k) : "—"} · ${trend}</div></div>
        <div class="item-score"><div class="score-stack"><span class="score-rating">${x.rating}</span><span class="score-predicted">MSM Rating</span></div></div>
      </div>`;
    }).join("") || '<div class="empty-state">No data.</div>'}</div>`;
  }
  // ---- Meet sim for fans (pick your school first) ----
  let fanSimSchool = null;
  function setupSimulatorFan(profile) {
    const schoolSel = $("sim-my-school");
    if (!schoolSel) return;
    // Populate school selector
    const schools = E().listSchools();
    schoolSel.innerHTML = '<option value="">Select your school…</option>' +
      schools.map((s) => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join("");
    if (profile.schoolSlug) schoolSel.value = profile.schoolSlug;
    fanSimSchool = profile.schoolSlug || null;
    schoolSel.onchange = () => { fanSimSchool = schoolSel.value || null; if (schoolSel.value) setupSimulatorBySchool(schoolSel.value); else $("sim-results").innerHTML = '<div class="empty-state"><i class="fa-solid fa-school"></i><p>Select your school to simulate meets.</p></div>'; };
    if (fanSimSchool) setupSimulatorBySchool(fanSimSchool);
    else $("sim-results").innerHTML = '<div class="empty-state"><i class="fa-solid fa-school"></i><p>Select your school to simulate meets.</p></div>';
  }
  function setupSimulatorBySchool(slug) {
    const profile = { schoolSlug: slug };
    setupSimulator(profile, "M");
    $("sim-run").onclick = () => runSim(profile, "M", (E().state.schoolsMap[slug] || { name: slug }));
    $("sim-csv").onclick = simExportCSV;
    $("sim-pdf").onclick = simExportPDF;
    $("sim-reset").onclick = () => { simState.opponents = []; simState.myLineup = null; renderOppChips(); $("sim-results").innerHTML = ""; };
  }

  function leaderboardData(gender, season, schoolSlug) {
    const best = {};
    E().state.results.forEach((r) => {
      if (r.gender !== gender || r.msm == null) return;
      if (!E().seasonMatch(r, season)) return;
      if (schoolSlug && r.school_slug !== schoolSlug) return;
      const k = E().norm(r.athlete_name);
      if (!k) return;
      if (!best[k] || r.msm > best[k].rating) {
        const summary = E().athleteSummary(r.athlete_name, season);
        best[k] = {
          name: r.athlete_name,
          school: (E().state.schoolsMap[r.school_slug] || {}).name || r.school_slug || "",
          rating: r.msm,
          equiv5k: summary && summary.best5k ? E().riegel(summary.best5k.timeSec, summary.best5k.distance, 5000) : null,
          forecast: summary && summary.forecast ? summary.forecast : null,
        };
      }
    });
    return Object.values(best).sort((a, b) => b.rating - a.rating).slice(0, 200);
  }  function renderFollowChips() {
    const follows = (A().profile && A().profile.follows) || { athletes: [] };
    const box = $("followChips");
    if (!box) return;
    box.innerHTML = (follows.athletes || []).map((n) =>
      `<span class="follow-chip">${esc(n)} <button data-n="${esc(n)}" title="Unfollow">&times;</button></span>`).join("")
      || '<span class="section-sub">Not following anyone yet.</span>';
    box.querySelectorAll("button[data-n]").forEach((b) => { b.onclick = async () => { await A().toggleFollowAthlete(b.dataset.n); }; });
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
