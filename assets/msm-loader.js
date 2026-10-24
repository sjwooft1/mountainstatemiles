/**
 * Mountain State Miles — Smooth Experience Engine (/assets/msm-loader.js)
 * ---------------------------------------------------------------------------------
 * • Mounts a live header ticker (news headlines, latest meet results, fastest
 *   season marks) inside #global-header, replacing the old top progress bar
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
      align-items: center;
      overflow: hidden;
      background: var(--primary, #3f7d63);
      color: #fff;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
    }
    #msm-ticker .msm-ticker-label {
      flex: 0 0 auto;
      height: 100%;
      display: flex;
      align-items: center;
      padding: 0 14px;
      background: rgba(0, 0, 0, 0.22);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.7rem;
      z-index: 1;
    }
    #msm-ticker .msm-ticker-viewport {
      flex: 1 1 auto;
      overflow: hidden;
      white-space: nowrap;
      mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent);
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent);
    }
    #msm-ticker .msm-ticker-track {
      display: inline-flex;
      align-items: center;
      gap: 0;
      padding-left: 100%;
      animation: msm-ticker-scroll var(--msm-ticker-dur, 60s) linear infinite;
    }
    #msm-ticker:hover .msm-ticker-track { animation-play-state: paused; }
    #msm-ticker .msm-tick {
      color: #fff;
      text-decoration: none;
      padding: 0 10px;
      opacity: 0.95;
    }
    #msm-ticker .msm-tick:hover { text-decoration: underline; opacity: 1; }
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
    #msm-ticker .msm-tick-sep { opacity: 0.55; padding: 0 4px; }
    @keyframes msm-ticker-scroll {
      from { transform: translateX(0); }
      to { transform: translateX(-100%); }
    }
    @media (max-width: 640px) {
      #msm-ticker { font-size: 0.7rem; }
      #msm-ticker .msm-ticker-label { padding: 0 9px; font-size: 0.62rem; }
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
  const CACHE_KEY = "msm-ticker-v2"; // bumped when item order/shape changes so stale caches are ignored
  const CACHE_MS = 10 * 60 * 1000; // refresh every 10 minutes per browser session
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

  function snapshotEntries(snap) {
    const out = [];
    if (!snap) return out;
    snap.forEach((child) => {
      out.push({ key: child.key, val: child.val() || {} });
    });
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

    const items = [];

    // Meets indexed by slug, plus the most recent meet that has already happened
    const now = Date.now();
    const meets = {};
    snapshotEntries(meetsSnap).forEach((e) => {
      const slug = e.val.slug || e.key;
      meets[slug] = { ...e.val, slug };
    });
    const pastMeets = Object.values(meets)
      .filter((m) => m.date && !isNaN(new Date(m.date).getTime()) && new Date(m.date).getTime() <= now)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const latest = pastMeets[0];
    // This week's meet if one ran in the last 7 days, otherwise the most recent meet
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const recentMeet = pastMeets.find((m) => now - new Date(m.date).getTime() <= WEEK_MS);
    const weekMeet = recentMeet || latest;
    const weekTag = recentMeet ? "This Week" : "Results";

    const results = snapshotEntries(resultsSnap).map((e) => e.val).filter((r) => r && r.athlete_name);

    // Results first: this week's meet (or the most recent one) podium
    if (weekMeet) {
      const podium = results
        .filter((r) => r.meet_slug === weekMeet.slug && r.place != null && r.time)
        .sort((a, b) => parseInt(a.place, 10) - parseInt(b.place, 10))
        .slice(0, 5);
      podium.forEach((r) => {
        items.push({
          tag: weekTag,
          text: `${weekMeet.name || slugToTitle(weekMeet.slug)} · #${r.place} ${r.athlete_name} ${r.time}`,
          href: "/CrossCountry/meet.html?slug=" + encodeURIComponent(weekMeet.slug),
        });
      });
    }

    // Then the latest news headlines (newest first)
    const news = snapshotEntries(newsSnap)
      .map((e) => e.val)
      .filter((a) => a && a.title)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 4);
    news.forEach((a) => items.push({ tag: "News", text: a.title, href: "/news.html" }));

    // Fastest marks of the latest season (one best mark per athlete)
    if (latest) {
      const season = new Date(latest.date).getFullYear();
      const best = {};
      results.forEach((r) => {
        const sec = timeToSec(r.time);
        if (!isNaN(sec) && r.athlete_name) {
          const meet = meets[r.meet_slug];
          if (!meet || !meet.date || new Date(meet.date).getFullYear() !== season) return;
          const key = r.athlete_name + "|" + (r.school_slug || "") + "|" + (r.gender || "");
          if (!best[key] || sec < best[key].sec) best[key] = { ...r, sec };
        }
      });
      Object.values(best)
        .sort((a, b) => a.sec - b.sec)
        .slice(0, 5)
        .forEach((r) => {
          items.push({
            tag: "Top " + season,
            text: `${r.athlete_name} (${slugToTitle(r.school_slug)}) ${r.time}`,
            href: "/CrossCountry/athlete.html?name=" + encodeURIComponent(r.athlete_name) +
              (r.school_slug ? "&school=" + encodeURIComponent(r.school_slug) : ""),
          });
        });
    }

    return items;
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
    const sep = '<span class="msm-tick-sep" aria-hidden="true">◆</span>';
    const chunk = list
      .map(
        (i) =>
          `<a class="msm-tick" href="${esc(i.href)}"><span class="msm-tick-tag">${esc(i.tag)}</span>${esc(i.text)}</a>`
      )
      .join(sep) + sep;
    track.innerHTML = chunk;
    // Duplicate once for a seamless loop
    const copy = document.createElement("div");
    copy.setAttribute("aria-hidden", "true");
    copy.style.display = "inline-flex";
    copy.innerHTML = chunk;
    track.appendChild(copy);
    // Speed scales with length so readers get a steady pace
    const chars = list.reduce((n, i) => n + i.text.length + i.tag.length, 0);
    const dur = Math.max(30, Math.round(chars / 3));
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
      <span class="msm-ticker-label">Live</span>
      <div class="msm-ticker-viewport"><div class="msm-ticker-track"></div></div>`;
    document.body.appendChild(ticker);
    document.documentElement.classList.add("msm-ticker-on");
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
