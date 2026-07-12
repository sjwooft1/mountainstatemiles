// Firebase Helper Functions for WV Runs
// Using Firebase Realtime Database

// Helper to get database - waits for Firebase to be ready
async function getDB() {
  let attempts = 0;
  while (typeof window.firebaseDatabase === 'undefined' && attempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  if (typeof window.firebaseDatabase === 'undefined') {
    throw new Error('Firebase Database not initialized');
  }
  return window.firebaseDatabase;
}

const CC_PREFIX = 'crosscountry'; // CrossCountry data prefix

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
    const db = await getDB();
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
    const db = await getDB();
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
async function getAllMeets(limit = 1000) {
  try {
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
    const db = await getDB();
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
// SEASON MANAGEMENT
// ==========================================

/**
 * Get the current active season
 * @returns {Promise<Object>} Current season object with year and dates
 */
async function getCurrentSeason() {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/seasons/current`).once('value');
    
    if (!snapshot.exists()) {
      // Default to current calendar year if not set
      return {
        year: new Date().getFullYear(),
        startMonth: 8, // August
        endMonth: 11, // November
        name: `${new Date().getFullYear()} Season`
      };
    }
    
    return snapshot.val();
  } catch (error) {
    console.error('Error fetching current season:', error);
    return null;
  }
}

/**
 * Set the current active season
 * @param {number} year - The season year
 * @param {number} startMonth - Start month (0-11)
 * @param {number} endMonth - End month (0-11)
 * @returns {Promise<boolean>} Success status
 */
async function setCurrentSeason(year, startMonth = 8, endMonth = 11) {
  try {
    const db = await getDB();
    await db.ref(`${CC_PREFIX}/seasons/current`).set({
      year,
      startMonth,
      endMonth,
      name: `${year} Season`,
      setAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error setting current season:', error);
    return false;
  }
}

/**
 * Get all archived seasons
 * @returns {Promise<Array>} Array of season objects
 */
async function getArchivedSeasons() {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/seasons/archived`).once('value');
    const seasons = snapshotToArray(snapshot);
    
    // Sort by year descending
    return seasons.sort((a, b) => b.year - a.year);
  } catch (error) {
    console.error('Error fetching archived seasons:', error);
    return [];
  }
}

/**
 * Archive a season (moves it to past seasons)
 * @param {number} year - The season year to archive
 * @returns {Promise<boolean>} Success status
 */
async function archiveSeason(year) {
  try {
    const db = await getDB();
    const currentSeason = await getCurrentSeason();
    
    if (!currentSeason) return false;
    
    // Save to archived seasons
    const archivedSeasonRef = db.ref(`${CC_PREFIX}/seasons/archived/${year}`);
    await archivedSeasonRef.set({
      ...currentSeason,
      archivedAt: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Error archiving season:', error);
    return false;
  }
}

/**
 * Get data for a specific season
 * @param {number} seasonYear - The season year
 * @returns {Promise<Object>} Object with meets, results, athletes for that season
 */
async function getSeasonData(seasonYear) {
  try {
    const db = await getDB();
    
    // Get all meets for this season
    const meetsSnapshot = await db.ref(`${CC_PREFIX}/meets`).once('value');
    let meets = snapshotToArray(meetsSnapshot);
    
    // Filter meets by season year
    meets = meets.filter(meet => {
      if (!meet.date) return false;
      const meetYear = new Date(meet.date).getFullYear();
      return meetYear === seasonYear;
    });
    
    // Get all results for these meets
    const meetSlugs = meets.map(m => m.slug);
    const resultsSnapshot = await db.ref(`${CC_PREFIX}/results`).once('value');
    let results = snapshotToArray(resultsSnapshot);
    
    results = results.filter(r => meetSlugs.includes(r.meet_slug));
    
    // Get unique athletes from results
    const athleteSlugs = [...new Set(results.map(r => r.athlete_slug).filter(Boolean))];
    const athletesSnapshot = await db.ref(`${CC_PREFIX}/athletes`).once('value');
    let athletes = snapshotToArray(athletesSnapshot);
    
    athletes = athletes.filter(a => athleteSlugs.includes(a.slug));
    
    return {
      year: seasonYear,
      meets: meets.sort((a, b) => new Date(a.date) - new Date(b.date)),
      results,
      athletes,
      totalMeets: meets.length,
      totalResults: results.length,
      totalAthletes: athletes.length
    };
  } catch (error) {
    console.error('Error fetching season data:', error);
    return null;
  }
}

// ==========================================
// ATHLETE GRADUATION MANAGEMENT
// ==========================================

/**
 * Get athlete's current status (active, graduated, or alumni)
 * @param {string} athleteSlug - The athlete's slug
 * @returns {Promise<Object>} Status object with status and details
 */
async function getAthleteStatus(athleteSlug) {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/athletes/${athleteSlug}`).once('value');
    
    if (!snapshot.exists()) {
      return { status: 'not_found', athlete: null };
    }
    
    const athlete = snapshot.val();
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    
    // Academic year starts in August (month 7)
    const academicYear = currentMonth >= 7 ? currentYear + 1 : currentYear;
    const gradYear = parseInt(athlete.grad_year, 10);
    
    if (gradYear < academicYear) {
      return {
        status: 'graduated',
        athlete,
        graduatedYear: gradYear,
        yearsAgo: academicYear - gradYear
      };
    } else if (gradYear === academicYear) {
      return {
        status: 'senior',
        athlete,
        graduatingYear: gradYear,
        daysUntilGraduation: calculateDaysToDate(new Date(gradYear, 5, 1)) // June 1
      };
    } else {
      const yearsUntilGraduation = gradYear - academicYear;
      const grade = ['FR', 'SO', 'JR', 'SR'][yearsUntilGraduation - 1] || 'UNKNOWN';
      return {
        status: 'active',
        athlete,
        grade,
        graduatingYear: gradYear,
        yearsUntilGraduation
      };
    }
  } catch (error) {
    console.error('Error fetching athlete status:', error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Update athlete graduation year (for when they advance a grade)
 * @param {string} athleteSlug - The athlete's slug
 * @param {number} newGradYear - The new graduation year
 * @returns {Promise<boolean>} Success status
 */
async function updateAthleteGradYear(athleteSlug, newGradYear) {
  try {
    const db = await getDB();
    
    // Find the athlete by slug
    const snapshot = await db.ref(`${CC_PREFIX}/athletes`).orderByChild('slug').equalTo(athleteSlug).once('value');
    const athletes = snapshotToArray(snapshot);
    
    if (athletes.length === 0) {
      console.error('Athlete not found:', athleteSlug);
      return false;
    }
    
    const athleteId = athletes[0].id;
    await db.ref(`${CC_PREFIX}/athletes/${athleteId}`).update({
      grad_year: newGradYear,
      updatedAt: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Error updating athlete grad year:', error);
    return false;
  }
}

/**
 * Bulk update all seniors to graduated status
 * Decreases their grad year to past, marking them as alumni
 * @returns {Promise<Object>} Result with count of updated athletes
 */
async function graduateAllSeniors() {
  try {
    const db = await getDB();
    const athletesSnapshot = await db.ref(`${CC_PREFIX}/athletes`).once('value');
    const athletes = snapshotToArray(athletesSnapshot);
    
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const academicYear = currentMonth >= 7 ? currentYear + 1 : currentYear;
    
    // Find all seniors (grad_year === academic year)
    const seniors = athletes.filter(a => {
      const gradYear = parseInt(a.grad_year, 10);
      return gradYear === academicYear;
    });
    
    if (seniors.length === 0) {
      return { success: true, graduatedCount: 0, message: 'No seniors to graduate' };
    }
    
    // Update each senior
    const updates = [];
    seniors.forEach(senior => {
      updates.push(
        db.ref(`${CC_PREFIX}/athletes/${senior.id}`).update({
          grad_year: academicYear - 1, // Set to past year, marking as graduated
          graduatedAt: new Date().toISOString(),
          status: 'graduated'
        })
      );
    });
    
    await Promise.all(updates);
    
    return {
      success: true,
      graduatedCount: seniors.length,
      athletes: seniors.map(s => s.name)
    };
  } catch (error) {
    console.error('Error graduating seniors:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Advance all active athletes one grade level
 * (Run this at the start of each new season)
 * @returns {Promise<Object>} Result with count of advanced athletes
 */
async function advanceAllAthletes() {
  try {
    const db = await getDB();
    const athletesSnapshot = await db.ref(`${CC_PREFIX}/athletes`).once('value');
    const athletes = snapshotToArray(athletesSnapshot);
    
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const academicYear = currentMonth >= 7 ? currentYear + 1 : currentYear;
    
    // Find all non-graduated athletes
    const activeAthletes = athletes.filter(a => {
      const gradYear = parseInt(a.grad_year, 10);
      return gradYear >= academicYear;
    });
    
    if (activeAthletes.length === 0) {
      return { success: true, advancedCount: 0, message: 'No active athletes to advance' };
    }
    
    // Advance each athlete by 1 year (they graduate 1 year earlier)
    const updates = [];
    activeAthletes.forEach(athlete => {
      const currentGradYear = parseInt(athlete.grad_year, 10);
      updates.push(
        db.ref(`${CC_PREFIX}/athletes/${athlete.id}`).update({
          grad_year: currentGradYear - 1,
          advancedAt: new Date().toISOString()
        })
      );
    });
    
    await Promise.all(updates);
    
    return {
      success: true,
      advancedCount: activeAthletes.length,
      athletes: activeAthletes.map(a => a.name)
    };
  } catch (error) {
    console.error('Error advancing athletes:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// HELPER FUNCTIONS FOR SEASON MANAGEMENT
// ==========================================

/**
 * Calculate days until a specific date
 * @param {Date} targetDate - The target date
 * @returns {number} Days until the date
 */
function calculateDaysToDate(targetDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);
  
  const differenceInTime = targetDate - today;
  const differenceInDays = Math.ceil(differenceInTime / (1000 * 3600 * 24));
  
  return differenceInDays;
}

/**
 * Get season summary for display
 * @returns {Promise<Object>} Season summary with key dates and athlete counts
 */
async function getSeasonSummary() {
  try {
    const currentSeason = await getCurrentSeason();
    const athletesSnapshot = await db.ref(`${CC_PREFIX}/athletes`).once('value');
    const athletes = snapshotToArray(athletesSnapshot);
    
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const academicYear = currentMonth >= 7 ? currentYear + 1 : currentYear;
    
    const seniors = athletes.filter(a => parseInt(a.grad_year, 10) === academicYear).length;
    const juniors = athletes.filter(a => parseInt(a.grad_year, 10) === academicYear + 1).length;
    const sophomores = athletes.filter(a => parseInt(a.grad_year, 10) === academicYear + 2).length;
    const freshmen = athletes.filter(a => parseInt(a.grad_year, 10) === academicYear + 3).length;
    
    return {
      currentSeason: currentSeason.year,
      totalAthletes: athletes.length,
      seniors,
      juniors,
      sophomores,
      freshmen,
      byClass: {
        'Senior': seniors,
        'Junior': juniors,
        'Sophomore': sophomores,
        'Freshman': freshmen
      }
    };
  } catch (error) {
    console.error('Error getting season summary:', error);
    return null;
  }
}

// ==========================================
// EMAIL MANAGEMENT & SENDING
// ==========================================

/**
 * Create a new email list for recipients
 * @param {string} name - List name
 * @param {Array<string>} emails - Array of email addresses
 * @returns {Promise<Object>} Created list with ID
 */
async function createEmailList(name, emails = []) {
  try {
    const db = await getDB();
    const listRef = db.ref(`${CC_PREFIX}/email-lists`).push();
    
    await listRef.set({
      name,
      emails: emails,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recipientCount: emails.length
    });

    return { id: listRef.key, name, emails };
  } catch (error) {
    console.error('Error creating email list:', error);
    return { error: error.message };
  }
}

/**
 * Get all email lists
 * @returns {Promise<Array>} Array of email lists
 */
async function getEmailLists() {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/email-lists`).once('value');
    const lists = snapshotToArray(snapshot);
    return lists;
  } catch (error) {
    console.error('Error fetching email lists:', error);
    return [];
  }
}

/**
 * Update an email list
 * @param {string} listId - List ID
 * @param {Array<string>} emails - New email array
 * @returns {Promise<boolean>} Success status
 */
async function updateEmailList(listId, emails) {
  try {
    const db = await getDB();
    await db.ref(`${CC_PREFIX}/email-lists/${listId}`).update({
      emails: emails,
      recipientCount: emails.length,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error updating email list:', error);
    return false;
  }
}

/**
 * Delete an email list
 * @param {string} listId - List ID
 * @returns {Promise<boolean>} Success status
 */
async function deleteEmailList(listId) {
  try {
    const db = await getDB();
    await db.ref(`${CC_PREFIX}/email-lists/${listId}`).remove();
    return true;
  } catch (error) {
    console.error('Error deleting email list:', error);
    return false;
  }
}

/**
 * Add email to list
 * @param {string} listId - List ID
 * @param {string} email - Email address to add
 * @returns {Promise<boolean>} Success status
 */
async function addEmailToList(listId, email) {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/email-lists/${listId}`).once('value');
    const list = snapshot.val();
    
    if (!list) return false;

    const emails = list.emails || [];
    if (!emails.includes(email)) {
      emails.push(email);
      await db.ref(`${CC_PREFIX}/email-lists/${listId}`).update({
        emails: emails,
        recipientCount: emails.length,
        updatedAt: new Date().toISOString()
      });
    }
    return true;
  } catch (error) {
    console.error('Error adding email:', error);
    return false;
  }
}

/**
 * Remove email from list
 * @param {string} listId - List ID
 * @param {string} email - Email address to remove
 * @returns {Promise<boolean>} Success status
 */
async function removeEmailFromList(listId, email) {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/email-lists/${listId}`).once('value');
    const list = snapshot.val();
    
    if (!list) return false;

    const emails = (list.emails || []).filter(e => e !== email);
    await db.ref(`${CC_PREFIX}/email-lists/${listId}`).update({
      emails: emails,
      recipientCount: emails.length,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error removing email:', error);
    return false;
  }
}

/**
 * Schedule an email to be sent
 * @param {Object} emailConfig - Email configuration object
 * @returns {Promise<Object>} Scheduled email record
 */
async function scheduleEmail(emailConfig) {
  try {
    const db = await getDB();
    const emailRef = db.ref(`${CC_PREFIX}/scheduled-emails`).push();

    const emailRecord = {
      ...emailConfig,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      scheduledFor: emailConfig.scheduledFor || new Date().toISOString(),
      sentAt: null,
      deliveryStatus: {
        total: emailConfig.recipients.length,
        sent: 0,
        failed: 0,
        bounced: 0
      }
    };

    await emailRef.set(emailRecord);
    return { id: emailRef.key, ...emailRecord };
  } catch (error) {
    console.error('Error scheduling email:', error);
    return { error: error.message };
  }
}

/**
 * Send email immediately (queues for processing)
 * @param {Object} emailConfig - Email configuration with subject, htmlContent, recipients
 * @returns {Promise<Object>} Result with email ID and status
 */
async function sendEmailNow(emailConfig) {
  try {
    const db = await getDB();
    const emailRef = db.ref(`${CC_PREFIX}/scheduled-emails`).push();

    const emailRecord = {
      subject: emailConfig.subject,
      htmlContent: emailConfig.htmlContent,
      recipients: emailConfig.recipients,
      status: 'scheduled',
      method: 'immediate',
      createdAt: new Date().toISOString(),
      scheduledFor: new Date().toISOString(),
      sentAt: null,
      deliveryStatus: {
        total: emailConfig.recipients.length,
        sent: 0,
        failed: 0,
        bounced: 0
      }
    };

    await emailRef.set(emailRecord);
    
    return { 
      success: true,
      emailId: emailRef.key, 
      message: `Email queued for ${emailRecord.recipients.length} recipients`
    };
  } catch (error) {
    console.error('Error sending email:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Send test email
 * @param {Object} emailConfig - Email configuration with subject, htmlContent, testEmail
 * @returns {Promise<Object>} Result with status
 */
async function sendTestEmail(emailConfig) {
  try {
    const db = await getDB();
    const emailRef = db.ref(`${CC_PREFIX}/scheduled-emails`).push();

    const emailRecord = {
      subject: `[TEST] ${emailConfig.subject}`,
      htmlContent: emailConfig.htmlContent,
      recipients: [emailConfig.testEmail],
      status: 'scheduled',
      method: 'test',
      createdAt: new Date().toISOString(),
      scheduledFor: new Date().toISOString(),
      sentAt: null,
      isTestEmail: true,
      deliveryStatus: {
        total: 1,
        sent: 0,
        failed: 0,
        bounced: 0
      }
    };

    await emailRef.set(emailRecord);
    
    return { 
      success: true,
      emailId: emailRef.key, 
      message: `Test email queued for ${emailConfig.testEmail}`
    };
  } catch (error) {
    console.error('Error sending test email:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Get scheduled emails
 * @param {string} status - Filter by status: 'scheduled', 'sent', 'failed'
 * @returns {Promise<Array>} Array of scheduled emails
 */
async function getScheduledEmails(status = null) {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/scheduled-emails`).once('value');
    let emails = snapshotToArray(snapshot);

    if (status) {
      emails = emails.filter(e => e.status === status);
    }

    return emails.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.error('Error fetching scheduled emails:', error);
    return [];
  }
}

/**
 * Update email delivery status
 * @param {string} emailId - Email ID
 * @param {string} status - New status
 * @param {Object} deliveryStatus - Delivery status update
 * @returns {Promise<boolean>} Success status
 */
async function updateEmailStatus(emailId, status, deliveryStatus = null) {
  try {
    const db = await getDB();
    const updates = { status };

    if (status === 'sent') {
      updates.sentAt = new Date().toISOString();
    }

    if (deliveryStatus) {
      updates.deliveryStatus = deliveryStatus;
    }

    await db.ref(`${CC_PREFIX}/scheduled-emails/${emailId}`).update(updates);
    return true;
  } catch (error) {
    console.error('Error updating email status:', error);
    return false;
  }
}

/**
 * Get email templates
 * @returns {Promise<Array>} Array of email templates
 */
async function getEmailTemplates() {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/email-templates`).once('value');
    return snapshotToArray(snapshot);
  } catch (error) {
    console.error('Error fetching email templates:', error);
    return [];
  }
}

/**
 * Save email as template
 * @param {string} name - Template name
 * @param {Object} emailConfig - Email configuration
 * @returns {Promise<Object>} Saved template
 */
async function saveEmailTemplate(name, emailConfig) {
  try {
    const db = await getDB();
    const templateRef = db.ref(`${CC_PREFIX}/email-templates`).push();

    const template = {
      name,
      ...emailConfig,
      createdAt: new Date().toISOString(),
      usageCount: 0
    };

    await templateRef.set(template);
    return { id: templateRef.key, ...template };
  } catch (error) {
    console.error('Error saving template:', error);
    return { error: error.message };
  }
}

/**
 * Delete email template
 * @param {string} templateId - Template ID
 * @returns {Promise<boolean>} Success status
 */
async function deleteEmailTemplate(templateId) {
  try {
    const db = await getDB();
    await db.ref(`${CC_PREFIX}/email-templates/${templateId}`).remove();
    return true;
  } catch (error) {
    console.error('Error deleting template:', error);
    return false;
  }
}

/**
 * Get email analytics/history
 * @returns {Promise<Object>} Email statistics
 */
async function getEmailAnalytics() {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/scheduled-emails`).once('value');
    const emails = snapshotToArray(snapshot);

    const stats = {
      totalEmails: emails.length,
      sent: emails.filter(e => e.status === 'sent').length,
      scheduled: emails.filter(e => e.status === 'scheduled').length,
      failed: emails.filter(e => e.status === 'failed').length,
      totalRecipients: emails.reduce((sum, e) => sum + (e.deliveryStatus?.total || 0), 0),
      totalSent: emails.reduce((sum, e) => sum + (e.deliveryStatus?.sent || 0), 0),
      totalFailed: emails.reduce((sum, e) => sum + (e.deliveryStatus?.failed || 0), 0),
      recentEmails: emails.slice(0, 10)
    };

    return stats;
  } catch (error) {
    console.error('Error fetching email analytics:', error);
    return null;
  }
}

/**
 * Generate email from template with current data
 * @param {string} templateId - Template ID
 * @returns {Promise<Object>} Generated email HTML and data
 */
async function generateEmailFromTemplate(templateId) {
  try {
    const db = await getDB();
    const snapshot = await db.ref(`${CC_PREFIX}/email-templates/${templateId}`).once('value');
    
    if (!snapshot.exists()) return null;

    const template = snapshot.val();

    // Update usage count
    await db.ref(`${CC_PREFIX}/email-templates/${templateId}`).update({
      usageCount: (template.usageCount || 0) + 1,
      lastUsed: new Date().toISOString()
    });

    return template;
  } catch (error) {
    console.error('Error generating from template:', error);
    return null;
  }
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
window.getCurrentSeason = getCurrentSeason;
window.setCurrentSeason = setCurrentSeason;
window.getArchivedSeasons = getArchivedSeasons;
window.archiveSeason = archiveSeason;
window.getSeasonData = getSeasonData;
window.getAthleteStatus = getAthleteStatus;
window.updateAthleteGradYear = updateAthleteGradYear;
window.graduateAllSeniors = graduateAllSeniors;
window.advanceAllAthletes = advanceAllAthletes;
window.getSeasonSummary = getSeasonSummary;
window.createEmailList = createEmailList;
window.getEmailLists = getEmailLists;
window.updateEmailList = updateEmailList;
window.deleteEmailList = deleteEmailList;
window.addEmailToList = addEmailToList;
window.removeEmailFromList = removeEmailFromList;
window.scheduleEmail = scheduleEmail;
window.sendEmailNow = sendEmailNow;
window.sendTestEmail = sendTestEmail;
window.getScheduledEmails = getScheduledEmails;
window.updateEmailStatus = updateEmailStatus;
window.getEmailTemplates = getEmailTemplates;
window.saveEmailTemplate = saveEmailTemplate;
window.deleteEmailTemplate = deleteEmailTemplate;
window.getEmailAnalytics = getEmailAnalytics;
window.generateEmailFromTemplate = generateEmailFromTemplate;
