// Firebase Helper Functions for WV Runs Cross Country
// Depends on: firebase-config.js (must be loaded first)

// Use a getter so we always reference the live database instance,
// even if firebase-config.js hasn't finished running yet (shouldn't happen
// with correct script order, but avoids a subtle undefined-at-parse-time bug).
function db() {
  const d = window.firebaseDatabase;
  if (!d) throw new Error('Firebase database is not initialized. Check firebase-config.js.');
  return d;
}

const CC_PREFIX = 'Track'; // Realtime Database root key for cross-country data

// ==========================================
// DIVISIONS
// ==========================================

/** WV high school classification divisions (canonical order) */
const WV_DIVISIONS = ['A', 'AA', 'AAA', 'AAAA'];

function normalizeDivision(value) {
  const d = String(value || '').trim().toUpperCase();
  return WV_DIVISIONS.includes(d) ? d : '';
}

function normalizeDivisions(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,|]/);
  const seen = new Set();
  list.forEach((item) => {
    const d = normalizeDivision(item);
    if (d && !seen.has(d)) seen.add(d);
  });
  return WV_DIVISIONS.filter((d) => seen.has(d));
}

function divisionsFromResults(results, meetDivisions) {
  const configured = normalizeDivisions(meetDivisions);
  if (configured.length) return configured;
  const fromData = new Set();
  (results || []).forEach((r) => {
    const d = normalizeDivision(r.division);
    if (d) fromData.add(d);
  });
  return WV_DIVISIONS.filter((d) => fromData.has(d));
}

function resultMatchesDivision(resultDivision, activeDivision) {
  if (!activeDivision || activeDivision === 'ALL') return true;
  const div = normalizeDivision(resultDivision);
  return div !== '' && div === activeDivision;
}

// ==========================================
// NFHS SCORING
// ==========================================

/** NFHS 8-place scoring table (places 1–8) */
const NFHS_SCORE_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

/**
 * Format team/athlete points.
 * Supports 0.5 increments from tie splits per NFHS Rule 6-3 Art. 4.
 */
function formatScorePoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return rounded.toFixed(1).replace(/\.0$/, '');
}

function nfhsPointsForTieGroup(startSlotIndex, tieCount, pointsTable = NFHS_SCORE_POINTS) {
  if (tieCount <= 0) return 0;
  let sum = 0;
  for (let k = 0; k < tieCount && startSlotIndex + k < pointsTable.length; k++) {
    sum += pointsTable[startSlotIndex + k];
  }
  return sum / tieCount;
}

function marksEqualForScoring(a, b) {
  const pa = a.parsed;
  const pb = b.parsed;
  if (pa != null && pb != null && Number.isFinite(pa) && Number.isFinite(pb)) return pa === pb;
  const ma = String(a.mark ?? '').trim();
  const mb = String(b.mark ?? '').trim();
  return ma !== '' && ma === mb;
}

/**
 * Assign place + points from sorted marks.
 * Tied marks split combined place points (NFHS 6-3-4).
 * Example: tie for 2nd → (8+6)/2 = 7 pts each; next finisher is 4th for 5 pts.
 */
function applyNfhsScoringFromMarks(entries, options = {}) {
  const pointsTable = options.pointsTable || NFHS_SCORE_POINTS;
  const fieldEvent = Boolean(options.fieldEvent);
  const maxPlaces = options.maxPlaces ?? 8;

  const sorted = [...entries].sort((a, b) => {
    const pa = a.parsed;
    const pb = b.parsed;
    if (pa != null && pb != null && Number.isFinite(pa) && Number.isFinite(pb)) {
      return fieldEvent ? pb - pa : pa - pb;
    }
    return 0;
  });

  let slotIndex = 0;
  let i = 0;
  while (i < sorted.length && slotIndex < maxPlaces) {
    let j = i + 1;
    while (j < sorted.length && marksEqualForScoring(sorted[i], sorted[j])) j++;
    const tieCount = j - i;
    const place = slotIndex + 1;
    const pointsEach = nfhsPointsForTieGroup(slotIndex, tieCount, pointsTable);
    for (let t = i; t < j; t++) {
      sorted[t].place = place;
      sorted[t].points = pointsEach;
      sorted[t].tied = tieCount > 1;
    }
    slotIndex += tieCount;
    i = j;
  }
  while (i < sorted.length) {
    sorted[i].place = slotIndex + 1;
    sorted[i].points = 0;
    sorted[i].tied = false;
    slotIndex++;
    i++;
  }
  return sorted;
}

/**
 * Assign points when official placements are already recorded (e.g. imported meet results).
 * Athletes sharing the same place split points for those scoring positions.
 */
function applyNfhsScoringFromPlacements(entries, options = {}) {
  const pointsTable = options.pointsTable || NFHS_SCORE_POINTS;
  const maxPlaces = options.maxPlaces ?? 8;

  const withPlace = entries
    .map((e) => ({ entry: e, place: parseInt(e.placement, 10) }))
    .filter((x) => Number.isFinite(x.place) && x.place > 0);

  const placeNumbers = [...new Set(withPlace.map((x) => x.place))].sort((a, b) => a - b);
  let slotIndex = 0;

  placeNumbers.forEach((placeNum) => {
    if (slotIndex >= maxPlaces) return;
    const group = withPlace.filter((x) => x.place === placeNum).map((x) => x.entry);
    const tieCount = group.length;
    if (placeNum > slotIndex + 1) slotIndex = placeNum - 1;
    const pointsEach = nfhsPointsForTieGroup(slotIndex, tieCount, pointsTable);
    group.forEach((e) => {
      e.place = placeNum;
      e.points = pointsEach;
      e.scoredPoints = pointsEach;
      e.tied = tieCount > 1;
    });
    slotIndex += tieCount;
  });

  // Zero out entries that had no valid placement
  entries.forEach((e) => {
    const p = parseInt(e.placement, 10);
    if (!Number.isFinite(p) || p <= 0) {
      e.points = 0;
      e.scoredPoints = 0;
    }
  });

  return entries;
}

// ==========================================
// UTILITIES
// ==========================================

/** Convert a Firebase snapshot to a plain array, injecting the Firebase key as `id`. */
function snapshotToArray(snapshot) {
  if (!snapshot.exists()) return [];
  const data = snapshot.val();
  if (!data) return [];
  if (typeof data === 'object' && !Array.isArray(data)) {
    return Object.keys(data).map((key) => ({ id: key, ...data[key] }));
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Parse a time string to total seconds.
 * Handles: "18:30.45", "20:15", "1:20:15", "1200.5", "1200"
 */
function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  const str = String(timeStr).trim();

  // Plain number → already seconds
  if (!str.includes(':') && !isNaN(str)) return parseFloat(str);

  if (str.includes(':')) {
    const parts = str.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    }
    if (parts.length === 3) {
      return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
    }
  }

  return NaN;
}

// ==========================================
// SCHOOLS
// ==========================================

/** Get all schools, sorted alphabetically by name. */
async function getAllSchools() {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/schools`).once('value');
    const schools = snapshotToArray(snapshot);
    return schools.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (err) {
    console.error('[getAllSchools]', err);
    return [];
  }
}

/** Get a single school by its slug. */
async function getSchoolBySlug(slug) {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/schools`)
      .orderByChild('slug').equalTo(slug).once('value');
    const schools = snapshotToArray(snapshot);
    return schools[0] ?? null;
  } catch (err) {
    console.error('[getSchoolBySlug]', err);
    return null;
  }
}

/** Convenience wrapper — returns just the school name. */
async function getSchoolNameBySlug(slug) {
  const school = await getSchoolBySlug(slug);
  return school ? school.name : null;
}

// ==========================================
// MEETS
// ==========================================

/**
 * Get all meets ordered by date descending.
 * @param {number} limit - Max results (default 100)
 */
async function getAllMeets(limit = 100) {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/meets`).orderByChild('date').once('value');
    const meets = snapshotToArray(snapshot);
    return meets
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, limit);
  } catch (err) {
    console.error('[getAllMeets]', err);
    return [];
  }
}

/** Get a single meet by its slug. */
async function getMeetBySlug(slug) {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/meets`)
      .orderByChild('slug').equalTo(slug).once('value');
    const meets = snapshotToArray(snapshot);
    return meets[0] ?? null;
  } catch (err) {
    console.error('[getMeetBySlug]', err);
    return null;
  }
}

/**
 * Create a new meet record.
 * Accepts a plain object with: { name, slug, date, divisions }
 */
async function createMeet(meetData) {
  if (!meetData.name || !meetData.slug || !meetData.date) {
    return { error: 'Missing required fields: name, slug, date' };
  }
  try {
    const meetRef = db().ref(`${CC_PREFIX}/meets`).push();
    const payload = {
      name: meetData.name,
      slug: meetData.slug,
      date: meetData.date,
      divisions: meetData.divisions || '',
    };
    await meetRef.set(payload);
    return { id: meetRef.key, ...payload };
  } catch (err) {
    console.error('[createMeet]', err);
    return { error: err.message };
  }
}

// ==========================================
// RESULTS
// ==========================================

/** Get all results for a meet, sorted by time ascending. */
async function getResultsByMeet(meetSlug) {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/results`)
      .orderByChild('meet_slug').equalTo(meetSlug).once('value');
    const results = snapshotToArray(snapshot);
    return results.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  } catch (err) {
    console.error('[getResultsByMeet]', err);
    return [];
  }
}

/** Get all results for a school, sorted by date descending. */
async function getResultsBySchool(schoolSlug) {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/results`)
      .orderByChild('school_slug').equalTo(schoolSlug).once('value');
    const results = snapshotToArray(snapshot);
    return results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  } catch (err) {
    console.error('[getResultsBySchool]', err);
    return [];
  }
}

/** Get all results for an athlete, sorted by date descending. */
async function getResultsByAthlete(athleteName) {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/results`)
      .orderByChild('athlete_name').equalTo(athleteName).once('value');
    const results = snapshotToArray(snapshot);
    return results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  } catch (err) {
    console.error('[getResultsByAthlete]', err);
    return [];
  }
}

// ==========================================
// ATHLETES
// ==========================================

/** Get every athlete in the database, sorted by name. */
async function getAllAthletes() {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/athletes`).once('value');
    const athletes = snapshotToArray(snapshot);
    return athletes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (err) {
    console.error('[getAllAthletes]', err);
    return [];
  }
}

/** Get all athletes for a school, sorted by name. */
async function getAthletesBySchool(schoolSlug) {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/athletes`)
      .orderByChild('school_slug').equalTo(schoolSlug).once('value');
    const athletes = snapshotToArray(snapshot);
    return athletes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (err) {
    console.error('[getAthletesBySchool]', err);
    return [];
  }
}

/** Get a single athlete by their slug. */
async function getAthleteBySlug(slug) {
  try {
    const snapshot = await db().ref(`${CC_PREFIX}/athletes`)
      .orderByChild('slug').equalTo(slug).once('value');
    const athletes = snapshotToArray(snapshot);
    return athletes[0] ?? null;
  } catch (err) {
    console.error('[getAthleteBySlug]', err);
    return null;
  }
}

// ==========================================
// BULK IMPORT
// ==========================================

/**
 * Bulk-insert result rows for a given meet.
 * Each row: { athlete_name, school_slug, gender, time, distance, place }
 * Returns { success: number, errors: string[], total: number }
 */
async function bulkInsertResults(meetSlug, rows) {
  const report = { success: 0, errors: [], total: rows.length };
  const validRows = [];

  rows.forEach((row, i) => {
    const n = i + 1;

    if (!row.athlete_name) {
      report.errors.push(`Row ${n}: athlete_name is required`);
      return;
    }

    const clean = { ...row, meet_slug: meetSlug };

    // Time
    if (clean.time) {
      const secs = parseTimeToSeconds(clean.time);
      if (isNaN(secs)) {
        report.errors.push(`Row ${n}: Invalid time "${clean.time}"`);
        return;
      }
      if (secs > 36000) {
        report.errors.push(`Row ${n}: Time ${secs}s (${Math.round(secs / 60)} min) seems too long — check value`);
        return;
      }
      clean.time = secs;
    }

    // Distance
    if (clean.distance) {
      const dist = parseFloat(clean.distance);
      if (isNaN(dist)) {
        report.errors.push(`Row ${n}: Invalid distance "${clean.distance}"`);
        return;
      }
      clean.distance = dist;
    }

    // Place
    if (clean.place) {
      const place = parseInt(clean.place, 10);
      if (isNaN(place)) {
        report.errors.push(`Row ${n}: Invalid place "${clean.place}"`);
        return;
      }
      clean.place = place;
    }

    // Gender
    if (clean.gender) {
      const g = clean.gender.toUpperCase();
      if (!['M', 'F'].includes(g)) {
        report.errors.push(`Row ${n}: Invalid gender "${clean.gender}" — use M or F`);
        return;
      }
      clean.gender = g;
    }

    validRows.push(clean);
  });

  if (validRows.length === 0) return report;

  try {
    const resultsRef = db().ref(`${CC_PREFIX}/results`);
    await Promise.all(validRows.map((row) => resultsRef.push(row)));
    report.success = validRows.length;
  } catch (err) {
    console.error('[bulkInsertResults]', err);
    report.errors.push(`Database error: ${err.message}`);
  }

  return report;
}

// ==========================================
// CSV / TEMPLATE HELPERS
// ==========================================

function getCSVTemplateHeaders() {
  return ['athlete_name', 'school_slug', 'gender', 'time', 'distance', 'place'];
}

function generateCSVTemplate() {
  const headers = getCSVTemplateHeaders();
  const samples = [
    ['John Smith',    'morgantown',      'M', '18:30.45', '5000', '1'],
    ['Jane Doe',      'university-high', 'F', '20:15.20', '5000', '2'],
    ['Mike Johnson',  'bridgeport',      'M', '19:45.10', '5000', '3'],
  ];
  return [headers.join(','), ...samples.map((r) => r.join(','))].join('\n');
}

// ==========================================
// DATABASE HEALTH CHECK
// ==========================================

/**
 * Verify the Firebase connection with a lightweight read (no writes needed).
 * Returns { success: boolean, error?: string }
 */
async function checkDatabaseSchema() {
  try {
    // A read on a known root node is sufficient to confirm connectivity
    await db().ref(`${CC_PREFIX}/meets`).limitToFirst(1).once('value');
    return { success: true };
  } catch (err) {
    console.error('[checkDatabaseSchema]', err);
    return { success: false, error: err.message };
  }
}

// ==========================================
// GLOBAL EXPORTS
// ==========================================
window.getAllSchools              = getAllSchools;
window.getSchoolBySlug           = getSchoolBySlug;
window.getSchoolNameBySlug       = getSchoolNameBySlug;
window.getMeetBySlug             = getMeetBySlug;
window.getMeets                  = getAllMeets;
window.createMeet                = createMeet;
window.getResultsByMeet          = getResultsByMeet;
window.getResultsBySchool        = getResultsBySchool;
window.getResultsByAthlete       = getResultsByAthlete;
window.getAthleteBySlug          = getAthleteBySlug;
window.getAllAthletes             = getAllAthletes;
window.getAthletes               = getAthletesBySchool;
window.bulkInsertResults         = bulkInsertResults;
window.getCSVTemplateHeaders     = getCSVTemplateHeaders;
window.generateCSVTemplate       = generateCSVTemplate;
window.parseTimeToSeconds        = parseTimeToSeconds;
window.checkDatabaseSchema       = checkDatabaseSchema;
window.formatScorePoints         = formatScorePoints;
window.applyNfhsScoringFromMarks      = applyNfhsScoringFromMarks;
window.applyNfhsScoringFromPlacements = applyNfhsScoringFromPlacements;