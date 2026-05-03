/**
 * Floating coach shortcuts when MSMTrackCoachAuth.isSignedIn().
 * Pages may set window.__MSM_COACH_CTX = { kind, schoolName?, meetId?, meetName?, athleteName? }
 */
(function () {
  var STYLE_ID = "msm-coach-toolbar-styles";

  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#msm-coach-toolbar{position:fixed;right:16px;bottom:16px;z-index:9997;font-family:Inter,system-ui,sans-serif;}",
      "#msm-coach-toolbar .coach-fab{border:none;border-radius:999px;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;font-weight:700;padding:12px 18px;cursor:pointer;",
      "box-shadow:0 10px 30px rgba(91,33,182,.45);font-size:14px;display:flex;align-items:center;gap:8px;}",
      "#msm-coach-toolbar .coach-fab:hover{filter:brightness(1.05);}",
      "#msm-coach-panel{display:none;margin-top:8px;background:var(--bg-secondary,#161b29);border:1px solid var(--border,rgba(255,255,255,.12));",
      "border-radius:14px;padding:14px 16px;min-width:260px;max-width:320px;box-shadow:0 14px 40px rgba(0,0,0,.35);color:var(--text-primary,#eee);}",
      "#msm-coach-toolbar.open #msm-coach-panel{display:block;}",
      "#msm-coach-panel a{display:block;margin:8px 0;color:#c4b5fd;font-weight:600;text-decoration:none;font-size:13px;}",
      "#msm-coach-panel a:hover{text-decoration:underline;}",
      "#msm-coach-panel .coach-muted{font-size:12px;color:var(--text-secondary,#9ca3af);margin:8px 0 0;}",
      "#msm-coach-panel .coach-row{font-size:12px;color:var(--text-secondary,#cbd5f5);margin:4px 0;}",
      "#msm-coach-signout{font-size:12px;margin-top:10px;color:#fca5a5;cursor:pointer;border:none;background:transparent;padding:0;font-weight:600;}",
      "@media print{#msm-coach-toolbar{display:none !important;}}",
    ].join("");
    document.head.appendChild(s);
  }

  function basePath() {
    var m = window.location.pathname.match(/^(.*\\/Track\\/)/);
    return m ? m[1] : "/Track/";
  }

  function trackHref(pathAndQuery) {
    return (
      basePath() + pathAndQuery.replace(/^\/Track\/?/, "").replace(/^\//, "")
    );
  }

  function ctx() {
    return window.__MSM_COACH_CTX || {};
  }

  function renderPanel(panel) {
    var c = ctx();
    var lines = [];

    lines.push('<a href="' + trackHref("analytics.html") + '">Open Track Analytics coach hub</a>');

    if (c.kind === "team" && c.schoolName && window.MSMCoachReportUrls) {
      var tu = window.MSMCoachReportUrls.teamAnalytics(c.schoolName);
      lines.push(
        '<a href="' +
          trackHref(tu) +
          '">Printable team analytics (preset)</a>',
      );
      lines.push('<p class="coach-row">School: <strong>' + escapeHtml(c.schoolName) + "</strong></p>");
    }

    if (c.kind === "meet" && c.meetId && window.MSMCoachReportUrls) {
      var mu = window.MSMCoachReportUrls.meetAnalytics(c.meetId);
      lines.push(
        '<a href="' +
          trackHref(mu) +
          '">Full meet analytics &amp; report</a>',
      );
      if (c.meetName)
        lines.push('<p class="coach-row">Meet: <strong>' + escapeHtml(c.meetName) + "</strong></p>");
    }

    if (c.kind === "athlete" && window.MSMCoachReportUrls) {
      var au = window.MSMCoachReportUrls.athleteAnalytics(c.athleteName, c.schoolName);
      if (au.indexOf("?") > -1)
        lines.push(
          '<a href="' + trackHref(au) + '">Athlete analytics (preset)</a>',
        );
      if (c.athleteName || c.schoolName)
        lines.push(
          '<p class="coach-row">' +
            escapeHtml([c.athleteName, c.schoolName].filter(Boolean).join(" · ")) +
            "</p>",
        );
    }

    lines.push('<p class="coach-muted">Use Print buttons on Analytics after filters look right.</p>');
    lines.push(
      '<button type="button" id="msm-coach-signout">Sign out (coach)</button>',
    );

    panel.innerHTML = lines.join("");
    var btn = panel.querySelector("#msm-coach-signout");
    if (btn && window.MSMTrackCoachAuth)
      btn.addEventListener("click", function () {
        window.MSMTrackCoachAuth.signOutCoachOnly();
        location.reload();
      });
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureToolbar() {
    if (
      typeof window.MSMTrackCoachAuth === "undefined" ||
      typeof window.MSMTrackCoachAuth.isSignedIn !== "function" ||
      !window.MSMTrackCoachAuth.isSignedIn()
    ) {
      var old = document.getElementById("msm-coach-toolbar");
      if (old) old.remove();
      injectLoginHint();
      return;
    }

    injectStylesOnce();

    injectLoginHint();

    var host = document.getElementById("msm-coach-toolbar");
    if (!host) {
      host = document.createElement("div");
      host.id = "msm-coach-toolbar";
      document.body.appendChild(host);
      host.innerHTML =
        '<button type="button" class="coach-fab" id="msm-coach-fab-toggle" aria-expanded="false" aria-haspopup="true">📋 Coach</button>' +
        '<div id="msm-coach-panel" role="menu"></div>';
      host.querySelector("#msm-coach-fab-toggle").addEventListener(
        "click",
        function () {
          host.classList.toggle("open");
          host
            .querySelector("#msm-coach-fab-toggle")
            .setAttribute(
              "aria-expanded",
              host.classList.contains("open") ? "true" : "false",
            );
        },
      );
    }

    var panel = host.querySelector("#msm-coach-panel");
    renderPanel(panel);

    window.MSMCoachToolbarRefresh = function () {
      renderPanel(panel);
    };
  }

  function injectLoginHint() {
    if (
      typeof window.MSMTrackCoachAuth !== "undefined" &&
      window.MSMTrackCoachAuth.isSignedIn()
    ) {
      var h = document.getElementById("msm-coach-login-hint");
      if (h) h.remove();
      return;
    }
    /** Optional subtle link for anonymous users (once per load). */
    if (document.getElementById("msm-coach-login-hint")) return;
    if (/\/coach-login\.html$/.test(window.location.pathname)) return;

    var a = document.createElement("div");
    a.id = "msm-coach-login-hint";
    a.style.cssText =
      "position:fixed;right:14px;bottom:14px;z-index:9996;font-size:12px;opacity:.75;";
    var base = basePath();
    a.innerHTML =
      '<a href="' +
      base +
      'coach-login.html" style="color:inherit;">Coach login</a>';
    document.body.appendChild(a);
  }

  window.MSMCoachToolbarRefresh = window.MSMCoachToolbarRefresh || function () {};

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ensureToolbar);
  else ensureToolbar();

  window.addEventListener("msm-coach-context-updated", ensureToolbar);
})();
