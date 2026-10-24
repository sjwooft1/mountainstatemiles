/**
 * Mountain State Miles — Regional Qualification Engine (/assets/regional-qualifiers.js)
 * ---------------------------------------------------------------------------------
 * A meet record can carry admin-set qualification rules:
 *
 *   meet.qualification = {
 *     enabled: true,
 *     target_slug: "state-meet",          // meet the qualifiers advance to
 *     target_name: "WV State Championship",
 *     team_spots: 3,                      // teams advancing per race
 *     team_members: 7,                    // runners per advancing team
 *     individual_spots: 5,                // next individuals per race
 *     wildcard_spots: 0,                  // extra at-large individuals per race
 *     race_scope: "varsity",              // "varsity" | "all"
 *     note: ""
 *   }
 *
 * The same module powers the admin preview (CrossCountry/admin.html) and the
 * public "Road to States" graphics on CrossCountry/meet.html, so the numbers an
 * admin previews are the numbers the meet page publishes.
 *
 * Public API (window.MSMQualifiers):
 *   RAW_DEFAULTS        default rule values in database shape
 *   rulesFromMeet(meet) normalized rules, or null when the meet has none
 *   computeQualifiers({ results, rules, computeTeams })
 *   render(mount, { meet, rules, data, targetMeet, results, computeTeams, linkTarget })
 */
(function (global) {
  "use strict";

  const STYLE_ID = "msq-styles";

  const RAW_DEFAULTS = {
    team_spots: 3,
    team_members: 7,
    individual_spots: 5,
    wildcard_spots: 0,
    race_scope: "varsity",
  };

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clampInt(value, fallback, min, max) {
    const n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function plural(count, one, many) {
    return count === 1 ? one : many || one + "s";
  }

  function slugify(name) {
    return String(name || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  // Matches meet.html's normalizeSchoolName() so a school's row and its team
  // score are always recognised as the same team.
  function normalizeSchool(name) {
    if (!name) return "Unknown";
    let normalized = String(name).toLowerCase().trim();
    normalized = normalized
      .replace(/\s+(high\s+)?school\s*$/i, "")
      .replace(/\s+hs\s*$/i, "")
      .trim();
    return normalized
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  // Imported results only carry `school_slug` for some meets. meet.html resolves
  // names from the schools table before calling in, but the admin preview sees
  // raw rows, so every school lookup has to accept the slug as a last resort.
  function schoolNameOf(runner) {
    const named = runner && (runner.school_name || runner.school);
    if (named) return named;
    const slug = runner && runner.school_slug;
    if (!slug) return "Unknown";
    return normalizeSchool(String(slug).replace(/-/g, " "));
  }

  function timeText(seconds) {
    const total = Number(seconds);
    if (!isFinite(total) || total <= 0) return "";
    const mins = Math.floor(total / 60);
    const secs = total - mins * 60;
    return `${mins}:${secs.toFixed(2).padStart(5, "0")}`;
  }

  function formatMeetDate(dateStr) {
    if (!dateStr) return "";
    const parts = String(dateStr).split("T")[0].split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
    return "";
  }

  function genderOf(runner) {
    if (runner && runner.normalizedGender) return runner.normalizedGender;
    const g = String((runner && runner.gender) || "").trim().toUpperCase();
    if (["F", "GIRLS", "GIRL", "FEMALE", "G", "W", "WOMEN"].includes(g)) return "F";
    if (["M", "BOYS", "BOY", "MALE", "B", "MEN"].includes(g)) return "M";
    const text = String(
      (runner && (runner.race_type || runner.division || runner.event || runner.event_name)) || ""
    ).toLowerCase();
    if (text.includes("girl") || text.includes("women") || text.includes("female")) return "F";
    return "M";
  }

  function raceOf(runner) {
    if (runner && runner.normalizedRaceType) return runner.normalizedRaceType;
    const raw = String(
      (runner && (runner.race_type || runner.division || runner.event || runner.event_name)) || "Varsity 5K"
    ).trim();
    return raw || "Varsity 5K";
  }

  // "Varsity only" means every race except the ones meets explicitly run for
  // development: JV, open, freshman and middle school races. Race labels are
  // inconsistent across imports ("Class AAA", "Boys Varsity 5K", "AAA Region 1"),
  // so excluding the known non-varsity names is safer than matching a whitelist.
  function isVarsityRace(race) {
    const text = String(race || "").toLowerCase();
    return !/\bjv\b|junior varsity|freshman|freshmen|middle school|elementary|\bopen\b|6th|7th|8th|\bms\b/.test(text);
  }

  function varsityWeight(race) {
    return isVarsityRace(race) ? 0 : 1;
  }

  function byFinish(a, b) {
    const placeA = parseInt(a && a.place, 10);
    const placeB = parseInt(b && b.place, 10);
    if (!isNaN(placeA) && !isNaN(placeB) && placeA !== placeB) return placeA - placeB;
    if (!isNaN(placeA) && isNaN(placeB)) return -1;
    if (isNaN(placeA) && !isNaN(placeB)) return 1;
    return (parseFloat(a && a.time) || 99999) - (parseFloat(b && b.time) || 99999);
  }

  // ------------------------------------------------------------------
  // Rules
  // ------------------------------------------------------------------
  function rulesFromMeet(meet) {
    const raw = meet && meet.qualification;
    if (!raw || typeof raw !== "object") return null;
    const enabled = raw.enabled === true || raw.enabled === "true" || raw.enabled === 1;
    if (!enabled) return null;
    return {
      enabled: true,
      targetSlug: String(raw.target_slug || "").trim(),
      targetName: String(raw.target_name || "").trim(),
      teamSpots: clampInt(raw.team_spots, RAW_DEFAULTS.team_spots, 0, 25),
      teamMembers: clampInt(raw.team_members, RAW_DEFAULTS.team_members, 1, 12),
      individualSpots: clampInt(raw.individual_spots, RAW_DEFAULTS.individual_spots, 0, 60),
      wildcardSpots: clampInt(raw.wildcard_spots, RAW_DEFAULTS.wildcard_spots, 0, 60),
      raceScope: raw.race_scope === "all" ? "all" : "varsity",
      note: String(raw.note || "").trim(),
    };
  }

  // ------------------------------------------------------------------
  // Team scoring fallback
  // ------------------------------------------------------------------
  // Displacement scoring, mirroring meet.html's calculateTeamScores(): a team
  // needs five finishers to post a score; non-scorers still consume a place.
  // Callers that already have standings (meet.html does) pass computeTeams and
  // this is never used.
  function defaultTeamScores(rows) {
    const byTeam = new Map();
    (rows || []).forEach((runner) => {
      const school = normalizeSchool(schoolNameOf(runner));
      if (!byTeam.has(school)) byTeam.set(school, []);
      byTeam.get(school).push(runner);
    });

    const scoringTeams = new Set(
      Array.from(byTeam.entries())
        .filter(([, athletes]) => athletes.length >= 5)
        .map(([school]) => school)
    );

    let counter = 0;
    const placeByRunner = new Map();
    (rows || []).slice().sort(byFinish).forEach((runner) => {
      const school = normalizeSchool(schoolNameOf(runner));
      if (scoringTeams.has(school)) placeByRunner.set(runner, ++counter);
      else placeByRunner.set(runner, null);
    });

    const scores = [];
    byTeam.forEach((athletes, school) => {
      if (!scoringTeams.has(school)) return;
      const sorted = athletes.slice().sort((a, b) => (placeByRunner.get(a) || 9999) - (placeByRunner.get(b) || 9999));
      const topFive = sorted.slice(0, 5);
      const score = topFive.reduce((sum, runner) => sum + (placeByRunner.get(runner) || 9999), 0);
      scores.push({
        school,
        score,
        athletes: topFive,
        sixthPlace: sorted[5] ? placeByRunner.get(sorted[5]) || 9999 : 9999,
        seventhPlace: sorted[6] ? placeByRunner.get(sorted[6]) || 9999 : 9999,
      });
    });

    return scores.sort(
      (a, b) => a.score - b.score || a.sixthPlace - b.sixthPlace || a.seventhPlace - b.seventhPlace
    );
  }

  // ------------------------------------------------------------------
  // Runner entries
  // ------------------------------------------------------------------
  function runnerEntry(runner) {
    const name = runner.athlete_name || runner.name || "Runner";
    const school = schoolNameOf(runner);
    return {
      key: normalizeSchool(school).toLowerCase() + "|" + String(name).trim().toLowerCase(),
      name,
      school,
      schoolSlug: runner.school_slug || slugify(normalizeSchool(school)),
      place: runner.place != null && runner.place !== "" ? runner.place : null,
      timeText: timeText(runner.time),
      grade: runner.grad_year || runner.gradYear || runner.grade || "",
      raw: runner,
    };
  }

  // ------------------------------------------------------------------
  // Qualifier computation
  // ------------------------------------------------------------------
  function computeQualifiers(options) {
    const opts = options || {};
    const rules = opts.rules;
    const computeTeams = typeof opts.computeTeams === "function" ? opts.computeTeams : null;
    const results = Array.isArray(opts.results) ? opts.results.filter(Boolean) : [];
    if (!rules) return { races: [], totals: { athletes: 0, teams: 0, races: 0 }, rules: null };

    const scopeAll = rules.raceScope === "all";
    const groups = new Map();
    results.forEach((runner) => {
      const race = raceOf(runner);
      if (!scopeAll && !isVarsityRace(race)) return;
      const gender = genderOf(runner);
      const key = gender + "|" + race;
      if (!groups.has(key)) groups.set(key, { gender, race, rows: [] });
      groups.get(key).rows.push(runner);
    });

    const races = Array.from(groups.values())
      .map((group) => scoreRace(group, rules, computeTeams))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.gender !== b.gender) return a.gender === "M" ? -1 : 1;
        return varsityWeight(a.race) - varsityWeight(b.race) || a.race.localeCompare(b.race);
      });

    const athleteKeys = new Set();
    let teamCount = 0;
    races.forEach((race) => {
      teamCount += race.teams.length;
      race.teams.forEach((team) => team.athletes.forEach((athlete) => athleteKeys.add(athlete.key)));
      race.individuals.forEach((athlete) => athleteKeys.add(athlete.key));
      race.wildcards.forEach((athlete) => athleteKeys.add(athlete.key));
    });

    return {
      races,
      totals: { athletes: athleteKeys.size, teams: teamCount, races: races.length },
      rules,
    };
  }

  function scoreRace(group, rules, computeTeams) {
    const sorted = group.rows.slice().sort(byFinish);
    if (!sorted.length) return null;

    const standings = (computeTeams ? computeTeams(group.rows) : defaultTeamScores(group.rows)) || [];
    const teamSpots = Math.max(0, rules.teamSpots || 0);
    const teamMembers = Math.max(1, rules.teamMembers || 7);

    const teams = standings
      .slice(0, teamSpots)
      .map((team, index) => {
        const school = String(team.school || "Unknown");
        const roster = sorted
          .filter((runner) => normalizeSchool(schoolNameOf(runner)) === school)
          .slice(0, teamMembers)
          .map(runnerEntry);
        return {
          rank: index + 1,
          school,
          score: team.score,
          isRelay: !!team.isRelay,
          athletes: roster,
        };
      })
      .filter((team) => team.athletes.length > 0);

    const claimed = new Set();
    teams.forEach((team) => team.athletes.forEach((athlete) => claimed.add(athlete.key)));

    const pool = sorted
      .map(runnerEntry)
      .filter((athlete) => !claimed.has(athlete.key));

    const individualSpots = Math.max(0, rules.individualSpots || 0);
    const wildcardSpots = Math.max(0, rules.wildcardSpots || 0);

    const individuals = pool.slice(0, individualSpots);
    const wildcards = pool.slice(individualSpots, individualSpots + wildcardSpots);
    const bubble = pool.slice(individualSpots + wildcardSpots, individualSpots + wildcardSpots + 3);

    const nextTeam = teamSpots > 0 && standings[teamSpots]
      ? {
          rank: teamSpots + 1,
          school: standings[teamSpots].school,
          score: standings[teamSpots].score,
          isRelay: !!standings[teamSpots].isRelay,
        }
      : null;

    return {
      gender: group.gender,
      race: group.race,
      fieldSize: sorted.length,
      teamCount: standings.length,
      teams,
      individuals,
      wildcards,
      bubble,
      nextTeam,
      advanceCount:
        teams.reduce((sum, team) => sum + team.athletes.length, 0) + individuals.length + wildcards.length,
    };
  }

  // ------------------------------------------------------------------
  // Styles (injected once — shared by meet.html and the admin preview)
  // ------------------------------------------------------------------
  const CSS = `
    .msq-section {
      --msq-pine: #234a3b;
      --msq-pine-deep: #1b3a2d;
      --msq-gold: #e0a63f;
      --msq-gold-bright: #f5c96a;
      margin: 0 0 24px;
      border: 1px solid var(--border, #e6dcc8);
      border-radius: 18px;
      background: var(--bg-primary, #fffdf8);
      box-shadow: 0 12px 34px var(--shadow-light, rgba(63,55,40,.08));
      overflow: hidden;
    }
    .msq-hero {
      position: relative;
      display: flex;
      gap: 18px;
      align-items: center;
      justify-content: space-between;
      padding: 26px 24px;
      color: #f6efe1;
      overflow: hidden;
      background:
        radial-gradient(120% 150% at 88% -20%, rgba(224,166,63,.38), transparent 55%),
        radial-gradient(90% 130% at -5% 115%, rgba(109,184,148,.30), transparent 60%),
        linear-gradient(135deg, #1f4032 0%, #2c5a47 58%, #193528 100%);
    }
    .msq-hero::after {
      content: '';
      position: absolute;
      inset: -20% -40%;
      background: linear-gradient(100deg, transparent 42%, rgba(255,255,255,.16) 50%, transparent 58%);
      transform: translateX(-70%);
      animation: msq-sheen 8s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes msq-sheen {
      0%, 55% { transform: translateX(-70%); }
      85%, 100% { transform: translateX(70%); }
    }
    .msq-hero-main { position: relative; z-index: 1; min-width: 0; }
    .msq-kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: .68rem;
      font-weight: 800;
      letter-spacing: .18em;
      text-transform: uppercase;
      color: var(--msq-gold-bright);
    }
    .msq-kicker::before {
      content: '';
      width: 24px;
      height: 2px;
      border-radius: 2px;
      background: currentColor;
    }
    .msq-title {
      margin: 8px 0 8px;
      font-size: clamp(1.45rem, 4vw, 2.1rem);
      font-weight: 800;
      line-height: 1.08;
      letter-spacing: -.015em;
    }
    .msq-title em { font-style: normal; color: var(--msq-gold-bright); }
    .msq-sub {
      margin: 0;
      max-width: 54ch;
      font-size: .9rem;
      line-height: 1.5;
      color: rgba(246,239,225,.88);
    }
    .msq-sub b { color: #fff; font-weight: 800; }
    .msq-target {
      color: var(--msq-gold-bright);
      font-weight: 800;
      text-decoration: none;
      border-bottom: 1px solid rgba(245,201,106,.45);
    }
    .msq-target:hover { border-bottom-color: var(--msq-gold-bright); }
    .msq-hero-stats { display: flex; gap: 26px; flex-wrap: wrap; margin-top: 18px; }
    .msq-hero-stats div { display: flex; flex-direction: column; }
    .msq-hero-stats strong {
      font-size: 1.55rem;
      font-weight: 800;
      letter-spacing: -.02em;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .msq-hero-stats span {
      font-size: .62rem;
      font-weight: 700;
      letter-spacing: .13em;
      text-transform: uppercase;
      color: rgba(246,239,225,.74);
    }
    .msq-trophy {
      position: relative;
      z-index: 1;
      flex: 0 0 auto;
      width: 82px;
      height: 82px;
      display: grid;
      place-items: center;
      font-size: 2.1rem;
      border-radius: 50%;
      border: 1px solid rgba(245,201,106,.45);
      background: radial-gradient(circle at 32% 26%, rgba(245,201,106,.38), rgba(245,201,106,.06));
      box-shadow: 0 0 28px rgba(224,166,63,.28), inset 0 0 20px rgba(224,166,63,.16);
    }
    .msq-races { display: grid; gap: 14px; padding: 18px; }
    .msq-race {
      border: 1px solid var(--border, #e6dcc8);
      border-radius: 14px;
      background: var(--bg-primary, #fffdf8);
      overflow: hidden;
      animation: msq-rise .5s cubic-bezier(.2,.7,.3,1) both;
      animation-delay: calc(var(--msq-i, 0) * 70ms);
    }
    @keyframes msq-rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: none; }
    }
    .msq-race-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding: 13px 16px;
      border-bottom: 1px solid var(--border, #e6dcc8);
      background: linear-gradient(90deg, rgba(63,125,99,.10), transparent 70%);
    }
    .msq-race-head h3 {
      margin: 0;
      font-size: .98rem;
      font-weight: 800;
      color: var(--text-primary, #2f2a24);
    }
    .msq-race-head p { margin: 2px 0 0; font-size: .72rem; color: var(--text-secondary, #6b6154); }
    .msq-pill {
      flex: 0 0 auto;
      padding: 5px 11px;
      border-radius: 999px;
      font-size: .68rem;
      font-weight: 800;
      letter-spacing: .07em;
      text-transform: uppercase;
      color: var(--msq-pine);
      background: rgba(224,166,63,.20);
      border: 1px solid rgba(224,166,63,.42);
    }
    html[data-theme="dark"] .msq-pill,
    body.dark-theme .msq-pill { color: var(--msq-gold-bright); }
    .msq-block { padding: 14px 16px 4px; }
    .msq-block + .msq-block { border-top: 1px dashed var(--border, #e6dcc8); }
    .msq-block h4 {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0 0 10px;
      font-size: .68rem;
      font-weight: 800;
      letter-spacing: .13em;
      text-transform: uppercase;
      color: var(--text-secondary, #6b6154);
    }
    .msq-teams { display: grid; gap: 9px; margin-bottom: 10px; }
    .msq-ticket {
      position: relative;
      display: flex;
      gap: 11px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--border, #e6dcc8);
      background-color: var(--bg-secondary, #f4ecdd);
      background-image:
        radial-gradient(circle at 0 50%, var(--bg-primary, #fffdf8) 6px, transparent 6.5px),
        radial-gradient(circle at 100% 50%, var(--bg-primary, #fffdf8) 6px, transparent 6.5px);
      background-repeat: no-repeat;
      background-position: left center, right center;
      animation: msq-rise .45s cubic-bezier(.2,.7,.3,1) both;
      animation-delay: calc(var(--msq-i, 0) * 60ms);
    }
    .msq-rank {
      flex: 0 0 auto;
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      font-size: .82rem;
      font-weight: 800;
      color: var(--text-secondary, #6b6154);
      background: var(--bg-primary, #fffdf8);
      border: 1px solid var(--border, #e6dcc8);
    }
    .msq-rank.gold { background: linear-gradient(160deg, #f7d488, #e0a63f); color: #3a2b0c; border-color: #e0a63f; }
    .msq-rank.silver { background: linear-gradient(160deg, #eef1f4, #c8d0d8); color: #3c444c; border-color: #c8d0d8; }
    .msq-rank.bronze { background: linear-gradient(160deg, #e8c1a0, #c58a5c); color: #3d2413; border-color: #c58a5c; }
    .msq-ticket-main { min-width: 0; flex: 1; }
    .msq-ticket-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .msq-logo {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      object-fit: contain;
      background: #fff;
      padding: 1px;
      border: 1px solid var(--border, #e6dcc8);
    }
    .msq-ticket-school {
      font-size: .9rem;
      font-weight: 800;
      color: var(--text-primary, #2f2a24);
      text-decoration: none;
    }
    .msq-ticket-school:hover { color: var(--primary, #3f7d63); }
    .msq-stamp {
      margin-left: auto;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: .55rem;
      font-weight: 900;
      letter-spacing: .13em;
      text-transform: uppercase;
      color: #3a2b0c;
      background: linear-gradient(160deg, #f7d488, #e0a63f);
      box-shadow: 0 1px 0 rgba(0,0,0,.10);
      transform: rotate(-2deg);
    }
    .msq-ticket-meta { margin-top: 3px; font-size: .72rem; color: var(--text-secondary, #6b6154); }
    .msq-runners { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 7px; }
    .msq-runner {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      font-size: .74rem;
      color: var(--text-secondary, #6b6154);
    }
    .msq-runner b { color: var(--text-primary, #2f2a24); font-weight: 700; }
    .msq-runner i { font-style: normal; font-variant-numeric: tabular-nums; color: var(--text-secondary, #6b6154); }
    .msq-indivs { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .msq-indiv {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 11px;
      border-radius: 10px;
      border: 1px solid var(--border, #e6dcc8);
      background: var(--bg-primary, #fffdf8);
      text-decoration: none;
      color: inherit;
      transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease;
    }
    .msq-indiv:hover {
      border-color: var(--primary, #3f7d63);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px var(--shadow-light, rgba(63,55,40,.08));
    }
    .msq-medal {
      flex: 0 0 auto;
      min-width: 28px;
      height: 28px;
      padding: 0 6px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      font-size: .78rem;
      font-weight: 800;
      color: var(--text-secondary, #6b6154);
      background: var(--bg-secondary, #f4ecdd);
      border: 1px solid var(--border, #e6dcc8);
      font-variant-numeric: tabular-nums;
    }
    .msq-medal.gold { background: linear-gradient(160deg, #f7d488, #e0a63f); color: #3a2b0c; border-color: #e0a63f; box-shadow: 0 0 0 3px rgba(224,166,63,.16); }
    .msq-medal.silver { background: linear-gradient(160deg, #eef1f4, #c8d0d8); color: #3c444c; border-color: #c8d0d8; }
    .msq-medal.bronze { background: linear-gradient(160deg, #e8c1a0, #c58a5c); color: #3d2413; border-color: #c58a5c; }
    .msq-indiv-body { min-width: 0; flex: 1; }
    .msq-indiv-name {
      display: block;
      font-size: .84rem;
      font-weight: 700;
      line-height: 1.25;
      color: var(--text-primary, #2f2a24);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .msq-indiv-school {
      display: block;
      font-size: .7rem;
      color: var(--text-secondary, #6b6154);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .msq-indiv-time {
      margin-left: auto;
      font-size: .76rem;
      font-weight: 700;
      color: var(--text-secondary, #6b6154);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .msq-block-wild h4 { color: var(--msq-gold); }
    .msq-block-wild .msq-indiv { border-style: dashed; border-color: rgba(224,166,63,.55); }
    .msq-bubble { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
    .msq-bubblerow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 9px;
      border-radius: 8px;
      border: 1px dashed var(--border, #e6dcc8);
      font-size: .74rem;
      color: var(--text-secondary, #6b6154);
    }
    .msq-bubblerow b {
      font-weight: 800;
      color: var(--text-primary, #2f2a24);
      font-variant-numeric: tabular-nums;
    }
    .msq-bubblerow i { font-style: normal; color: var(--text-secondary, #6b6154); }
    .msq-bubblerow-team { border-style: solid; border-color: rgba(198,91,70,.35); }
    .msq-footnote {
      margin: 0;
      padding: 0 18px 18px;
      font-size: .72rem;
      line-height: 1.5;
      color: var(--text-secondary, #6b6154);
    }
    @media (max-width: 640px) {
      .msq-hero { padding: 20px 18px; }
      .msq-trophy { width: 60px; height: 60px; font-size: 1.6rem; }
      .msq-hero-stats { gap: 18px; }
      .msq-races { padding: 12px; }
      .msq-indivs { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .msq-hero::after { animation: none; display: none; }
      .msq-race, .msq-ticket { animation: none; }
      .msq-indiv:hover { transform: none; }
    }
    @media print {
      .msq-section { box-shadow: none; break-inside: avoid; }
      .msq-hero { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .msq-ticket, .msq-indiv { break-inside: avoid; }
    }
  `;

  function injectStyles() {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function joinPhrases(phrases) {
    if (!phrases.length) return "";
    if (phrases.length === 1) return phrases[0];
    if (phrases.length === 2) return phrases[0] + " and " + phrases[1];
    return phrases.slice(0, -1).join(", ") + ", and " + phrases[phrases.length - 1];
  }

  function linkAttrs(options) {
    return options && options.linkTarget ? ` target="${esc(options.linkTarget)}" rel="noopener"` : "";
  }

  function medalClass(place) {
    const n = parseInt(place, 10);
    if (n === 1) return "gold";
    if (n === 2) return "silver";
    if (n === 3) return "bronze";
    return "";
  }

  function raceTitle(race) {
    return (race.gender === "F" ? "Girls" : "Boys") + " · " + race.race;
  }

  function teamHtml(team, index, options) {
    const slug = slugify(team.school);
    const score = team.isRelay ? timeText(team.score) : team.score != null ? team.score + " pts" : "";
    const meta = [score, team.athletes.length + " runner" + (team.athletes.length === 1 ? "" : "s") + " advancing"]
      .filter(Boolean)
      .join(" · ");
    return `
      <div class="msq-ticket" style="--msq-i:${index}">
        <span class="msq-rank ${medalClass(team.rank)}">${team.rank}</span>
        <div class="msq-ticket-main">
          <div class="msq-ticket-top">
            <img class="msq-logo" src="/assets/team logos/${esc(slug)}.png" alt="" loading="lazy" onerror="this.style.display='none'">
            <a class="msq-ticket-school" href="school.html?slug=${encodeURIComponent(slug)}"${linkAttrs(options)}>${esc(team.school)}</a>
            <span class="msq-stamp">To States</span>
          </div>
          <div class="msq-ticket-meta">${esc(meta)}</div>
          <div class="msq-runners">${team.athletes
            .map(
              (athlete) =>
                `<span class="msq-runner"><b>${esc(athlete.name)}</b>${athlete.timeText ? `<i>${esc(athlete.timeText)}</i>` : ""}</span>`
            )
            .join("")}</div>
        </div>
      </div>`;
  }

  function individualHtml(athlete, options) {
    const name = esc(athlete.name);
    const href = `athlete.html?name=${encodeURIComponent(athlete.name)}&school=${encodeURIComponent(athlete.schoolSlug || "")}`;
    return `
      <a class="msq-indiv" href="${href}"${linkAttrs(options)}>
        <span class="msq-medal ${medalClass(athlete.place)}">${athlete.place != null ? esc(athlete.place) : "–"}</span>
        <span class="msq-indiv-body">
          <span class="msq-indiv-name">${name}</span>
          <span class="msq-indiv-school">${esc(athlete.school)}</span>
        </span>
        <span class="msq-indiv-time">${esc(athlete.timeText || "")}</span>
      </a>`;
  }

  function bubbleHtml(race) {
    const rows = race.bubble
      .map(
        (athlete) =>
          `<span class="msq-bubblerow"><b>${athlete.place != null ? "#" + esc(athlete.place) : "–"}</b> ${esc(
            athlete.name
          )} <i>${esc(athlete.school)}</i></span>`
      )
      .join("");
    const teamRow = race.nextTeam
      ? `<span class="msq-bubblerow msq-bubblerow-team"><b>#${race.nextTeam.rank}</b> ${esc(race.nextTeam.school)} <i>first team out</i></span>`
      : "";
    if (!rows && !teamRow) return "";
    return `
      <div class="msq-block msq-block-bubble">
        <h4><span aria-hidden="true">💨</span> On the bubble</h4>
        <div class="msq-bubble">${teamRow}${rows}</div>
      </div>`;
  }

  function raceHtml(race, index, options) {
    return `
      <article class="msq-race" style="--msq-i:${index}">
        <header class="msq-race-head">
          <div>
            <h3>${esc(raceTitle(race))}</h3>
            <p>${race.fieldSize} finishers · ${race.teamCount} complete team${race.teamCount === 1 ? "" : "s"}</p>
          </div>
          <span class="msq-pill">${race.advanceCount} advancing</span>
        </header>
        ${
          race.teams.length
            ? `<div class="msq-block">
                 <h4><span aria-hidden="true">🎽</span> Team tickets</h4>
                 <div class="msq-teams">${race.teams.map((team, i) => teamHtml(team, i, options)).join("")}</div>
               </div>`
            : ""
        }
        ${
          race.individuals.length
            ? `<div class="msq-block">
                 <h4><span aria-hidden="true">🎟️</span> Individual qualifiers</h4>
                 <div class="msq-indivs">${race.individuals.map((athlete) => individualHtml(athlete, options)).join("")}</div>
               </div>`
            : ""
        }
        ${
          race.wildcards.length
            ? `<div class="msq-block msq-block-wild">
                 <h4><span aria-hidden="true">✨</span> Wildcards</h4>
                 <div class="msq-indivs">${race.wildcards.map((athlete) => individualHtml(athlete, options)).join("")}</div>
               </div>`
            : ""
        }
        ${bubbleHtml(race)}
      </article>`;
  }

  function render(mount, options) {
    if (!mount) return;
    const opts = options || {};
    const rules = opts.rules || rulesFromMeet(opts.meet);
    if (!rules) {
      mount.innerHTML = "";
      mount.hidden = true;
      return;
    }

    const data =
      opts.data ||
      computeQualifiers({
        results: opts.results,
        rules,
        computeTeams: opts.computeTeams,
      });

    if (!data.races.length || !data.totals.athletes) {
      mount.innerHTML = "";
      mount.hidden = true;
      return;
    }

    injectStyles();

    const targetMeet = opts.targetMeet || null;
    const targetName = rules.targetName || (targetMeet && targetMeet.name) || "the State Championship";
    const targetHref = rules.targetSlug
      ? `meet.html?slug=${encodeURIComponent(rules.targetSlug)}`
      : targetMeet && targetMeet.slug
      ? `meet.html?slug=${encodeURIComponent(targetMeet.slug)}`
      : "";
    const targetDate = targetMeet && targetMeet.date ? formatMeetDate(targetMeet.date) : "";
    const targetMeta = targetDate ? ` · ${targetDate}` : "";

    const phrases = [];
    if (rules.teamSpots) phrases.push(`the top <b>${rules.teamSpots}</b> team${rules.teamSpots === 1 ? "" : "s"}`);
    if (rules.individualSpots)
      phrases.push(`the next <b>${rules.individualSpots}</b> individual${rules.individualSpots === 1 ? "" : "s"}`);
    if (rules.wildcardSpots)
      phrases.push(`<b>${rules.wildcardSpots}</b> wildcard${rules.wildcardSpots === 1 ? "" : "s"}`);
    const qualifyLine = phrases.length
      ? `Per race, ${joinPhrases(phrases)} punch a ticket to`
      : `Qualifiers punch a ticket to`;
    const targetHtml = targetHref
      ? `<a class="msq-target" href="${targetHref}"${linkAttrs(opts)}>${esc(targetName)}</a>`
      : `<b>${esc(targetName)}</b>`;

    mount.hidden = false;
    mount.innerHTML = `
      <section class="msq-section" aria-labelledby="msq-title" data-msq="qualifiers">
        <div class="msq-hero">
          <div class="msq-hero-main">
            <span class="msq-kicker">Road to States</span>
            <h2 class="msq-title" id="msq-title">Who&rsquo;s going to <em>States</em>?</h2>
            <p class="msq-sub">${qualifyLine} ${targetHtml}${esc(targetMeta)}.</p>
            <div class="msq-hero-stats">
              <div><strong>${data.totals.athletes}</strong><span>Athletes going</span></div>
              <div><strong>${data.totals.teams}</strong><span>Team spots</span></div>
              <div><strong>${data.totals.races}</strong><span>Races</span></div>
            </div>
          </div>
          <div class="msq-trophy" aria-hidden="true">🏆</div>
        </div>
        <div class="msq-races">${data.races.map((race, index) => raceHtml(race, index, opts)).join("")}</div>
        <p class="msq-footnote">${
          rules.note
            ? esc(rules.note)
            : "Projected from this meet&rsquo;s results using the qualification rules the meet admin set. Spots can change if a qualifier scratches."
        }</p>
      </section>`;
  }

  global.MSMQualifiers = {
    RAW_DEFAULTS,
    rulesFromMeet,
    computeQualifiers,
    compute: computeQualifiers,
    render,
    timeText,
    normalizeSchool,
  };
})(window);
