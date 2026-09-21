/*!
 * Mountain State Miles — Cross Country course manifest
 * ----------------------------------------------------
 * Offline/fallback course list. The viewer merges this with the live records
 * in Firebase (crosscountry/courses), which remain authoritative: a course in
 * the database keeps its own name, slug, GPX, video, and surfaces, and the
 * matching entry here is skipped. This file exists so the page still works if
 * the database is unreachable.
 *
 * Slugs and names therefore mirror the database exactly — if they drift, the
 * viewer falls back to matching by GPX filename so a course can never appear
 * twice.
 *
 * Deliberately NOT included: distance, elevation gain, difficulty, or climb
 * count. Those are measured from the GPX by course-engine.js, so they can never
 * drift out of sync with the actual track.
 *
 * Fields:
 *   slug      stable id used by meets/results (course_slug)
 *   name      display name
 *   gpx       path to the track file, relative to this folder ('' if none yet)
 *   video     optional fly-through video
 *   location  optional venue text
 *   surfaces  optional [{ type, pct }] footing breakdown
 *   notes     optional hand-written course notes (shown alongside auto analysis)
 */
(function (global) {
  'use strict';

  var COURSES = [
    {
      slug: 'cabell',
      name: 'Cabell Midland',
      gpx: 'Cabell Midland.gpx',
      video: 'assets/Cabell Midland.mp4',
      surfaces: [
        { type: 'Grass', pct: 86 },
        { type: 'Track', pct: 4 },
        { type: 'Gravel', pct: 10 }
      ],
      notes: 'Multi-loop championship layout known for "The Rollercoaster" hill complex. Firm turf footing that translates to fast times in good weather.'
    },
    {
      slug: 'chick-fil-a',
      name: 'Chick-fil-A 5K',
      gpx: 'Chick-fil-a.gpx',
      video: 'assets/Chick-Fil-A.mp4',
      surfaces: [
        { type: 'Grass', pct: 90 },
        { type: 'Dirt Trail', pct: 10 }
      ],
      notes: 'Rolling middle third, mostly wide natural-grass lanes with brief transitions across wood-chip segments.'
    },
    {
      slug: 'fairfield-union-high-school',
      name: 'Fairfield Union High School',
      gpx: 'fairfeild.gpx',
      surfaces: [],
      notes: ''
    },
    {
      slug: 'frankfort-5k',
      name: 'Frankfort 5k',
      gpx: 'frankfort.gpx',
      video: 'assets/frankfort.mp4',
      surfaces: [],
      notes: ''
    },
    {
      slug: 'glen-oak',
      name: 'Glen Oak',
      gpx: 'Glen Oak.gpx',
      video: 'assets/Glen Oak.mp4',
      surfaces: [
        { type: 'Grass', pct: 85 },
        { type: 'Track', pct: 10 },
        { type: 'Gravel', pct: 5 }
      ],
      notes: ''
    },
    {
      slug: 'holmdel-park',
      name: 'Holmdel Park',
      gpx: 'Holmdel Park.gpx',
      video: 'assets/Holmdel Park.mp4',
      surfaces: [
        { type: 'Dirt Trail', pct: 60 },
        { type: 'Grass', pct: 40 }
      ],
      notes: 'The classic bowl-and-ridge layout: steep, patient climbs that punish going out too hard, with fast descents that reward runners willing to open up.'
    },
    {
      slug: 'kennedy-center',
      name: 'YMCA Kennedy Center',
      gpx: 'ymca.gpx',
      surfaces: [],
      notes: ''
    },
    {
      slug: 'knight-night-relays',
      name: 'Knight Night Relays',
      gpx: 'knight-night.gpx',
      surfaces: [],
      notes: 'Relay-format venue. This track file has no elevation data, so climb and grade analysis is unavailable until an elevation-enabled GPX is uploaded.'
    },
    {
      slug: 'meadowood-park',
      name: 'Meadowood Park',
      gpx: 'Meadowood Park.gpx',
      video: 'assets/Meadowood Park.mp4',
      surfaces: [
        { type: 'Grass', pct: 95 },
        { type: 'Gravel', pct: 5 }
      ],
      notes: 'A scenic rolling route wrapped around wide athletic fields and park lines. Great for spectators, with long flat expanses that reward rhythm and drafting.'
    },
    {
      slug: 'pipestem-state-park',
      name: 'Pipestem State Park',
      gpx: 'Pipestem.gpx',
      video: 'assets/Pipestem.mp4',
      surfaces: [
        { type: 'Grass', pct: 75 },
        { type: 'Dirt Trail', pct: 20 },
        { type: 'Gravel', pct: 5 }
      ],
      notes: 'Heavily wooded with dense canopy sections and real climbing. Ground is organic and changes dramatically with rain, so footing is the biggest variable here.'
    },
    {
      slug: 'preston-high',
      name: 'Preston High',
      gpx: '',
      surfaces: [],
      notes: 'No track file has been uploaded for this course yet, so it cannot be measured. Add a GPX in the course admin to unlock the full profile.'
    },
    {
      slug: 'riverside-5k',
      name: 'Riverside 5k',
      gpx: 'Cornfield-Crawl.gpx',
      video: 'assets/riverside.mp4',
      surfaces: [],
      notes: ''
    },
    {
      slug: 'south-harrison',
      name: 'South Harrison',
      gpx: 'South Harrison.gpx',
      video: 'assets/South Harrison.mp4',
      surfaces: [
        { type: 'Grass', pct: 75 },
        { type: 'Dirt Trail', pct: 20 },
        { type: 'Gravel', pct: 5 }
      ],
      notes: ''
    },
    {
      slug: 'st-marys-5k',
      name: "St. Mary's 5k",
      gpx: 'st-marys.gpx',
      video: 'assets/st-marys.mp4',
      surfaces: [],
      notes: ''
    },
    {
      slug: 'university-5k',
      name: 'University 5k',
      gpx: 'University.gpx',
      surfaces: [],
      notes: 'This track file has no elevation data, so climb and grade analysis is unavailable until an elevation-enabled GPX is uploaded.'
    }
  ];

  global.XC_COURSE_MANIFEST = COURSES;
  if (typeof module !== 'undefined' && module.exports) module.exports = COURSES;
})(typeof window !== 'undefined' ? window : globalThis);
