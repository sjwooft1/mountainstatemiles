/*!
 * Mountain State Miles — Cross Country Course Engine
 * ---------------------------------------------------
 * Dependency-free course analysis used by the course viewer (and anything else
 * that wants trustworthy numbers). Runs in the browser and in Node.
 *
 * Why this exists: naive GPX math lies. Summing raw <ele> deltas inflates
 * elevation gain 2-4x because of GPS/barometer noise, and a single "net grade
 * per mile" trick scores a mile with +200ft then -200ft as flat. This engine
 * instead:
 *
 *   1. Collapses duplicate/jittered points, then smooths elevation by DISTANCE
 *      (not by point index, so variable GPS sampling rates don't skew it).
 *   2. Accumulates gain/loss with a hysteresis threshold, the same technique
 *      Garmin/Strava-class tools use, so noise doesn't get counted as climbing.
 *   3. Computes a rolling local grade per point and integrates the metabolic
 *      cost of running that gradient (Minetti et al. 2002) to get the course's
 *      "flat equivalent" distance. Ups AND downs both count, and steep
 *      descents correctly stop being free speed.
 *   4. Detects real climbs (length + gain + grade, with hysteresis merging) so
 *      runners get a hill sheet instead of a vague elevation squiggle.
 *
 * Public API lives on window.CourseEngine (or module.exports in Node).
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- constants
  var M_PER_MILE = 1609.344;
  var FT_PER_M = 3.280839895;
  var RIEGEL_EXPONENT = 1.06; // endurance fatigue exponent (Riegel 1981)

  // Pure Minetti over-credits descents for RACE-TIME purposes: it is a metabolic
  // model, and runners racing on grass/trail never bank the full theoretical
  // saving (braking, footing, fatigue, self-limiting on uneven ground). Left
  // uncorrected, a course with 165 ft of climbing computes as EASIER than flat,
  // which no coach would accept. We keep the full climbing cost from Minetti and
  // only realise this fraction of the theoretical downhill benefit.
  var DESCENT_EFFICIENCY = 0.55;

  // Multiplicative time cost of each footing vs. a firm, fast surface.
  // Applied as a distance-weighted average, so a 10% gravel course pays 10% of
  // the gravel penalty, not all of it.
  var SURFACE_FACTORS = {
    'Track': 1.000,
    'Asphalt': 1.000,
    'Dirt Trail': 1.015,
    'Gravel': 1.025,
    'Grass': 1.040
  };
  var SURFACE_COLORS = {
    'Grass': '#3f8f5a',
    'Dirt Trail': '#8a5a2b',
    'Gravel': '#8a8f96',
    'Asphalt': '#5b6470',
    'Track': '#c2504a'
  };
  var SURFACE_TYPES = ['Grass', 'Dirt Trail', 'Gravel', 'Asphalt', 'Track'];

  // Grade bands used to colour maps/charts. Order matters (steepest first).
  var GRADE_BANDS = [
    { max: -0.06, color: '#2f7dd6', label: 'Steep descent' },
    { max: -0.02, color: '#4fb0e0', label: 'Descent' },
    { max: 0.02, color: '#9aa5b3', label: 'Flat / rolling' },
    { max: 0.06, color: '#f2a65a', label: 'Climb' },
    { max: Infinity, color: '#e8654f', label: 'Steep climb' }
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function round(v, d) { var f = Math.pow(10, d || 0); return Math.round(v * f) / f; }

  // ------------------------------------------------------------------ geometry
  function haversineMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
    var dphi = (lat2 - lat1) * Math.PI / 180;
    var dl = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dphi / 2) * Math.sin(dphi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function distanceBetween(a, b) {
    return haversineMeters(a.lat, a.lon, b.lat, b.lon);
  }

  // ------------------------------------------------------------------- parsing
  function attrValue(attrs, name) {
    var m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"').exec(attrs);
    return m ? m[1] : null;
  }

  // Regex fallback so the same math can be validated in Node (no DOMParser).
  function parseGpxRegex(text) {
    var points = [];
    var tagRe = /<(trkpt|rtept)\b([^>]*?)(\/?)>/g;
    var m;
    while ((m = tagRe.exec(text)) !== null) {
      var attrs = m[2];
      var lat = parseFloat(attrValue(attrs, 'lat'));
      var lon = parseFloat(attrValue(attrs, 'lon'));
      if (!isFinite(lat) || !isFinite(lon)) continue;

      var ele = null;
      if (m[3] !== '/') {
        var closeIdx = text.indexOf('</' + m[1] + '>', tagRe.lastIndex);
        var inner = closeIdx === -1 ? '' : text.slice(tagRe.lastIndex, closeIdx);
        var em = /<ele[^>]*>([^<]*)<\/ele>/i.exec(inner);
        if (em) {
          var parsed = parseFloat(em[1]);
          if (isFinite(parsed)) ele = parsed;
        }
      }
      points.push({ lat: lat, lon: lon, ele: ele });
    }
    return points;
  }

  /**
   * Parse a GPX document into raw track points. Supports both <trkpt> and
   * <rtept> (route exports), and points without elevation.
   * @param {string} xmlText
   * @returns {Array<{lat:number, lon:number, ele:number|null}>}
   */
  function parseGPX(xmlText) {
    if (!xmlText || typeof xmlText !== 'string') return [];
    if (typeof DOMParser !== 'undefined') {
      try {
        var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (!doc.querySelector('parsererror')) {
          var nodes = Array.prototype.slice.call(doc.getElementsByTagName('trkpt'));
          if (!nodes.length) nodes = Array.prototype.slice.call(doc.getElementsByTagName('rtept'));
          if (nodes.length) {
            return nodes.map(function (n) {
              var eleNode = n.getElementsByTagName('ele')[0];
              var ele = eleNode ? parseFloat(eleNode.textContent) : null;
              return {
                lat: parseFloat(n.getAttribute('lat')),
                lon: parseFloat(n.getAttribute('lon')),
                ele: isFinite(ele) ? ele : null
              };
            }).filter(function (p) { return isFinite(p.lat) && isFinite(p.lon); });
          }
        }
      } catch (e) { /* fall through to regex */ }
    }
    return parseGpxRegex(xmlText);
  }

  // ------------------------------------------------------- elevation processing

  /**
   * Distance-windowed moving average. Using distance instead of point index is
   * the key detail: it gives the same smoothing whether a logger sampled every
   * 1m or every 15m.
   */
  function smoothByDistance(distM, ele, winM) {
    var n = ele.length;
    var out = new Float64Array(n);
    var half = winM / 2;
    var lo = 0, hi = 0, sum = 0, count = 0;
    for (var i = 0; i < n; i++) {
      var d = distM[i];
      while (hi < n && distM[hi] <= d + half) { sum += ele[hi]; count++; hi++; }
      while (lo < n && distM[lo] < d - half) { sum -= ele[lo]; count--; lo++; }
      out[i] = count ? sum / count : ele[i];
    }
    return out;
  }

  /**
   * Rolling slope over a +/- halfWinM window, as a gradient fraction.
   * Centred windows keep the colour transition roughly on the true breakpoint.
   */
  function rollingGrade(distM, ele, halfWinM, maxGrad) {
    var n = ele.length;
    var out = new Float64Array(n);
    var lo = 0, hi = 0;
    var cap = maxGrad || 0.45;
    for (var i = 0; i < n; i++) {
      var d = distM[i];
      while (hi < n && distM[hi] <= d + halfWinM) hi++;
      while (lo < n && distM[lo] < d - halfWinM) lo++;
      var j1 = clamp(lo, 0, n - 1);
      var j2 = clamp(hi - 1, 0, n - 1);
      var run = distM[j2] - distM[j1];
      out[i] = run > 0.5 ? clamp((ele[j2] - ele[j1]) / run, -cap, cap) : 0;
    }
    return out;
  }

  /**
   * Hysteresis accumulator: only banks elevation change once it clears a
   * threshold, which is what stops GPS jitter being reported as climbing.
   */
  function accumulateGainLoss(ele, thresholdM) {
    var ref = ele[0];
    var gain = 0, loss = 0;
    for (var i = 1; i < ele.length; i++) {
      var d = ele[i] - ref;
      if (d >= thresholdM) { gain += d; ref = ele[i]; }
      else if (d <= -thresholdM) { loss += -d; ref = ele[i]; }
    }
    return { gainM: gain, lossM: loss };
  }

  function interpolateNulls(vals, distM) {
    var out = new Float64Array(vals.length);
    var i, lastValid = -1;
    for (i = 0; i < vals.length; i++) {
      if (vals[i] !== null && isFinite(vals[i])) {
        if (lastValid === -1) {
          for (var k = 0; k < i; k++) out[k] = vals[i]; // back-fill leading gap
        } else if (i - lastValid > 1) {
          var a = vals[lastValid], b = vals[i];
          var dA = distM[lastValid], dB = distM[i];
          var span = dB - dA || 1;
          for (var j = lastValid + 1; j < i; j++) {
            out[j] = a + (b - a) * ((distM[j] - dA) / span);
          }
        }
        out[i] = vals[i];
        lastValid = i;
      } else {
        out[i] = NaN;
      }
    }
    if (lastValid === -1) return out;
    for (i = lastValid + 1; i < vals.length; i++) out[i] = vals[lastValid]; // tail fill
    return out;
  }

  // --------------------------------------------------------- metabolic modelling

  /**
   * Minetti et al. (2002) metabolic cost of running per unit distance
   * (J/kg/m) as a function of gradient fraction. At 0% this is 3.6.
   */
  function minettiCost(grade) {
    var i = clamp(grade, -0.35, 0.35);
    return 155.4 * Math.pow(i, 5) -
      30.4 * Math.pow(i, 4) -
      43.3 * Math.pow(i, 3) +
      46.3 * Math.pow(i, 2) +
      19.5 * i + 3.6;
  }

  /**
   * Cost of running a gradient relative to flat (1.0 = flat). Climbs pay the
   * full Minetti cost; descents only realise DESCENT_EFFICIENCY of the saving.
   */
  function gradeCostFactor(grade) {
    var raw = minettiCost(grade) / 3.6;
    if (grade < 0) return 1 + (raw - 1) * DESCENT_EFFICIENCY;
    return raw;
  }

  /**
   * Linear-interpolate elevation at arbitrary distances. Used to move terrain
   * costing onto a uniform distance grid.
   */
  function sampleAtDistances(distM, ele, targets) {
    var out = new Float64Array(targets.length);
    var j = 0;
    for (var i = 0; i < targets.length; i++) {
      var d = targets[i];
      while (j < distM.length - 2 && distM[j + 1] < d) j++;
      var d0 = distM[j], d1 = distM[j + 1];
      if (d1 === undefined || d1 <= d0) { out[i] = ele[j]; continue; }
      var t = clamp((d - d0) / (d1 - d0), 0, 1);
      out[i] = ele[j] + (ele[j + 1] - ele[j]) * t;
    }
    return out;
  }

  /**
   * Terrain cost on a UNIFORM distance grid.
   *
   * This is deliberately not computed on the raw track: a 2.6m-sampled trace
   * and a 14m-sampled one would otherwise be graded over wildly different
   * amounts of real distance, so the same hill would cost differently depending
   * on how the file happened to be recorded. Resampling to a fixed grid (and
   * using a window wide enough to average out ~0.2m DEM quantisation) makes the
   * number comparable between courses — which is the whole point of a rating.
   */
  /** Resample a prepared track onto a uniform distance grid with grades. */
  function buildUniformGrid(distM, eleSmooth, opts) {
    var o = opts || {};
    var gridM = o.gridM || 25;
    var halfWin = o.halfWindowM || 50;
    var total = distM[distM.length - 1];
    var count = Math.max(2, Math.round(total / gridM) + 1);
    var gd = new Float64Array(count);
    for (var i = 0; i < count; i++) gd[i] = (i / (count - 1)) * total;
    var ge = sampleAtDistances(distM, eleSmooth, gd);
    var gg = rollingGrade(gd, ge, halfWin, 0.45);
    return { distM: gd, ele: ge, grade: gg, total: total, count: count };
  }

  function terrainCost(distM, eleSmooth, opts) {
    var total = distM[distM.length - 1];
    if (!(total > 0)) return { flatEquivM: 0, climbFlatEquivM: 0, descentFlatEquivM: 0, climbM: 0, descentM: 0 };

    var grid = buildUniformGrid(distM, eleSmooth, opts);
    var flatEquivM = 0, climbFlatEquivM = 0, descentFlatEquivM = 0, climbM = 0, descentM = 0;
    for (var i = 1; i < grid.count; i++) {
      var step = grid.distM[i] - grid.distM[i - 1];
      if (step <= 0) continue;
      var g = grid.grade[i];
      var cost = step * gradeCostFactor(g);
      flatEquivM += cost;
      if (g > 0) { climbFlatEquivM += cost; climbM += step; }
      else { descentFlatEquivM += cost; descentM += step; }
    }
    return {
      flatEquivM: flatEquivM,
      climbFlatEquivM: climbFlatEquivM,
      descentFlatEquivM: descentFlatEquivM,
      climbM: climbM,
      descentM: descentM
    };
  }

  /** Every useful number for one prepared track. */
  function computeMetrics(distM, eleRaw, eleSmooth, grades, hasElevation, opts) {
    var n = eleSmooth.length;
    var totalM = distM[n - 1] || 0;
    var m = {
      pointCount: n,
      distanceM: totalM,
      distanceMi: totalM / M_PER_MILE,
      hasElevation: !!hasElevation
    };

    if (!hasElevation || !n) {
      m.gainFt = null; m.lossFt = null; m.netFt = null;
      m.minFt = null; m.maxFt = null;
      m.costPct = 0;
      m.flatEquivMi = m.distanceMi;
      m.max100mGradePct = null;
      m.avgAbsGradePct = null;
      m.climbDistanceMi = 0;
      m.descentDistanceMi = 0;
      return m;
    }

    var acc = accumulateGainLoss(eleSmooth, 2.0); // 2m hysteresis
    var min = Infinity, max = -Infinity, absSum = 0;
    for (var i = 0; i < n; i++) {
      if (eleSmooth[i] < min) min = eleSmooth[i];
      if (eleSmooth[i] > max) max = eleSmooth[i];
      absSum += Math.abs(grades[i]);
    }

    // Flat-equivalent distance: terrain cost measured on a uniform grid.
    var cost = terrainCost(distM, eleSmooth, opts);
    var flatEquivM = cost.flatEquivM;

    // Steepest sustained 100m pitch — more honest than instantaneous grade.
    var steepest = 0;
    var lo = 0;
    for (i = 0; i < n; i++) {
      while (distM[i] - distM[lo] > 100) lo++;
      var run = distM[i] - distM[lo];
      if (run >= 60) {
        var g = (eleSmooth[i] - eleSmooth[lo]) / run;
        if (g > steepest) steepest = g;
      }
    }

    m.gainFt = acc.gainM * FT_PER_M;
    m.lossFt = acc.lossM * FT_PER_M;
    m.netFt = (eleSmooth[n - 1] - eleSmooth[0]) * FT_PER_M;
    m.minFt = min * FT_PER_M;
    m.maxFt = max * FT_PER_M;
    m.avgAbsGradePct = (absSum / n) * 100;
    m.max100mGradePct = steepest * 100;
    m.flatEquivM = flatEquivM;
    m.flatEquivMi = flatEquivM / M_PER_MILE;
    m.costPct = totalM > 0 ? (flatEquivM / totalM - 1) * 100 : 0;
    m.climbDistanceMi = cost.climbM / M_PER_MILE;
    m.descentDistanceMi = cost.descentM / M_PER_MILE;
    return m;
  }

  /**
   * Turn raw parsed points into a prepared track: jitter-collapsed, distance
   * stamped, elevation smoothed, graded.
   */
  function prepareTrack(rawPoints, options) {
    var opts = options || {};
    // 10m keeps genuine short hills intact while still killing GPS/baro noise.
    // Wider windows (20m+) measurably flatten stiff hills into "flat" distance
    // and under-report the course's terrain cost.
    var smoothWin = opts.smoothWindowM || 10;
    var gradeWin = opts.gradeWindowM || 16;
    var maxGrad = opts.maxGrade || 0.45;

    if (!rawPoints || !rawPoints.length) {
      return { points: [], metrics: computeMetrics([0], [], [], [], false), hasElevation: false };
    }

    var pts = [];
    var distM = [];
    var eleVals = [];
    var acc = 0;
    var last = null;

    for (var i = 0; i < rawPoints.length; i++) {
      var p = rawPoints[i];
      if (!isFinite(p.lat) || !isFinite(p.lon)) continue;
      if (last) {
        var step = distanceBetween(last, p);
        // Collapse GPS jitter that stands still, but never drop the final point.
        if (step < 0.4 && i !== rawPoints.length - 1) continue;
        acc += step;
      }
      pts.push({ lat: p.lat, lon: p.lon });
      distM.push(acc);
      eleVals.push(isFinite(p.ele) ? p.ele : null);
      last = p;
    }

    if (pts.length < 2) {
      return { points: [], metrics: computeMetrics([0], [], [], [], false), hasElevation: false };
    }

    var eleCount = 0;
    for (i = 0; i < eleVals.length; i++) if (eleVals[i] !== null) eleCount++;
    var hasElevation = eleCount >= Math.max(10, eleVals.length * 0.5);

    var distArr = Float64Array.from(distM);
    var eleArr = hasElevation ? interpolateNulls(eleVals, distArr) : new Float64Array(pts.length);
    var eleSmooth = hasElevation ? smoothByDistance(distArr, eleArr, smoothWin) : new Float64Array(pts.length);

    // Widen the grading window on sparsely-sampled tracks so a 14m-spaced trace
    // is not graded off a single point pair. Without this, the same hill colours
    // differently depending on how the file was recorded.
    var medianStep = 0;
    if (distM.length > 2) {
      var gaps = [];
      for (var k = 1; k < distM.length; k++) gaps.push(distM[k] - distM[k - 1]);
      gaps.sort(function (a, b) { return a - b; });
      medianStep = gaps[Math.floor(gaps.length / 2)];
    }
    var gradeHalfWin = Math.max(gradeWin, medianStep * 1.5);
    var grades = hasElevation ? rollingGrade(distArr, eleSmooth, gradeHalfWin, maxGrad) : new Float64Array(pts.length);

    var totalM = distM[pts.length - 1];
    var out = new Array(pts.length);
    for (i = 0; i < pts.length; i++) {
      out[i] = {
        lat: pts[i].lat,
        lon: pts[i].lon,
        ele: hasElevation ? eleArr[i] : null,
        eleSmooth: hasElevation ? eleSmooth[i] : null,
        distM: distM[i],
        distMi: totalM > 0 ? distM[i] / M_PER_MILE : 0,
        pctComplete: totalM > 0 ? distM[i] / totalM : 0,
        grade: hasElevation ? grades[i] : 0
      };
    }

    return {
      points: out,
      hasElevation: hasElevation,
      metrics: computeMetrics(distArr, eleArr, eleSmooth, grades, hasElevation, opts)
    };
  }

  // ------------------------------------------------------------ climb detection

  /**
   * Find genuine climbs: sustained sections above a grade threshold, expanded
   * outward to their true base/summit and merged when only a short dip splits
   * one hill into two.
   */
  function detectClimbs(points, options) {
    var o = Object.assign({
      minLengthM: 130,
      minGainFt: 15,
      minGradePct: 1.0,
      exitGradeRatio: 0.35,
      mergeGapM: 90,
      gradeWindowM: 60
    }, options || {});

    if (!points || points.length < 3 || points[0].eleSmooth === null) return [];

    var n = points.length;
    var distArr = new Float64Array(n);
    var eleArr = new Float64Array(n);
    for (var i = 0; i < n; i++) { distArr[i] = points[i].distM; eleArr[i] = points[i].eleSmooth; }

    var grades = rollingGrade(distArr, eleArr, o.gradeWindowM / 2, 1);
    var enter = o.minGradePct / 100;
    var exit = enter * o.exitGradeRatio;

    var runs = [];
    var start = -1;
    for (i = 0; i < n; i++) {
      if (start < 0) {
        if (grades[i] >= enter) start = i;
      } else if (grades[i] < exit) {
        runs.push([start, i - 1]);
        start = -1;
      }
    }
    if (start >= 0) runs.push([start, n - 1]);

    // Merge climbs separated by a short dip (rolling terrain, not two hills).
    var merged = [];
    runs.forEach(function (r) {
      var prev = merged[merged.length - 1];
      if (prev && (points[r[0]].distM - points[prev[1]].distM) < o.mergeGapM) {
        prev[1] = r[1];
      } else {
        merged.push([r[0], r[1]]);
      }
    });

    var climbs = [];
    merged.forEach(function (r) {
      var a = r[0], b = r[1];
      // Anchor to the true low/high inside a small collar so the hill sheet
      // reports the whole rise, not just the part above the threshold.
      var padA = a, padB = b;
      while (padA > 0 && points[padA].eleSmooth <= points[padA + 1].eleSmooth) padA--;
      while (padB < n - 1 && points[padB].eleSmooth >= points[padB - 1].eleSmooth) padB++;

      var lenM = points[padB].distM - points[padA].distM;
      if (lenM < o.minLengthM) return;
      var gainM = points[padB].eleSmooth - points[padA].eleSmooth;
      var gainFt = gainM * FT_PER_M;
      if (gainFt < o.minGainFt) return;

      var maxG = 0;
      for (var k = padA; k <= padB; k++) if (grades[k] > maxG) maxG = grades[k];

      climbs.push({
        startDistMi: points[padA].distM / M_PER_MILE,
        endDistMi: points[padB].distM / M_PER_MILE,
        lengthM: lenM,
        lengthMi: lenM / M_PER_MILE,
        gainFt: gainFt,
        avgGradePct: lenM > 0 ? (gainM / lenM) * 100 : 0,
        maxGradePct: maxG * 100,
        score: gainFt * Math.max(0, lenM > 0 ? (gainM / lenM) * 100 : 0)
      });
    });

    climbs.sort(function (a, b) { return a.startDistMi - b.startDistMi; });
    climbs.forEach(function (c, idx) {
      c.index = idx + 1;
      c.name = 'Hill ' + (idx + 1);
      c.category = classifyClimb(c);
    });
    return climbs;
  }

  function classifyClimb(climb) {
    var g = climb.avgGradePct || 0;
    var ft = climb.gainFt || 0;
    if (g >= 5 || ft >= 130) return 'major';
    if (g >= 3 || ft >= 65) return 'moderate';
    return 'rolling';
  }

  // ------------------------------------------------------------------ condition

  /**
   * Performance multiplier for heat + humidity. Ballpark model: losses start
   * accumulating above ~50F and are amplified by humidity (which blocks
   * evaporative cooling). Documented as an estimate, not gospel.
   */
  function weatherFactor(tempF, humidityPct) {
    var t = Math.max(0, (isFinite(tempF) ? tempF : 55) - 50);
    var rh = clamp((isFinite(humidityPct) ? humidityPct : 50) / 100, 0, 1);
    var perDegF = 0.0025 + 0.0035 * rh * rh;
    return 1 + t * perDegF;
  }

  /** Distance-weighted surface multiplier from a [{type,pct}] breakdown. */
  function surfaceFactor(surfaces) {
    if (!Array.isArray(surfaces) || !surfaces.length) return 1;
    var total = 0, weighted = 0, sumPct = 0;
    surfaces.forEach(function (s) {
      var pct = parseFloat(s.pct);
      if (!isFinite(pct) || pct <= 0) return;
      var f = SURFACE_FACTORS[s.type];
      if (!f) f = 1.02; // unknown footing gets a mild, honest penalty
      total += pct;
      sumPct += pct;
      weighted += pct * f;
    });
    if (!total) return 1;
    // Normalise by the recorded percentages so a breakdown that doesn't sum to
    // 100 still yields a sane multiplier instead of skewing the prediction.
    return weighted / sumPct;
  }

  // ----------------------------------------------------------------- prediction

  /**
   * Predict a course time from a known flat-course PR using Riegel scaling on
   * the course's flat-equivalent distance, then apply footing + conditions.
   */
  function predictTime(opts) {
    var refMi = opts.refMi > 0 ? opts.refMi : 3.10686;
    var refSeconds = opts.refSeconds > 0 ? opts.refSeconds : null;
    var flatEquivMi = opts.flatEquivMi > 0 ? opts.flatEquivMi : refMi;
    if (!refSeconds) return null;

    var riegel = refSeconds * Math.pow(flatEquivMi / refMi, RIEGEL_EXPONENT);
    var surface = surfaceFactor(opts.surfaces);
    var weather = weatherFactor(opts.tempF, opts.humidityPct);
    var total = riegel * surface * weather;

    var flatSameDistance = refSeconds * Math.pow((opts.distanceMi > 0 ? opts.distanceMi : refMi) / refMi, RIEGEL_EXPONENT);

    return {
      seconds: total,
      riegelSeconds: riegel,
      surfaceMultiplier: surface,
      weatherMultiplier: weather,
      gradeMultiplier: riegel / flatSameDistance,
      secondsOverFlat: total - flatSameDistance,
      percentOverFlat: flatSameDistance > 0 ? (total / flatSameDistance - 1) * 100 : 0
    };
  }

  /**
   * Split a predicted total across the course in proportion to each mile's
   * flat-equivalent cost, so climbing miles are honestly given more time.
   */
  function buildRacePlan(points, totalSeconds, options) {
    var o = Object.assign({ splitMiles: 1 }, options || {});
    if (!points || points.length < 2 || !totalSeconds) return { splits: [], totalFlatEquivMi: 0 };

    var stepM = o.splitMiles * M_PER_MILE;
    var splits = [];
    var segFlatEquivM = 0;
    var segGainM = 0;
    var segLossM = 0;
    var segStartDistM = 0;
    var nextBoundary = stepM;
    var target = 1;
    var totalFlatEquivM = 0;

    // Build the plan on the same uniform distance grid the terrain cost uses, so
    // a mile's share of the total time never depends on how densely the GPX
    // happened to be sampled.
    var hasElevation = !!(points[0] && points[0].eleSmooth !== null);
    var gdist = [], gele = [], ggrade = [], gtotal = 0;
    if (hasElevation) {
      var dArr = new Float64Array(points.length), eArr = new Float64Array(points.length);
      for (var pi = 0; pi < points.length; pi++) { dArr[pi] = points[pi].distM; eArr[pi] = points[pi].eleSmooth; }
      var grid = buildUniformGrid(dArr, eArr, { gridM: o.gridM || 25, halfWindowM: o.halfWindowM || 50 });
      for (var gi = 0; gi < grid.count; gi++) { gdist.push(grid.distM[gi]); gele.push(grid.ele[gi]); ggrade.push(grid.grade[gi]); }
      gtotal = grid.total;
    } else {
      for (var qi = 0; qi < points.length; qi++) { gdist.push(points[qi].distM); gele.push(0); ggrade.push(0); }
      gtotal = points[points.length - 1].distM;
    }

    function flush(endIdx, boundaryDistM, partial) {
      var segDistM = boundaryDistM - segStartDistM;
      if (segDistM <= 0) return;
      splits.push({
        label: boundaryDistM >= gtotal - 5
          ? (target <= 1 ? 'Mile 1' : 'Final kick')
          : ('Mile ' + target),
        startDistMi: segStartDistM / M_PER_MILE,
        endDistMi: boundaryDistM / M_PER_MILE,
        distanceMi: segDistM / M_PER_MILE,
        gainFt: segGainM * FT_PER_M,
        lossFt: segLossM * FT_PER_M,
        netFt: (segGainM - segLossM) * FT_PER_M,
        flatEquivMi: segFlatEquivM / M_PER_MILE,
        avgGradePct: segDistM > 0 ? ((segGainM - segLossM) / segDistM) * 100 : 0,
        partial: !!partial
      });
      segStartDistM = boundaryDistM;
      void endIdx;
      segFlatEquivM = 0;
      segGainM = 0;
      segLossM = 0;
    }    for (var i = 1; i < gdist.length; i++) {
      var d0 = gdist[i - 1];
      var d1 = gdist[i];
      var step = d1 - d0;
      if (step <= 0) continue;

      // Walk any mile boundaries crossed inside this step.
      while (d1 >= nextBoundary) {
        var ratio = (nextBoundary - d0) / step;
        var eleAtBoundary = gele[i - 1] + (gele[i] - gele[i - 1]) * ratio;
        var grade = ggrade[i];
        var before = step * ratio;
        segFlatEquivM += before * gradeCostFactor(grade);
        totalFlatEquivM += before * gradeCostFactor(grade);
        var deBefore = eleAtBoundary - gele[i - 1];
        if (deBefore > 0) segGainM += deBefore; else segLossM += -deBefore;
        flush(0, nextBoundary, false);
        target++;
        nextBoundary += stepM;

        // Remainder of the step past the boundary.
        var after = step - before;
        segFlatEquivM += after * gradeCostFactor(grade);
        totalFlatEquivM += after * gradeCostFactor(grade);
        var deAfter = gele[i] - eleAtBoundary;
        if (deAfter > 0) segGainM += deAfter; else segLossM += -deAfter;
      }

      if (d1 < nextBoundary) {
        var f = step * gradeCostFactor(ggrade[i]);
        segFlatEquivM += f;
        totalFlatEquivM += f;
        var decl = gele[i] - gele[i - 1];
        if (decl > 0) segGainM += decl; else segLossM += -decl;
      }
    }

    // Flush the trailing partial mile.
    if (gtotal - segStartDistM > 1) flush(0, gtotal, true);

    // Per-segment climbing read straight off the grid is un-filtered, so it runs
    // high on noisy tracks. Scale the segments so they sum to the course's
    // measured gain/loss, keeping the splits consistent with the headline stats.
    if (hasElevation && o.totalGainFt && o.totalLossFt) {
      var rawGain = splits.reduce(function (s, x) { return s + x.gainFt; }, 0) || 1;
      var rawLoss = splits.reduce(function (s, x) { return s + x.lossFt; }, 0) || 1;
      var gk = o.totalGainFt / rawGain, lk = o.totalLossFt / rawLoss;
      splits.forEach(function (s) { s.gainFt *= gk; s.lossFt *= lk; s.netFt = s.gainFt - s.lossFt; });
    }


    var sumFlat = splits.reduce(function (s, x) { return s + x.flatEquivMi; }, 0) || totalFlatEquivM / M_PER_MILE || 1;
    var cumulative = 0;
    splits.forEach(function (s) {
      s.timeSeconds = totalSeconds * (s.flatEquivMi / sumFlat);
      cumulative += s.timeSeconds;
      s.cumulativeSeconds = cumulative;
      s.paceSecPerMi = s.distanceMi > 0 ? s.timeSeconds / s.distanceMi : 0;
      s.guidance = segmentGuidance(s);
      s.effortLabel = segmentEffortLabel(s);
    });

    return { splits: splits, totalFlatEquivMi: sumFlat };
  }

  function segmentEffortLabel(s) {
    var g = s.avgGradePct || 0;
    if (g >= 2.5) return 'Climb';
    if (g >= 0.8) return 'Rising';
    if (g <= -2.5) return 'Descent';
    if (g <= -0.8) return 'Falling';
    // A mile that climbs and drops meaningfully is rolling, not level.
    if ((s.gainFt || 0) > 25 && (s.lossFt || 0) > 25) return 'Rolling';
    return 'Level';
  }

  function segmentGuidance(s) {
    var g = s.avgGradePct || 0;
    var gain = s.gainFt || 0;
    var loss = s.lossFt || 0;
    if (g >= 2.5) {
      return 'Net climb (+' + Math.round(gain) + 'ft). Shorten stride, hold effort not pace. Expect this mile to be the slowest and plan the pass AFTER the crest.';
    }
    if (g >= 0.8) {
      return 'Rising. Stay relaxed on the up, then press as soon as the grade flattens.';
    }
    if (g <= -2.5) {
      return 'Net descent (-' + Math.round(loss) + 'ft). Let gravity work: quick feet, no braking, use it to recover and build speed.';
    }
    if (g <= -0.8) {
      return 'Falling grade. Smooth acceleration — this is where free seconds live.';
    }
    if (gain > 25 && loss > 25) {
      return 'Rolling. Rhythm mile: keep cadence constant and don\'t chase the short surges.';
    }
    return 'Level. Lock into goal pace and sit in — best place to make a controlled move.';
  }

  /**
   * One-number difficulty read for cards and headers. Compares the course
   * against a flat course of the SAME measured distance.
   */
  function rateCourse(metrics) {
    if (!metrics || !metrics.distanceMi) {
      return { costPct: 0, secondsOverFlat: 0, stars: 1, label: 'Unknown' };
    }
    var refSec = 17 * 60;        // 17:00 flat 5K benchmark
    var refMi = 3.10686;
    var flatSameDist = refSec * Math.pow(metrics.distanceMi / refMi, RIEGEL_EXPONENT);
    var courseTime = refSec * Math.pow(metrics.flatEquivMi / refMi, RIEGEL_EXPONENT);
    var secondsOverFlat = courseTime - flatSameDist;
    var costPct = metrics.costPct || 0;
    var stars = clamp(1 + costPct / 1.5, 1, 5);
    var label = costPct < 1.5 ? 'Fast' : costPct < 3 ? 'Moderate' : costPct < 4.5 ? 'Tough' : 'Brutal';
    return {
      ref5kSeconds: refSec,
      flatSameDistanceSeconds: flatSameDist,
      courseSeconds: courseTime,
      secondsOverFlat: secondsOverFlat,
      costPct: costPct,
      stars: stars,
      label: label
    };
  }

  // ---------------------------------------------------------------- formatting

  function fmtTime(seconds) {
    if (seconds === null || seconds === undefined || !isFinite(seconds)) return '—';
    var s = Math.round(seconds);
    var m = Math.floor(s / 60);
    var rem = s - m * 60;
    return m + ':' + (rem < 10 ? '0' : '') + rem;
  }

  function fmtTimeTenths(seconds) {
    if (seconds === null || seconds === undefined || !isFinite(seconds)) return '—';
    var tenths = Math.round(seconds * 10) / 10;
    var m = Math.floor(tenths / 60);
    var rem = tenths - m * 60;
    return m + ':' + (rem < 10 ? '0' : '') + rem.toFixed(1);
  }

  function fmtPace(secondsPerMile) {
    return fmtTime(secondsPerMile) + '/mi';
  }

  function gradeBand(grade) {
    for (var i = 0; i < GRADE_BANDS.length; i++) {
      if (grade < GRADE_BANDS[i].max) return GRADE_BANDS[i];
    }
    return GRADE_BANDS[GRADE_BANDS.length - 1];
  }

  function gradeColor(grade) { return gradeBand(grade).color; }

  /**
   * Group a prepared track into contiguous same-grade-colour polyline runs.
   * One polyline per run keeps Leaflet happy on 2,500-point traces.
   */
  function coloredSegments(points, bucketM) {
    var step = bucketM || 30;
    if (!points || points.length < 2) return [];
    var segments = [];
    var current = { color: null, latlngs: [] };
    var lastFlushDist = -Infinity;

    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var color = gradeColor(p.grade || 0);
      if (color !== current.color && current.latlngs.length) {
        current.latlngs.push([p.lat, p.lon]); // join runs so there are no gaps
        segments.push(current);
        current = { color: color, latlngs: [[p.lat, p.lon]] };
        lastFlushDist = p.distM;
        continue;
      }
      current.color = color;
      current.latlngs.push([p.lat, p.lon]);
      if (p.distM - lastFlushDist >= step && current.latlngs.length > 2) {
        // Long run of one colour: still emit so lines stay light to render.
        segments.push(current);
        current = { color: color, latlngs: [[p.lat, p.lon]] };
        lastFlushDist = p.distM;
      }
    }
    if (current.latlngs.length > 1) segments.push(current);
    return segments;
  }

  /** Evenly resample a track to ~targetCount points for charting. */
  function resample(points, targetCount) {
    var n = points.length;
    if (n <= targetCount) return points.slice();
    var out = [];
    var total = points[n - 1].distM;
    var j = 0;
    for (var k = 0; k < targetCount; k++) {
      var dTarget = (k / (targetCount - 1)) * total;
      while (j < n - 2 && points[j + 1].distM < dTarget) j++;
      out.push(points[j]);
      while (j < n - 2 && points[j + 1].distM <= dTarget) j++;
    }
    if (out[out.length - 1] !== points[n - 1]) out.push(points[n - 1]);
    return out;
  }

  /** Convenience: parse + prepare + detect climbs + rate in one call. */
  function analyze(xmlText, options) {
    var raw = parseGPX(xmlText);
    var track = prepareTrack(raw, options);
    var climbs = track.hasElevation ? detectClimbs(track.points, options && options.climbs) : [];
    var metrics = track.metrics;
    metrics.climbCount = climbs.length;
    metrics.totalClimbFt = climbs.reduce(function (s, c) { return s + c.gainFt; }, 0);
    return {
      points: track.points,
      hasElevation: track.hasElevation,
      metrics: metrics,
      climbs: climbs,
      rating: rateCourse(metrics)
    };
  }

  var API = {
    M_PER_MILE: M_PER_MILE,
    FT_PER_M: FT_PER_M,
    RIEGEL_EXPONENT: RIEGEL_EXPONENT,
    DESCENT_EFFICIENCY: DESCENT_EFFICIENCY,
    SURFACE_FACTORS: SURFACE_FACTORS,
    SURFACE_COLORS: SURFACE_COLORS,
    SURFACE_TYPES: SURFACE_TYPES,
    GRADE_BANDS: GRADE_BANDS,
    parseGPX: parseGPX,
    prepareTrack: prepareTrack,
    detectClimbs: detectClimbs,
    classifyClimb: classifyClimb,
    computeMetrics: computeMetrics,
    minettiCost: minettiCost,
    gradeCostFactor: gradeCostFactor,
    weatherFactor: weatherFactor,
    surfaceFactor: surfaceFactor,
    predictTime: predictTime,
    buildRacePlan: buildRacePlan,
    rateCourse: rateCourse,
    coloredSegments: coloredSegments,
    terrainCost: terrainCost,
    buildUniformGrid: buildUniformGrid,
    resample: resample,
    gradeColor: gradeColor,
    gradeBand: gradeBand,
    analyze: analyze,
    fmtTime: fmtTime,
    fmtTimeTenths: fmtTimeTenths,
    fmtPace: fmtPace,
    round: round,
    clamp: clamp
  };

  global.CourseEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
