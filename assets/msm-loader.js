/**
 * Mountain State Miles — Smooth Experience Engine (/assets/msm-loader.js)
 * ---------------------------------------------------------------------------------
 * • Mounts a live header ticker (news, latest results, state + regional archive
 *   headlines, fastest season marks) inside #global-header
 * • Smooth scroll-reveal animations for cards and sections
 * • Prefetches internal pages on link hover for near-instant navigation
 * • Lazy-decodes non-critical images
 */
(function () {
  "use strict";

  if (window.__MSM_SMOOTH_INIT__) return;
  window.__MSM_SMOOTH_INIT__ = true;

  // 1. Styles: ticker, scroll reveals, micro-interactions
  const style = document.createElement("style");
  style.id = "msm-smooth-styles";
  style.textContent = `
    html { scroll-behavior: smooth; }
    :root.msm-ticker-on { --msm-ticker-h: 34px; }
    #msm-ticker {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: var(--msm-ticker-h, 34px);
      z-index: 1001;
      display: flex;
      align-items: stretch;
      overflow: hidden;
      background: linear-gradient(90deg, #2c5a47 0%, #3f7d63 58%, #47896c 100%);
      color: #fff;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.22);
    }
    #msm-ticker .msm-ticker-label {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px 0 10px;
      background: rgba(0, 0, 0, 0.26);
      color: #fff;
      text-decoration: none;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-size: 0.68rem;
      z-index: 1;
      transition: background 0.2s ease;
    }
    #msm-ticker .msm-ticker-label:hover,
    #msm-ticker .msm-ticker-label:focus-visible { background: rgba(0, 0, 0, 0.42); }
    #msm-ticker .msm-ticker-photo {
      width: 24px;
      height: 24px;
      flex: none;
      border-radius: 50%;
      object-fit: cover;
      border: 1.5px solid rgba(255, 255, 255, 0.7);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    }
    #msm-ticker .msm-ticker-live {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    #msm-ticker .msm-ticker-live::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #7dd8a5;
      box-shadow: 0 0 0 3px rgba(125, 216, 165, 0.22);
    }
    #msm-ticker .msm-ticker-viewport {
      flex: 1 1 auto;
      display: flex;
      align-items: stretch;
      overflow: hidden;
      white-space: nowrap;
      mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent);
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent);
    }
    #msm-ticker .msm-ticker-track {
      display: inline-flex;
      align-items: stretch;
      animation: msm-ticker-scroll var(--msm-ticker-dur, 60s) linear infinite;
      will-change: transform;
      backface-visibility: hidden;
    }
    #msm-ticker .msm-ticker-group {
      display: inline-flex;
      align-items: stretch;
    }
    #msm-ticker:hover .msm-ticker-track,
    #msm-ticker:focus-within .msm-ticker-track,
    #msm-ticker.is-paused .msm-ticker-track { animation-play-state: paused; }
    #msm-ticker .msm-tick {
      display: inline-flex;
      align-items: center;
      height: var(--msm-ticker-h, 34px);
      color: #fff;
      text-decoration: none;
      padding: 0 10px;
      opacity: 0.95;
    }
    #msm-ticker .msm-tick:hover,
    #msm-ticker .msm-tick:focus-visible { text-decoration: underline; opacity: 1; }
    #msm-ticker .msm-tick-tag {
      display: inline-block;
      margin-right: 6px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.18);
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    #msm-ticker .msm-tick-sep { opacity: 0.55; padding: 0 4px; align-self: center; }
    @keyframes msm-ticker-scroll {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }
    @media (max-width: 640px) {
      :root.msm-ticker-on { --msm-ticker-h: 40px; }
      #msm-ticker { font-size: 0.72rem; letter-spacing: 0.01em; }
      #msm-ticker .msm-ticker-label { padding: 0 9px 0 6px; font-size: 0.6rem; gap: 6px; }
      #msm-ticker .msm-ticker-photo { width: 22px; height: 22px; }
      #msm-ticker .msm-tick { padding: 0 8px; }
      #msm-ticker .msm-tick-tag { font-size: 0.6rem; padding: 1px 5px; margin-right: 5px; }
      #msm-ticker .msm-ticker-viewport {
        mask-image: linear-gradient(90deg, transparent, #000 10px, #000 calc(100% - 10px), transparent);
        -webkit-mask-image: linear-gradient(90deg, transparent, #000 10px, #000 calc(100% - 10px), transparent);
      }
    }
    .msm-reveal {
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1), transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
      will-change: opacity, transform;
    }
    .msm-reveal.msm-visible {
      opacity: 1;
      transform: translateY(0);
    }
    @media (prefers-reduced-motion: reduce) {
      .msm-reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
      html { scroll-behavior: auto; }
      #msm-ticker .msm-ticker-track { animation: none; padding-left: 0; }
      #msm-ticker .msm-ticker-viewport { overflow-x: auto; }
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  // ---------------------------------------------------------------------------
  // 2. Header ticker: news, results, ratings
  // ---------------------------------------------------------------------------
  const CACHE_KEY = "msm-ticker-v3"; // bumped when item order/shape changes so stale caches are ignored
  const CACHE_MS = 10 * 60 * 1000; // refresh every 10 minutes per browser session
  const MAX_ITEMS = 26;
  const FALLBACK_ITEMS = [
    { tag: "MSM", text: "Mountain State Miles · West Virginia Track & Cross Country", href: "/home/" }
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // "16:41.27" -> seconds; plain numbers pass through.
  function timeToSec(t) {
    if (typeof t === "number") return t;
    const s = String(t || "").trim();
    if (!s) return NaN;
    const parts = s.split(":").map(Number);
    if (parts.some((n) => isNaN(n))) return NaN;
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }

  function slugToTitle(slug) {
    return String(slug || "")
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // Seconds -> "16:41.3"
  function fmtRaceTime(value) {
    const sec = timeToSec(value);
    if (!isFinite(sec) || sec <= 0) return "";
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  function snapshotEntries(snap) {
    const out = [];
    if (!snap) return out;
    snap.forEach((child) => {
      out.push({ key: child.key, val: child.val() || {} });
    });
    return out;
  }

  function meetTitle(meet) {
    const raw = String(meet.name || slugToTitle(meet.slug || meet.key) || "Meet")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[-–—\s]+/, "");
    return raw || "Meet";
  }

  // "State" for championship meets, "Region" for regional qualifiers.
  function meetKind(meet) {
    if (meet.is_state_championship === true) return "state";
    const blob = (String(meet.name || "") + " " + String(meet.slug || meet.key || ""))
      .toLowerCase()
      .replace(/[–—]/g, "-");
    if (/\bstate[\s-]*(meet|champ|final)/.test(blob)) return "state";
    if (/\bregion/.test(blob)) return "region";
    return "";
  }

  function meetYear(meet) {
    const d = new Date(meet.date);
    return isNaN(d.getTime()) ? "" : String(d.getFullYear());
  }

  function classLabel(raceType) {
    const t = String(raceType || "").trim().toUpperCase();
    if (["A", "AA", "AAA", "AAAA"].indexOf(t) !== -1) return t;
    return t.replace(/^CLASS\s+/, "");
  }

  function regionLabel(meet) {
    const name = meetTitle(meet);
    const m = name.match(/region\s*([0-9]{1,2}|[IVX]{1,4})/i);
    if (m) return "Region " + m[1].toUpperCase();
    if (/south/i.test(name)) return "South Regional";
    if (/north/i.test(name)) return "North Regional";
    if (/east/i.test(name)) return "East Regional";
    if (/west/i.test(name)) return "West Regional";
    return "Regional";
  }

  function resultLabel(r) {
    const school = r.school_slug ? slugToTitle(r.school_slug) : "";
    return school ? r.athlete_name + " (" + school + ")" : r.athlete_name;
  }

  function genderWord(r, lower) {
    const word = r.gender === "F" ? "Girls" : r.gender === "M" ? "Boys" : "";
    return lower ? word.toLowerCase() : word;
  }

  // Best finishers for one meet, grouped by class + gender, so a state meet
  // yields one headline per race instead of four AAAA boys.
  function winnerRows(meetSlug, results, perRace) {
    const groups = {};
    results.forEach((r) => {
      if (r.meet_slug !== meetSlug) return;
      const place = parseInt(r.place, 10);
      if (!isFinite(place) || place < 1 || place > perRace) return;
      const sec = timeToSec(r.time);
      if (!isFinite(sec) || sec <= 0) return;
      const key = (r.gender || "") + "|" + classLabel(r.race_type);
      (groups[key] = groups[key] || []).push({ row: r, place });
    });
    return Object.keys(groups)
      .sort()
      .reduce((out, key) => {
        groups[key]
          .sort((a, b) => a.place - b.place)
          .slice(0, perRace)
          .forEach((entry) => out.push(entry.row));
        return out;
      }, []);
  }

  // Even a meet from years ago keeps cycling through: the window advances one
  // slot per day, so the archive never goes stale.
  function rotateWindow(pool, count, seed) {
    if (!pool.length) return [];
    const offset = seed % pool.length;
    const out = [];
    for (let i = 0; i < Math.min(count, pool.length); i++) {
      out.push(pool[(offset + i) % pool.length]);
    }
    return out;
  }

  async function buildTickerItems() {
    const db = window.database || (typeof database !== "undefined" ? database : null);
    if (!db) return null;

    const [newsSnap, meetsSnap, resultsSnap] = await Promise.all([
      db.ref("news").once("value").catch(() => null),
      db.ref("crosscountry/meets").once("value").catch(() => null),
      db.ref("crosscountry/results").once("value").catch(() => null),
    ]);

    const now = Date.now();
    const daySeed = Math.floor(now / 86400000);
    const items = [];
    const seen = new Set();
    const meetHref = (slug) => "/CrossCountry/meet.html?slug=" + encodeURIComponent(slug);
    const push = (item) => {
      if (!item || !item.text || seen.has(item.text)) return;
      seen.add(item.text);
      items.push(item);
    };

    const meetsBySlug = {};
    snapshotEntries(meetsSnap).forEach((e) => {
      const slug = e.val.slug || e.key;
      meetsBySlug[slug] = { ...e.val, slug, key: e.key };
    });

    const pastMeets = Object.values(meetsBySlug)
      .filter((m) => {
        const t = m.date ? new Date(m.date).getTime() : NaN;
        return isFinite(t) && t <= now;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const results = snapshotEntries(resultsSnap)
      .map((e) => e.val)
      .filter((r) => r && r.athlete_name && !String(r.relay_team || "").trim());

    // 1. The most recent meet's podium. A scheduled meet with no results yet
    //    (or a non-XC entry) should not blank the freshest headlines.
    const hasResults = (m) =>
      results.some((r) => r.meet_slug === m.slug && parseInt(r.place, 10) >= 1 && timeToSec(r.time) > 0);
    const latest = pastMeets.find(hasResults) || pastMeets[0];
    if (latest) {
      const weekMs = 7 * 86400000;
      const weekTag = now - new Date(latest.date).getTime() <= weekMs ? "This Week" : "Results";
      results
        .filter((r) => r.meet_slug === latest.slug && r.place != null && r.time)
        .sort((a, b) => parseInt(a.place, 10) - parseInt(b.place, 10))
        .slice(0, 4)
        .forEach((r) => push({
          tag: weekTag,
          text: meetTitle(latest) + " · #" + r.place + " " + resultLabel(r) + " " + fmtRaceTime(r.time),
          href: meetHref(latest.slug),
        }));
    }

    // 2. State championship headlines from every past season, not just this one.
    const statePool = [];
    pastMeets
      .filter((m) => meetKind(m) === "state")
      .forEach((m) => {
        const year = meetYear(m);
        winnerRows(m.slug, results, 1).forEach((r) => {
          const bits = [year, classLabel(r.race_type), genderWord(r, true)].filter(Boolean).join(" ");
          statePool.push({
            tag: "State",
            text: bits + " champion · " + resultLabel(r) + " " + fmtRaceTime(r.time),
            href: meetHref(m.slug),
          });
        });
      });
    rotateWindow(statePool, 6, daySeed).forEach(push);

    // 3. Regional qualifier headlines, also evergreen.
    const regionPool = [];
    pastMeets
      .filter((m) => meetKind(m) === "region")
      .forEach((m) => {
        const label = regionLabel(m);
        const year = meetYear(m);
        winnerRows(m.slug, results, 1).forEach((r) => {
          const bits = [year, label, genderWord(r, true)].filter(Boolean).join(" ");
          regionPool.push({
            tag: "Region",
            text: bits + " champion · " + resultLabel(r) + " " + fmtRaceTime(r.time),
            href: meetHref(m.slug),
          });
        });
      });
    rotateWindow(regionPool, 5, daySeed + 7).forEach(push);

    // 4. Fastest marks of the latest season (one best mark per athlete).
    if (latest) {
      const season = new Date(latest.date).getFullYear();
      const best = {};
      results.forEach((r) => {
        const sec = timeToSec(r.time);
        if (isNaN(sec) || !r.athlete_name) return;
        const meet = meetsBySlug[r.meet_slug];
        if (!meet || !meet.date || new Date(meet.date).getFullYear() !== season) return;
        const key = r.athlete_name + "|" + (r.school_slug || "") + "|" + (r.gender || "");
        if (!best[key] || sec < best[key].sec) best[key] = { row: r, sec };
      });
      Object.values(best)
        .sort((a, b) => a.sec - b.sec)
        .slice(0, 4)
        .forEach(({ row }) => push({
          tag: "Top " + season,
          text: row.athlete_name + " (" + slugToTitle(row.school_slug) + ") " + fmtRaceTime(row.time),
          href: "/CrossCountry/athlete.html?name=" + encodeURIComponent(row.athlete_name) +
            (row.school_slug ? "&school=" + encodeURIComponent(row.school_slug) : ""),
        }));
    }

    // 5. News headlines (newest first).
    snapshotEntries(newsSnap)
      .map((e) => e.val)
      .filter((a) => a && a.title)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 3)
      .forEach((a) => push({ tag: "News", text: a.title, href: "/news.html" }));

    return items.slice(0, MAX_ITEMS);
  }

  function readCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || Date.now() - parsed.t > CACHE_MS || !Array.isArray(parsed.items)) return null;
      return parsed.items;
    } catch (e) {
      return null;
    }
  }

  function writeCache(items) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), items }));
    } catch (e) {}
  }

  function renderTicker(ticker, items) {
    const track = ticker.querySelector(".msm-ticker-track");
    const list = items && items.length ? items : FALLBACK_ITEMS;
    const groupHtml = (isClone) =>
      list
        .map(
          (i) =>
            '<a class="msm-tick" href="' + esc(i.href) + '"' +
            (isClone ? ' tabindex="-1" aria-hidden="true"' : "") +
            '><span class="msm-tick-tag">' + esc(i.tag) + "</span>" + esc(i.text) + "</a>"
        )
        .join('<span class="msm-tick-sep" aria-hidden="true">◆</span>') +
      '<span class="msm-tick-sep" aria-hidden="true">◆</span>';
    track.innerHTML =
      '<div class="msm-ticker-group">' + groupHtml(false) + "</div>" +
      '<div class="msm-ticker-group" aria-hidden="true">' + groupHtml(true) + "</div>";
    // Both groups are identical, so a -50% shift loops seamlessly. Pace the loop
    // by pixel width (~85px/s) so long headline lists still read comfortably.
    const group = track.firstElementChild;
    const groupW = group ? Math.round(group.getBoundingClientRect().width) : 0;
    const dur = groupW > 0 ? Math.max(45, Math.min(240, Math.round(groupW / 85))) : 60;
    ticker.style.setProperty("--msm-ticker-dur", dur + "s");
  }

  function mountTicker() {
    const header = document.getElementById("global-header");
    if (!header || !header.querySelector(".site-header, .navbar")) return false;
    if (document.getElementById("msm-ticker")) return true;

    const ticker = document.createElement("div");
    ticker.id = "msm-ticker";
    ticker.setAttribute("role", "region");
    ticker.setAttribute("aria-label", "Latest news, results and ratings");
    ticker.innerHTML = `
      <a class="msm-ticker-label" href="/CrossCountry/xc.html" aria-label="Mountain State Miles cross country hub">
        <img class="msm-ticker-photo" src="/assets/images/photos/ticker-thumb.jpg" alt="" width="24" height="24" decoding="async" />
        <span class="msm-ticker-live">Live</span>
      </a>
      <div class="msm-ticker-viewport"><div class="msm-ticker-track"></div></div>`;
    document.body.appendChild(ticker);
    document.documentElement.classList.add("msm-ticker-on");

    // Hold the marquee still while a finger or pointer is down so links are easy to tap.
    let resumeTimer = null;
    const pause = () => {
      clearTimeout(resumeTimer);
      ticker.classList.add("is-paused");
    };
    const resume = () => {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => ticker.classList.remove("is-paused"), 1600);
    };
    ticker.addEventListener("touchstart", pause, { passive: true });
    ticker.addEventListener("touchend", resume, { passive: true });
    ticker.addEventListener("touchcancel", resume, { passive: true });
    ticker.addEventListener("mouseenter", pause, { passive: true });
    ticker.addEventListener("mouseleave", resume, { passive: true });

    renderTicker(ticker, []);

    const cached = readCache();
    if (cached) {
      renderTicker(ticker, cached);
    } else {
      waitForDatabase().then(async () => {
        try {
          const items = await buildTickerItems();
          if (items && items.length) {
            writeCache(items);
            renderTicker(ticker, items);
          }
        } catch (e) {
          console.warn("[MSM] ticker data unavailable:", e);
        }
      });
    }
    return true;
  }

  function waitForDatabase() {
    return new Promise((resolve) => {
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        const ready = window.database || (typeof database !== "undefined" && database);
        if (ready || tries > 100) {
          clearInterval(t);
          resolve();
        }
      }, 100);
    });
  }

  function startTicker() {
    if (mountTicker()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (mountTicker() || tries > 100) clearInterval(t);
    }, 50);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startTicker, { once: true });
  } else {
    startTicker();
  }

  // ---------------------------------------------------------------------------
  // 3. Smooth Scroll-Reveal Observer for cards and sections
  // ---------------------------------------------------------------------------
  let io = null;
  const REVEAL_SELECTORS = [
    ".hub-section",
    ".home-section",
    ".meet-banner",
    ".recap-card",
    ".team-story",
    ".sots-card",
    ".news-card",
    ".podium-card",
    ".watch-card",
    ".table-card",
    ".sim-card",
    ".feature-tile"
  ].join(",");

  function initObserver() {
    if (typeof IntersectionObserver === "undefined") return;
    if (!io) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("msm-visible");
              io.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -30px 0px", threshold: 0.06 }
      );
    }

    document.querySelectorAll(REVEAL_SELECTORS).forEach((el) => {
      if (el.dataset.msmRevealed) return;
      el.dataset.msmRevealed = "1";
      const rect = el.getBoundingClientRect();
      // Elements already in viewport appear immediately without flicker
      if (rect.top < window.innerHeight * 0.92) {
        el.classList.add("msm-visible");
      } else {
        el.classList.add("msm-reveal");
        io.observe(el);
      }
    });

    // Lazy-decode images that aren't above-the-fold logos
    document.querySelectorAll("img:not([loading])").forEach((img) => {
      if (!img.classList.contains("brand-logo-img") && !img.classList.contains("hero-logo") && !img.classList.contains("page-background-image")) {
        img.loading = "lazy";
        img.decoding = "async";
      }
    });
  }

  let obsTimer = null;
  function scheduleObserve() {
    clearTimeout(obsTimer);
    obsTimer = setTimeout(initObserver, 60);
  }

  document.addEventListener("MSMDataLoaded", scheduleObserve);
  window.addEventListener("load", scheduleObserve);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleObserve);
  } else {
    scheduleObserve();
  }

  // ---------------------------------------------------------------------------
  // 4. Instant link prefetching on hover / touchstart
  // ---------------------------------------------------------------------------
  const prefetched = new Set();
  function prefetchUrl(href) {
    if (!href || prefetched.has(href)) return;
    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      prefetched.add(url.href);
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = url.href;
      link.as = "document";
      document.head.appendChild(link);
    } catch (e) {}
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (a && a.href && !a.target && !a.hasAttribute("download")) {
        prefetchUrl(a.href);
      }
    },
    { passive: true }
  );
})();
