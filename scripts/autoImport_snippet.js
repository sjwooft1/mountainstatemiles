/**
 * autoImport — headless commit for the CC / Track CSV import engine.
 *
 * Paste this block INSIDE the <script> that defines XCMeetImporter, right
 * before the final two lines:
 *
 *     const importer = new XCMeetImporter();
 *     importer.init();
 *
 * It attaches window.autoImport(...) which reuses the importer's OWN parsing,
 * school-slug resolution, race_type/distance detection, athlete dedup/creation,
 * and results write — but with NO preview and NO Commit click. This is what the
 * AppleScript driver calls after it pastes scraped CSV, so results land in the
 * live `results` node while you're out of town.
 *
 * It intentionally mirrors parseData() + executeImport() so behavior stays
 * identical to the manual path. If you change those methods, keep this in sync.
 */
(function attachAutoImport() {
  // Poll until the importer instance has finished init() (meets/schools/athletes loaded).
  function ready() {
    return window.importer &&
      window.importer.meets &&
      window.importer.meets.length >= 0 &&
      Object.keys(window.importer.schoolKeyToSlug || {}).length > 0;
  }

  async function waitReady(maxMs) {
    const start = Date.now();
    while (!ready()) {
      if (Date.now() - start > maxMs) throw new Error('importer not ready (Firebase load timed out)');
      await new Promise(r => setTimeout(r, 150));
    }
  }

  /**
   * @param {string} meetSlug     must match an existing meet slug
   * @param {string} csvText      scraper CSV, columns:
   *                              event_name,place,grade,athlete_name,mark,school,heat,gender
   * @param {object} opts         { defaultDistance=5000, defaultGender='M' }
   * @returns {Promise<object>}   {status, imported, skipped, newAthletes, unmatchedSchools, meetSlug}
   */
  window.autoImport = async function (meetSlug, csvText, opts) {
    opts = opts || {};
    const defaultDistance = parseFloat(opts.defaultDistance) || 5000;
    const defaultGender = (opts.defaultGender || 'M').toUpperCase();

    await waitReady(15000);
    const imp = window.importer;

    if (!meetSlug) return { status: 'error', message: 'missing meetSlug' };
    const meetExists = imp.meets.some(m => m.slug === meetSlug);
    if (!meetExists) {
      return { status: 'error', message: 'meet slug not found: ' + meetSlug };
    }
    if (!csvText || !csvText.trim()) return { status: 'error', message: 'empty CSV' };

    // --- parse rows exactly like parseData(), minus the DOM/UI bits ---
    const rows = [];
    csvText.split('\n').forEach(line => {
      if (line.trim() === '') return;
      const lower = line.toLowerCase();
      if (lower.includes('event_name') && lower.includes('athlete_name')) return; // header

      const p = imp.parseCSVLine(line);
      if (p.length < 5) return;

      const rawEvent = p[0];
      const place = p[1];
      const grade = p[2];
      const athleteName = p[3];
      const mark = p[4];
      const rawSchool = p[5] || 'Unattached';
      const heat = p[6] || '1';
      const csvGender = p[7] || '';
      if (!athleteName) return;

      const parsedEvent = imp.parseEventField(rawEvent, csvGender || defaultGender);
      const gender = parsedEvent.gender || defaultGender;
      const distance = parsedEvent.distance || defaultDistance;
      const schoolMatch = imp.resolveSchoolSlug(rawSchool);
      const timeSeconds = window.parseTimeToSeconds ? window.parseTimeToSeconds(mark) : NaN;

      rows.push({
        race_type: parsedEvent.raceType,
        gender: gender,
        distance: distance,
        place: place,
        grade: grade,
        athlete_name: athleteName,
        time_seconds: timeSeconds,
        school_slug: schoolMatch.slug,
        school_matched: schoolMatch.matched,
        meet_slug: meetSlug,
      });
    });

    const valid = rows.filter(r => r.athlete_name && !isNaN(r.time_seconds) && r.time_seconds > 0);
    const skipped = rows.length - valid.length;
    const unmatchedSchools = valid.filter(r => !r.school_matched).length;

    if (valid.length === 0) {
      return { status: 'error', message: 'no valid rows to import', skipped: skipped };
    }

    // --- commit exactly like executeImport(), minus the UI/progress ---
    const nowIso = new Date().toISOString();
    let newAthletes = 0;
    let imported = 0;

    for (const row of valid) {
      const safeName = (row.athlete_name || 'Unknown').trim().toLowerCase();
      const cacheKey = `${row.school_slug}|${safeName}`;

      let athleteId = imp.athletesCache[cacheKey];
      if (!athleteId) {
        const gradYear = imp.estimateGradYear(row.grade);
        const newAthlete = {
          name: row.athlete_name,
          school_slug: row.school_slug,
          gender: row.gender,
          created_at: nowIso,
          source: 'auto_import',
        };
        if (gradYear) newAthlete.grade = gradYear;
        try {
          const ref = await window.firebaseDatabase.ref(`${CC_PREFIX}/athletes`).push(newAthlete);
          athleteId = ref.key;
          imp.athletesCache[cacheKey] = athleteId;
          newAthletes++;
        } catch (e) {
          console.error('athlete create failed:', e);
        }
      }

      const resultData = {
        athlete_name: row.athlete_name,
        school_slug: row.school_slug,
        gender: row.gender,
        time: row.time_seconds,
        distance: row.distance,
        place: parseInt(row.place) || null,
        race_type: row.race_type,
        meet_slug: row.meet_slug,
        created_at: nowIso,
      };
      try {
        await window.firebaseDatabase.ref(`${CC_PREFIX}/results`).push(resultData);
        imported++;
      } catch (e) {
        console.error('result write failed:', e);
      }
    }

    return {
      status: 'ok',
      meetSlug: meetSlug,
      imported: imported,
      skipped: skipped,
      newAthletes: newAthletes,
      unmatchedSchools: unmatchedSchools,
    };
  };

  console.log('autoImport() attached — call window.autoImport(meetSlug, csvText, {defaultDistance}).');
})();
