/**
 * MSMPdf — shared PDF branding for Mountain State Miles exports.
 *
 * Every PDF exporter (meet, rankings, paces, school, athlete, team, portal)
 * calls into this so exports share one look:
 *
 *   await MSMPdf.ready();                       // wait for the jsPDF CDN script
 *   const drawHeader = await MSMPdf.brandHeader(doc, {
 *     title: '…', subtitle: '…',                // subtitle optional
 *     color: [63, 125, 99],                     // band colour (default pine)
 *     schoolPng: await MSMPdf.teamLogoPng(s)    // optional school logo chip
 *   });
 *   doc.autoTable({ …, didDrawPage: drawHeader, margin: { top: 30 } });
 *   MSMPdf.finalize(doc);                       // gold rule + footer on all pages
 *   doc.save('…pdf');
 *
 * Images come from /assets/images and are rasterised through a canvas (SVGs
 * are recoloured first), because jsPDF cannot embed SVG reliably. Assets are
 * trimmed to their ink bounding box so placements stay tight.
 */
(function () {
  'use strict';

  var PINE = [63, 125, 99];       // --primary
  var GOLD = [224, 166, 63];      // --msm-gold
  var INK = [40, 40, 40];
  var CREAM = [246, 243, 236];
  var FOOTER_TEXT = 'mountainstatemiles.com · West Virginia High School Track & Cross Country';

  var cache = {};

  function fetchText(url) {
    return fetch(url, { cache: 'force-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return res.text();
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image failed: ' + src.slice(0, 60))); };
      img.src = src;
    });
  }

  // SVG text -> data URL, so <img> can render it without network/CORS issues.
  function svgTextToDataUrl(text) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
  }

  // Recolour an SVG's fill/stroke hexes (used for mountainstate.svg which is
  // light grey #cccccc — designed for dark backgrounds — on white PDF paper or
  // a coloured band we want it white or dark).
  function recolorSvg(text, hex) {
    return text.replace(/#cccccc/gi, hex).replace(/fill="#f{3,6}"/gi, 'fill="' + hex + '"').replace(/stroke="#f{3,6}"/gi, 'stroke="' + hex + '"');
  }

  // Rasterise (and trim transparent padding from) an image source.
  // Returns { data, w, h } — w/h are the trimmed pixel dimensions.
  async function rasterize(src, opts) {
    opts = opts || {};
    var maxPx = opts.maxPx || 720;
    var text = null;
    if (/\.svg($|\?)/i.test(src) || opts.svgText) {
      text = opts.svgText || await fetchText(src);
      if (opts.recolor) text = recolorSvg(text, opts.recolor);
      src = svgTextToDataUrl(text);
    }
    var img = await loadImage(src);
    var nw = img.naturalWidth || img.width || maxPx;
    var nh = img.naturalHeight || img.height || maxPx;
    var scale = Math.min(1, maxPx / Math.max(nw, nh));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(nw * scale));
    canvas.height = Math.max(1, Math.round(nh * scale));
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Trim fully-transparent margins so logos sit tight in the PDF.
    try {
      var px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
      for (var y = 0; y < canvas.height; y++) {
        for (var x = 0; x < canvas.width; x++) {
          if (px[(y * canvas.width + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= x0 && y1 >= y0 && (x1 - x0 + 1 < canvas.width || y1 - y0 + 1 < canvas.height)) {
        var trimmed = document.createElement('canvas');
        trimmed.width = x1 - x0 + 1; trimmed.height = y1 - y0 + 1;
        trimmed.getContext('2d').drawImage(canvas, x0, y0, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
        canvas = trimmed;
      }
    } catch (e) { /* tainted canvas or no pixels — keep untrimmed */ }

    return { data: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
  }

  function once(key, fn) {
    if (!cache[key]) cache[key] = fn().catch(function (e) {
      console.warn('MSMPdf asset failed:', key, e);
      delete cache[key];       // allow retry on a later export
      return null;
    });
    return cache[key];
  }

  var api = {
    PINE: PINE, GOLD: GOLD, INK: INK, CREAM: CREAM,

    /** Wait until the deferred jsPDF scripts have loaded. */
    ready: function (maxMs) {
      maxMs = maxMs || 8000;
      return new Promise(function (resolve, reject) {
        var start = Date.now();
        (function poll() {
          if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
          if (Date.now() - start > maxMs) return reject(new Error('jsPDF failed to load'));
          setTimeout(poll, 60);
        })();
      });
    },

    /** White runner silhouette (for coloured header bands). */
    runner: function () {
      return once('runner', function () {
        return rasterize('/assets/images/msmrunner.svg', { maxPx: 480 });
      });
    },

    /** mountainstate.svg script wordmark. recolor '#ffffff' for bands or a dark hex for paper. */
    wordmark: function (hex) {
      hex = hex || '#ffffff';
      return once('wordmark:' + hex, function () {
        return rasterize('/assets/images/mountainstate.svg', { maxPx: 900, recolor: hex });
      });
    },

    /** Full MSM lockup, dark ink (for light paper). */
    lockup: function () {
      return once('lockup', function () {
        return rasterize('/assets/images/logo1.svg', { maxPx: 600 });
      });
    },

    /** School/team logo by slug from /assets/team logos/ (png preferred, svg fallback). */
    teamLogoPng: function (slug) {
      if (!slug) return Promise.resolve(null);
      return once('team:' + slug, async function () {
        try {
          return await rasterize('/assets/team logos/' + encodeURIComponent(slug) + '.png', { maxPx: 360 });
        } catch (e) {
          return await rasterize('/assets/team logos/' + encodeURIComponent(slug) + '.svg', { maxPx: 360 });
        }
      });
    },

    /** Rasterise an on-page <img> (any same-origin source) to a trimmed PNG. */
    imageElPng: function (el, maxPx) {
      if (!el || !el.src || !el.complete || !el.naturalWidth) return Promise.resolve(null);
      return rasterize(el.src, { maxPx: maxPx || 360 });
    },

    /**
     * Build the branded header drawer. Pass the result as autoTable's
     * didDrawPage so the header repeats on every page.
     *
     * opts: { title, subtitle, color=[r,g,b], schoolPng={data,w,h} }
     * Returns the draw function; tables should start at y >= 30.
     */
    brandHeader: async function (doc, opts) {
      opts = opts || {};
      var color = opts.color || PINE;
      var runner = await api.runner();
      var mark = await api.wordmark('#ffffff');
      var title = opts.title || '';
      var subtitle = opts.subtitle || '';

      return function drawHeader() {
        var W = doc.internal.pageSize.getWidth();
        var BAND = 24;

        doc.setFillColor(color[0], color[1], color[2]);
        doc.rect(0, 0, W, BAND, 'F');
        doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
        doc.rect(0, BAND, W, 1.6, 'F');

        var textX = 14;

        // School logo chip (team pages) or the runner silhouette (site pages).
        if (opts.schoolPng && opts.schoolPng.data) {
          try {
            doc.setFillColor(255, 255, 255);
            doc.roundedRect(10, 2.5, 22, 19, 2.5, 2.5, 'F');
            var s = opts.schoolPng, sh = 15, sw = sh * (s.w / s.h);
            if (sw > 18) { sw = 18; sh = sw * (s.h / s.w); }
            doc.addImage(s.data, 'PNG', 21 - sw / 2, 12 - sh / 2, sw, sh, undefined, 'FAST');
            textX = 38;
          } catch (e) { console.warn('MSMPdf school logo:', e); }
        } else if (runner && runner.data) {
          try {
            var rh = 17, rw = rh * (runner.w / runner.h);
            doc.addImage(runner.data, 'PNG', 14, (BAND - rh) / 2 - 0.5, rw, rh, undefined, 'FAST');
            textX = 14 + rw + 7;
          } catch (e) { console.warn('MSMPdf runner:', e); }
        }

        // mountainstate.svg wordmark, right-aligned inside the band.
        var markW = 40, markX = W - markW - 12;
        if (mark && mark.data) {
          try {
            var mh = markW * (mark.h / mark.w);
            doc.addImage(mark.data, 'PNG', markX, (BAND - mh) / 2, markW, mh, undefined, 'FAST');
          } catch (e) { console.warn('MSMPdf wordmark:', e); }
        }

        // Shrink the title so it never runs under the wordmark.
        var size = 15;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(size);
        while (size > 9 && doc.getTextWidth(title) > markX - textX - 8) {
          size -= 0.5;
          doc.setFontSize(size);
        }
        doc.setTextColor(255, 255, 255);
        doc.text(title, textX, subtitle ? 10.5 : 13.5);

        if (subtitle) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(228, 228, 228);
          doc.text(subtitle, textX, 17.5);
        }
      };
    },

    /** Matching autoTable style set (pine head, cream stripes) for site exports. */
    tableStyles: function (color) {
      return {
        styles: { fontSize: 9, cellPadding: 1.8 },
        headStyles: { fillColor: color || PINE, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: CREAM }
      };
    },

    /** Gold rule + site footer with page numbers on every page. Call before save(). */
    finalize: function (doc) {
      var pages = doc.internal.getNumberOfPages();
      for (var i = 1; i <= pages; i++) {
        doc.setPage(i);
        var W = doc.internal.pageSize.getWidth();
        var H = doc.internal.pageSize.getHeight();
        doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
        doc.setLineWidth(0.7);
        doc.line(14, H - 14, W - 14, H - 14);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(115, 115, 115);
        doc.text(FOOTER_TEXT, 14, H - 9);
        doc.text('Page ' + i + ' of ' + pages, W - 14, H - 9, { align: 'right' });
      }
    }
  };

  window.MSMPdf = api;
})();
