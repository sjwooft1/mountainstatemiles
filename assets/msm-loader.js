/**
 * Full-screen MSM loader — show on parse, hide when MSMPageLoader.hide() is called.
 * Include sync right after <body> opens; stylesheet in <head>:
 * <link rel="stylesheet" href="/assets/msm-loader.css">
 */
(function () {
  var ROOT_ID = "msm-page-loader";
  var safetyMs = 25000;
  var safetyTimer;
  /** Single continuous path approximating ridges (normalized with pathLength) */
  var MOUNTAIN_D =
    "M4 72 L26 72 L42 38 L58 72 L74 72 L94 22 L118 72 L138 72 L156 72 L174 72 L174 74 L4 74 Z";

  function buildSvg() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.id = "msm-loader-mark";
    svg.setAttribute("viewBox", "0 0 180 82");
    svg.setAttribute("aria-hidden", "true");
    var pDraw = document.createElementNS(ns, "path");
    pDraw.id = "msm-loader-path-draw";
    pDraw.setAttribute("d", MOUNTAIN_D);
    pDraw.setAttribute("pathLength", "1");
    var pFill = document.createElementNS(ns, "path");
    pFill.id = "msm-loader-path-fill";
    pFill.setAttribute("d", MOUNTAIN_D);
    pFill.setAttribute("pathLength", "1");
    svg.appendChild(pDraw);
    svg.appendChild(pFill);
    return svg;
  }

  function ensureOverlay() {
    var existing = document.getElementById(ROOT_ID);
    if (existing) return existing;

    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "msm-page-loader";
    root.setAttribute("role", "status");
    root.setAttribute("aria-busy", "true");
    root.setAttribute("aria-label", "Loading");

    var inner = document.createElement("div");
    inner.className = "msm-page-loader__inner";
    inner.appendChild(buildSvg());

    var brand = document.createElement("p");
    brand.className = "msm-page-loader__brand";
    brand.textContent = "Mountain State Miles";
    inner.appendChild(brand);

    root.appendChild(inner);
    (document.body || document.documentElement).appendChild(root);

    clearTimeout(safetyTimer);
    safetyTimer = setTimeout(hide, safetyMs);

    requestAnimationFrame(function () {
      root.classList.add("msm-page-loader--shown");
    });

    return root;
  }

  function hide() {
    clearTimeout(safetyTimer);
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.setAttribute("aria-busy", "false");
    root.classList.remove("msm-page-loader--shown");
    root.classList.add("msm-page-loader--exiting");
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
    }, 420);
  }

  function show() {
    var el = ensureOverlay();
    el.classList.remove("msm-page-loader--exiting");
    el.classList.add("msm-page-loader--shown");
  }

  document.addEventListener("MSMDataLoaded", hide);

  function boot() {
    ensureOverlay();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.MSMPageLoader = {
    show: show,
    hide: hide,
    /** @deprecated use document.dispatchEvent(new Event("MSMDataLoaded")) */
    signalReady: hide,
  };

  /** Allow inline handlers */
  window.msmSignalDataLoaded = hide;
})();
