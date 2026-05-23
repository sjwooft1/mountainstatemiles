// Firebase Helper Functions for WV Runs
// Using Firebase Realtime Database

const db = window.firebaseDatabase;
const CC_PREFIX = 'Track'; // CrossCountry data prefix

/** WV high school classification divisions */
const WV_DIVISIONS = ['A', 'AA', 'AAA', 'AAAA'];

function normalizeDivision(value) {
  const d = String(value || '').trim().toUpperCase();
  return WV_DIVISIONS.includes(d) ? d : '';
}

function normalizeDivisions(value) {
  if (!value) return [];
  const list = Array.isArray(value)
    ? value
    : String(value).split(/[,|]/);
  const seen = new Set();
  const out = [];
  list.forEach((item) => {
    const d = normalizeDivision(item);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
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
  if (!div) return false;
  return div === activeDivision;
}

/** NFHS 8-place scoring table (places 1–8) */
const NFHS_SCORE_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

/**
 * Format team/athlete points (supports 0.5 from tie splits per NFHS Rule 6-3 Art. 4).
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

function marksEqualForScoring(a, b, fieldEvent) {
  const pa = a.parsed;
  const pb = b.parsed;
  if (pa != null && pb != null && Number.isFinite(pa) && Number.isFinite(pb)) {
    return pa === pb;
  }
  const ma = String(a.mark ?? '').trim();
  const mb = String(b.mark ?? '').trim();
  return ma !== '' && ma === mb;
}

/**
 * Assign place + points from sorted marks. Tied marks split combined place points (NFHS 6-3-4).
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
    while (j < sorted.length && marksEqualForScoring(sorted[i], sorted[j], fieldEvent)) j += 1;
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
    slotIndex += 1;
    i += 1;
  }
  return sorted;
}

/**
 * Assign points when official placements are already recorded (e.g. imported meet results).
 * Athletes with the same place split points for those scoring positions.
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

  entries.forEach((e) => {
    if (!Number.isFinite(parseInt(e.placement, 10)) || parseInt(e.placement, 10) <= 0) {
      e.points = 0;
      e.scoredPoints = 0;
    }
  });

  return entries;
}

// Helper function to convert Firebase snapshot to array
function snapshotToArray(snapshot) {
  if (!snapshot.exists()) return [];
  const data = snapshot.val();
  if (!data) return [];
  
  // If data is an object with keys, convert to array
  if (typeof data === 'object' && !Array.isArray(data)) {
    return Object.keys(data).map(key => ({
      id: key,
      ...data[key]
    }));
  }
  
  return Array.isArray(data) ? data : [];
}

// Helper function to get single item from snapshot
function snapshotToObject(snapshot) {
  if (!snapshot.exists()) return null;
  const data = snapshot.val();
  if (!data) return null;
  
  // If it's an object with a single key, return the value with the key as id
  if (typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (keys.length === 1) {
      return { id: keys[0], ...data[keys[0]] };
    }
  }
  
  return data;
}

// ==========================================
// SCHOOLS
// ==========================================

/**
 * Get all schools from the database
 * @returns {Promise<Array>} Array of school objects
 */
async function getAllSchools() {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/schools`).once('value');
    const schools = snapshotToArray(snapshot);
    return schools.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (error) {
    console.error('Error fetching schools:', error);
    return [];
  }
}

/**
 * Get a single school by slug
 * @param {string} slug - The school's slug identifier
 * @returns {Promise<Object|null>} School object or null
 */
async function getSchoolBySlug(slug) {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/schools`).orderByChild('slug').equalTo(slug).once('value');
    const schools = snapshotToArray(snapshot);
    return schools.length > 0 ? schools[0] : null;
  } catch (error) {
    console.error('Error fetching school:', error);
    return null;
  }
}

/**
 * Get school name by slug
 * @param {string} slug - The school's slug identifier
 * @returns {Promise<string|null>} School name or null
 */
async function getSchoolNameBySlug(slug) {
  const school = await getSchoolBySlug(slug);
  return school ? school.name : null;
}

// ==========================================
// MEETS
// ==========================================

/**
 * Get all meets, ordered by date (newest first)
 * @param {number} limit - Maximum number of meets to return
 * @returns {Promise<Array>} Array of meet objects
 */
async function getAllMeets(limit = 10) {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/meets`).orderByChild('date').once('value');
    let meets = snapshotToArray(snapshot);
    
    // Sort by date descending and limit
    meets = meets.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      return dateB.localeCompare(dateA);
    });
    
    return meets.slice(0, limit);
  } catch (error) {
    console.error('Error fetching meets:', error);
    return [];
  }
}

/**
 * Get a meet by slug
 * @param {string} slug - The meet's slug identifier
 * @returns {Promise<Object|null>} Meet object or null
 */
async function getMeetBySlug(slug) {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/meets`).orderByChild('slug').equalTo(slug).once('value');
    const meets = snapshotToArray(snapshot);
    return meets.length > 0 ? meets[0] : null;
  } catch (error) {
    console.error('Error fetching meet:', error);
    return null;
  }
}

/**
 * Get meets for a specific school
 * @param {string} schoolSlug - The school's slug
 * @returns {Promise<Array>} Array of meet objects
 */
async function getMeetsBySchool(schoolSlug) {
  try {
    // First get all results for this school
    const resultsSnapshot = await db.ref(`${CC_PREFIX}/results`).orderByChild('school_slug').equalTo(schoolSlug).once('value');
    const results = snapshotToArray(resultsSnapshot);
    
    // Get unique meet slugs
    const meetSlugs = [...new Set(results.map(r => r.meet_slug).filter(Boolean))];
    
    // Fetch all meets and filter
    const allMeetsSnapshot = await db.ref(`${CC_PREFIX}/meets`).once('value');
    let allMeets = snapshotToArray(allMeetsSnapshot);
    
    // Filter meets that have results for this school
    const schoolMeets = allMeets.filter(meet => meetSlugs.includes(meet.slug));
    
    // Sort by date descending
    return schoolMeets.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      return dateB.localeCompare(dateA);
    });
  } catch (error) {
    console.error('Error fetching school meets:', error);
    return [];
  }
}

// ==========================================
// RESULTS
// ==========================================

/**
 * Get results for a specific meet
 * @param {string} meetSlug - The meet's slug
 * @returns {Promise<Array>} Array of result objects
 */
async function getResultsByMeet(meetSlug) {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/results`).orderByChild('meet_slug').equalTo(meetSlug).once('value');
    let results = snapshotToArray(snapshot);
    
    // Sort by time
    return results.sort((a, b) => {
      const timeA = a.time || Infinity;
      const timeB = b.time || Infinity;
      return timeA - timeB;
    });
  } catch (error) {
    console.error('Error fetching results:', error);
    return [];
  }
}

/**
 * Get results for a specific school
 * @param {string} schoolSlug - The school's slug
 * @returns {Promise<Array>} Array of result objects
 */
async function getResultsBySchool(schoolSlug) {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/results`).orderByChild('school_slug').equalTo(schoolSlug).once('value');
    let results = snapshotToArray(snapshot);
    
    // Sort by date descending
    return results.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      return dateB.localeCompare(dateA);
    });
  } catch (error) {
    console.error('Error fetching school results:', error);
    return [];
  }
}

/**
 * Get athlete results
 * @param {string} athleteName - The athlete's name
 * @returns {Promise<Array>} Array of result objects
 */
async function getResultsByAthlete(athleteName) {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/results`).orderByChild('athlete_name').equalTo(athleteName).once('value');
    let results = snapshotToArray(snapshot);
    
    // Sort by date descending
    return results.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      return dateB.localeCompare(dateA);
    });
  } catch (error) {
    console.error('Error fetching athlete results:', error);
    return [];
  }
}

// ==========================================
// ATHLETES
// ==========================================

/**
 * Get all athletes for a specific school
 * @param {string} schoolSlug - The school's slug
 * @returns {Promise<Array>} Array of athlete objects
 */
async function getAthletesBySchool(schoolSlug) {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/athletes`).orderByChild('school_slug').equalTo(schoolSlug).once('value');
    let athletes = snapshotToArray(snapshot);
    
    // Sort by name
    return athletes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (error) {
    console.error('Error fetching athletes:', error);
    return [];
  }
}

/**
 * Get athlete by slug
 * @param {string} slug - The athlete's slug identifier
 * @returns {Promise<Object|null>} Athlete object or null
 */
async function getAthleteBySlug(slug) {
  try {
    const snapshot = await db.ref(`${CC_PREFIX}/athletes`).orderByChild('slug').equalTo(slug).once('value');
    const athletes = snapshotToArray(snapshot);
    return athletes.length > 0 ? athletes[0] : null;
  } catch (error) {
    console.error('Error fetching athlete:', error);
    return null;
  }
}

// ==========================================
// CSV IMPORT & BULK OPERATIONS
// ==========================================

/**
 * Parse time string to seconds
 * Handles formats like "18:30.45", "20:15", "1200.5", "1200"
 * @param {string} timeStr - Time string
 * @returns {number} Time in seconds
 */
function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  
  const str = timeStr.toString().trim();
  
  // If it's already a number (seconds), return it
  if (!isNaN(str) && !str.includes(':')) {
    return parseFloat(str);
  }
  
  // Handle MM:SS.ss format
  if (str.includes(':')) {
    const parts = str.split(':');
    
    if (parts.length === 2) {
      const minutes = parseInt(parts[0]);
      const seconds = parseFloat(parts[1]);
      return (minutes * 60) + seconds;
    }
    if (parts.length === 3) {
      const hours = parseInt(parts[0]);
      const minutes = parseInt(parts[1]);
      const seconds = parseFloat(parts[2]);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
  }
  
  return NaN;
}

/**
 * Check if database schema is up to date
 * @returns {Promise<Object>} Object with success status and details
 */
async function checkDatabaseSchema() {
  try {
    // Firebase Realtime Database doesn't have schema constraints
    // Just verify we can write a test value
    const testTime = 1110.450; // 18:30.45 in seconds
    const testRef = db.ref(`${CC_PREFIX}/results`).push();
    
    await testRef.set({
      athlete_name: 'TEST_SCHEMA_CHECK',
      time: testTime,
      meet_slug: 'test-schema-check'
    });
    
    // Clean up test record
    await testRef.remove();
    
    return { success: true, details: 'Schema check passed - Firebase Realtime Database supports flexible schema' };
  } catch (error) {
    console.error('Database schema check error:', error);
    return { 
      success: false, 
      error: error.message,
      details: 'Unable to verify database connection.'
    };
  }
}

/**
 * Parse CSV text into array of objects
 * @param {string} csvText - The CSV text content
 * @param {Array} headers - Array of column headers
 * @returns {Array} Array of parsed objects
 */
function parseCSV(csvText, headers) {
  const lines = csvText.trim().split('\n');
  const results = [];
  
  // Skip the first line (header row)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Simple CSV parsing (handles basic cases)
    const values = line.split(',').map(val => val.trim().replace(/^"|"$/g, ''));
    
    if (values.length !== headers.length) {
      console.warn(`Line ${i + 1} has ${values.length} columns, expected ${headers.length}`);
      continue;
    }
    
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || null;
    });
    
    results.push(row);
  }
  
  return results;
}

/**
 * Bulk insert results from CSV data
 * @param {string} meetSlug - The meet's slug
 * @param {Array} csvData - Array of parsed CSV objects
 * @returns {Promise<Object>} Result object with success count and errors
 */
async function bulkInsertResults(meetSlug, csvData) {
  const results = {
    success: 0,
    errors: [],
    total: csvData.length
  };
  
  // Validate required fields
  const requiredFields = ['athlete_name'];
  const validRows = [];
  
  csvData.forEach((row, index) => {
    const missingFields = requiredFields.filter(field => !row[field]);
    if (missingFields.length > 0) {
      results.errors.push(`Row ${index + 1}: Missing required fields: ${missingFields.join(', ')}`);
      return;
    }
    
    // Add meet_slug to each row
    row.meet_slug = meetSlug;
    
    // Convert numeric fields
    if (row.time) {
      const parsedTime = parseTimeToSeconds(row.time);
      if (isNaN(parsedTime)) {
        results.errors.push(`Row ${index + 1}: Invalid time value: ${row.time}`);
        return;
      }
      
      // Store time as number (Firebase supports numbers)
      row.time = parsedTime;
      
      // Additional validation for reasonable running times
      if (row.time > 36000) { // More than 10 hours
        results.errors.push(`Row ${index + 1}: Time seems unusually long (${row.time}s = ${Math.round(row.time/60)} minutes). Original value: "${row.time}". Please verify this is correct.`);
        return;
      }
    }
    
    if (row.distance) {
      row.distance = parseFloat(row.distance);
      if (isNaN(row.distance)) {
        results.errors.push(`Row ${index + 1}: Invalid distance value: ${row.distance}`);
        return;
      }
    }
    
    if (row.place) {
      row.place = parseInt(row.place);
      if (isNaN(row.place)) {
        results.errors.push(`Row ${index + 1}: Invalid place value: ${row.place}`);
        return;
      }
    }
    
    // Validate gender
    if (row.gender && !['M', 'F'].includes(row.gender.toUpperCase())) {
      results.errors.push(`Row ${index + 1}: Invalid gender value: ${row.gender}`);
      return;
    }
    
    if (row.gender) {
      row.gender = row.gender.toUpperCase();
    }
    
    validRows.push(row);
  });

  if (validRows.length === 0) {
    return results;
  }
  
  // Insert valid rows using Firebase
  try {
    const resultsRef = db.ref(`${CC_PREFIX}/results`);
    const promises = validRows.map(row => resultsRef.push(row));
    await Promise.all(promises);
    results.success = validRows.length;
  } catch (error) {
    console.error('Database insert error:', error);
    results.errors.push(`Database error: ${error.message}`);
  }
  
  return results;
}

/**
 * Create a new meet from CSV import
 * @param {Object} meetData - Meet information
 * @returns {Promise<Object>} Created meet object or error
 */
async function createMeetFromCSV(meetData) {
  try {
    const meetRef = db.ref(`${CC_PREFIX}/meets`).push();
    const meetId = meetRef.key;
    await meetRef.set(meetData);
    
    // Return the created meet with its ID
    const snapshot = await meetRef.once('value');
    return { id: meetId, ...snapshot.val() };
  } catch (error) {
    console.error('Error creating meet:', error);
    return { error: error.message };
  }
}

/**
 * Get CSV template headers for results import
 * @returns {Array} Array of column headers
 */
function getCSVTemplateHeaders() {
  return [
    'athlete_name',
    'school_slug', 
    'gender',
    'time',
    'distance',
    'place'
  ];
}

/**
 * Generate CSV template content
 * @returns {string} CSV template string
 */
function generateCSVTemplate() {
  const headers = getCSVTemplateHeaders();
  const sampleRows = [
    ['John Smith', 'morgantown', 'M', '18:30.45', '5000', '1'],
    ['Jane Doe', 'university-high', 'F', '20:15.20', '5000', '2'],
    ['Mike Johnson', 'bridgeport', 'M', '19:45.10', '5000', '3']
  ];
  
  const csvContent = [
    headers.join(','),
    ...sampleRows.map(row => row.join(','))
  ].join('\n');
  
  return csvContent;
}

// ==========================================
// EXPORT (only for browser)
// ==========================================
window.getAllSchools = getAllSchools;
window.getSchoolBySlug = getSchoolBySlug;
window.getSchoolNameBySlug = getSchoolNameBySlug;
window.getMeetBySlug = getMeetBySlug;
window.getMeets = getAllMeets;
window.getResultsByMeet = getResultsByMeet;
window.getResultsBySchool = getResultsBySchool;
window.getResultsByAthlete = getResultsByAthlete;
window.getAthleteBySlug = getAthleteBySlug;
window.getAthletes = getAthletesBySchool;
window.createMeet = createMeetFromCSV;
window.getCSVTemplateHeaders = getCSVTemplateHeaders;
window.generateCSVTemplate = generateCSVTemplate;
window.parseCSV = parseCSV;
window.bulkInsertResults = bulkInsertResults;
window.parseTimeToSeconds = parseTimeToSeconds;
window.checkDatabaseSchema = checkDatabaseSchema;

