(function () {
  'use strict';
  const cls = document.body.dataset.division;
  const app = document.getElementById('division-app');
  const classes = ['A', 'AA', 'AAA', 'AAAA'];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const key = (name, school) => norm(school) + '|' + norm(name);
  const time = sec => Number.isFinite(sec) ? Math.floor(sec / 60) + ':' + (sec % 60).toFixed(1).padStart(4, '0') : '—';
  const athleteLink = r => '/CrossCountry/athlete.html?name=' + encodeURIComponent(r.name) + '&school=' + encodeURIComponent(r.school_slug);
  const schoolLink = slug => '/CrossCountry/school.html?slug=' + encodeURIComponent(slug);
  const shell = `<section class="division-hero"><div class="division-kicker">Mountain State Miles · Cross Country</div><h1>Class ${esc(cls)}</h1><p>Your division, all season long. Explore the performances, teams and stories shaping the road to the state meet.</p><nav class="division-nav" aria-label="Cross country divisions">${classes.map(c => `<a href="/CrossCountry/${c}/"${c === cls ? ' aria-current="page"' : ''}>Class ${c}</a>`).join('')}</nav></section><div class="division-bar"><div class="division-filters"><label for="division-gender">Gender</label><select id="division-gender"><option value="M">Boys</option><option value="F">Girls</option></select><label for="division-season">Season</label><select id="division-season"><option>Loading…</option></select></div><div class="division-actions"><button class="division-button secondary" id="division-csv" disabled>Export CSV</button><button class="division-button" id="division-pdf" disabled>Export PDF</button></div></div><dialog id="pdf-options" class="division-dialog" aria-labelledby="pdf-options-title"><form id="pdf-options-form"><h2 id="pdf-options-title">Choose PDF sections</h2><p class="division-muted">Export the full data for any combination of sections, regardless of the page currently shown.</p><fieldset><legend>Sections to include</legend><label><input type="checkbox" name="pdf-section" value="Individual rankings" checked> Individual rankings</label><label><input type="checkbox" name="pdf-section" value="Team analysis" checked> Team analysis</label><label><input type="checkbox" name="pdf-section" value="Regional qualification rules" checked> Regional qualification rules</label><label><input type="checkbox" name="pdf-section" value="Official state entries" checked> Official state entries</label><label><input type="checkbox" name="pdf-section" value="State team projection" checked> State team projection</label><label><input type="checkbox" name="pdf-section" value="Projected individual field" checked> Projected individual field</label></fieldset><p id="pdf-options-error" class="division-muted" role="alert"></p><div class="division-actions"><button type="button" class="division-button secondary" id="pdf-cancel">Cancel</button><button type="submit" class="division-button" id="pdf-generate">Download PDF</button></div></form></dialog><div id="division-status" class="division-status division-muted" role="status" aria-live="polite">Loading division data…</div><nav class="division-sections" aria-label="Division sections"><div class="division-tablist" role="tablist" aria-label="Division sections"><button type="button" role="tab" id="tab-rankings" aria-controls="panel-rankings" aria-selected="true" tabindex="0" data-section="rankings">Rankings</button><button type="button" role="tab" id="tab-teams" aria-controls="panel-teams" aria-selected="false" tabindex="-1" data-section="teams">Teams</button><button type="button" role="tab" id="tab-predictions" aria-controls="panel-predictions" aria-selected="false" tabindex="-1" data-section="predictions">State projections</button><button type="button" role="tab" id="tab-stories" aria-controls="panel-stories" aria-selected="false" tabindex="-1" data-section="stories">Stories</button></div></nav><div id="division-content"></div><section id="panel-stories" class="division-section division-panel" role="tabpanel" aria-labelledby="tab-stories" hidden><h2>Division stories &amp; athlete spotlights</h2><p class="division-muted">Reporting from the Mountain State Miles news desk.</p><div id="division-stories" class="division-stories"><p class="division-muted">Loading stories…</p></div></section>`;
  app.innerHTML = shell;
  const gender = document.getElementById('division-gender');
  const season = document.getElementById('division-season');
  const status = document.getElementById('division-status');
  const content = document.getElementById('division-content');
  let hub, exported = null;
  let officialLineup = null, lineupError = '', lineupRequest = 0;
  let activeSection = 'rankings';
  let pagedTables = {};
  const pageSize = 10;
  const tabs = Array.from(document.querySelectorAll('.division-tablist [role="tab"]'));

  function selectSection(section, focus) {
    activeSection = section;
    tabs.forEach(tab => {
      const selected = tab.dataset.section === section;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }
  tabs.forEach(tab => {
    tab.addEventListener('click', () => selectSection(tab.dataset.section, false));
    tab.addEventListener('keydown', event => {
      let index = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault();
      selectSection(tabs[index].dataset.section, true);
    });
  });

  function rankedAthletes(year, sex, excludeRelays = false) {
    const best = new Map();
    hub.results.forEach(r => {
      if (r.gender !== sex || MSMHub.seasonOf(r) !== year || MSMHub.classify(r.school_slug) !== cls || !MSMHub.isInState(r) || MSMHub.isNonCompetitive(r.meet_slug) || !Number.isFinite(r.msm) || !r.athlete_name || (excludeRelays && /relay/i.test(r.race_type || ''))) return;
      const k = key(r.athlete_name, r.school_slug);
      const prev = best.get(k);
      if (!prev || r.msm > prev.rating) best.set(k, { name:r.athlete_name, school_slug:r.school_slug, school:MSMHub.schoolNameOf(r.school_slug), rating:r.msm, time:r.timeSec, meet:r.meet_name, date:r.date });
    });
    return Array.from(best.values()).sort((a,b) => b.rating - a.rating || a.name.localeCompare(b.name));
  }

  function analyzeTeams(athletes) {
    const teams = new Map();
    athletes.forEach(a => { if (!teams.has(a.school_slug)) teams.set(a.school_slug, {school:a.school, slug:a.school_slug, runners:[]}); teams.get(a.school_slug).runners.push(a); });
    return Array.from(teams.values()).map(t => ({...t, depth:t.runners.length, power:t.runners.length >= 5 ? t.runners.slice(0,5).reduce((n,a) => n+a.rating, 0) : null, spread:t.runners.length >= 5 ? t.runners[0].rating - t.runners[4].rating : null})).sort((a,b) => (a.power == null) - (b.power == null) || (b.power ?? 0) - (a.power ?? 0) || a.school.localeCompare(b.school));
  }

  // Match meet.html's gender and race grouping before calling the shared engine.
  function prepareRegionalResult(r) {
    const text = r.race_type || r.division || r.event || r.event_name || 'Varsity 5K';
    const raw = typeof text === 'string' && text.trim() ? text.trim() : 'Varsity 5K';
    const normalizedRaceType = raw.split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
      .replace(/\b5k\b/i, '5K').replace(/\b3k\b/i, '3K').replace(/\bJv\b/g, 'JV').replace(/\bMs\b/g, 'Middle School')
      .replace(/\bAaaa\b/g, 'AAAA').replace(/\bAaa\b/g, 'AAA').replace(/\bAa\b/g, 'AA');
    const g = String(r.raw_gender || r.gender || '').trim().toUpperCase();
    let normalizedGender;
    if (['M','BOYS','BOY','MALE','B'].includes(g)) normalizedGender = 'M';
    else if (['F','GIRLS','GIRL','FEMALE','G'].includes(g)) normalizedGender = 'F';
    else if (/girl|female|women/i.test(raw)) normalizedGender = 'F';
    else normalizedGender = 'M';
    return {...r, normalizedGender, normalizedRaceType, time:r.timeSec, school_name:r.raw_school_name || r.school_name || MSMHub.schoolNameOf(r.school_slug)};
  }

  function belongsToDivision(m) {
    const label = String(m.name || '').match(/(?:^|[^a-z])(?:class\s*)?(AAAA|AAA|AA|A)(?![a-z])/i);
    if (label) return label[1].toUpperCase() === cls;
    return hub.results.some(r => r.meet_slug === m.slug && MSMHub.classify(r.school_slug) === cls);
  }

  function project(year, sex, athletes) {
    const regionals = Object.values(hub.meets).filter(m => m.date && Number(String(m.date).slice(0,4)) === year && /region/i.test(m.name || m.slug || '') && belongsToDivision(m));
    const meets = Object.values(hub.meets).filter(m => {
      const rules = MSMQualifiers.rulesFromMeet(m);
      if (!rules || !m.date || Number(String(m.date).slice(0,4)) !== year || !belongsToDivision(m)) return false;
      const target = hub.meets[rules.targetSlug] || {};
      return target.is_state_championship || /\bstate\b/i.test([rules.targetName, rules.targetSlug.replace(/[-_]/g, ' '), target.name].join(' '));
    });
    const coverage = regionals.map(m => {
      const rules = MSMQualifiers.rulesFromMeet(m);
      const target = rules && (hub.meets[rules.targetSlug] || {});
      const feedsState = rules && (target.is_state_championship || /\bstate\b/i.test([rules.targetName, rules.targetSlug.replace(/[-_]/g, ' '), target.name].join(' ')));
      return {meet:m, rules, feedsState, hasResults:hub.results.some(r => r.meet_slug === m.slug && prepareRegionalResult(r).normalizedGender === sex)};
    }).sort((a,b) => String(a.meet.name || '').localeCompare(String(b.meet.name || '')));
    if (officialLineup && Array.isArray(officialLineup.entries)) {
      const lookup = new Map(athletes.map(a => [key(a.name, a.school_slug), a]));
      const field = officialLineup.entries.map(entry => {
        const rated = lookup.get(key(entry.name, entry.school_slug));
        const projected = rated ? MSMRating.pointsToEquiv5Ksec(sex, rated.rating) : null;
        return {name:entry.name, school_slug:entry.school_slug, school:entry.school, grade:entry.grade || '', seed:entry.seed || '', note:entry.note || '', rating:rated && rated.rating, projected, role:entry.role, entry:'Official entry'};
      }).sort((a,b) => (a.projected ?? Infinity) - (b.projected ?? Infinity) || a.name.localeCompare(b.name));
      const unrated = field.filter(a => !Number.isFinite(a.projected)).length;
      const teamSlugs = [...new Set(field.filter(a => a.role === 'team').map(a => a.school_slug))];
      const scoring = new Set(teamSlugs.filter(slug => field.filter(a => a.school_slug === slug && a.role === 'team').length >= 5));
      const teamOrder = new Map();
      let scorePlace = 0, place = 0;
      field.forEach(a => {
        a.place = Number.isFinite(a.projected) ? ++place : null;
        if (a.role === 'team') { const n = (teamOrder.get(a.school_slug) || 0) + 1; teamOrder.set(a.school_slug, n); a.projectedStarter = n <= 7; if (!unrated && !a.projectedStarter) a.entry = 'Official entry · possible alternate'; }
        a.scoringPlace = a.place && a.role === 'team' && a.projectedStarter && scoring.has(a.school_slug) ? ++scorePlace : null;
      });
      const teams = teamSlugs.map(slug => {
        const runners = field.filter(a => a.school_slug === slug && a.role === 'team');
        const canScore = !unrated && runners.length >= 5;
        return {slug, school:runners[0].school, depth:runners.length, score:canScore ? runners.slice(0,5).reduce((n,a) => n+a.scoringPlace,0) : null, sixth:canScore && runners[5] ? runners[5].scoringPlace : Infinity};
      }).sort((a,b) => (a.score ?? Infinity) - (b.score ?? Infinity) || a.sixth - b.sixth || a.school.localeCompare(b.school));
      return {official:true, source:officialLineup.source, updatedAt:officialLineup.updatedAt, unrated, message:unrated ? `${unrated} official entries have no matching season rating; team scores are unavailable until every entrant is rated.` : '', teams, field, meets, coverage, resultMeets:0, target:'State meet'};
    }
    if (!meets.length) return {message:'No regional meets with state qualification rules are available for this season.', teams:[], field:[], meets:[], coverage};
    // Never merge regional meets targeting different championships.
    const groups = new Map();
    meets.forEach(m => { const r = MSMQualifiers.rulesFromMeet(m); const id = r.targetSlug || norm(r.targetName); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(m); });
    const groupsSorted = Array.from(groups.values()).sort((a,b) => {
      const matches = group => group.some(m => hub.results.some(r => r.meet_slug === m.slug && prepareRegionalResult(r).normalizedGender === sex && MSMHub.classify(r.school_slug) === cls));
      return Number(matches(b)) - Number(matches(a)) || String(b.reduce((x,m) => x > m.date ? x : m.date, '')).localeCompare(String(a.reduce((x,m) => x > m.date ? x : m.date, '')));
    });
    const selected = groupsSorted[0];
    const qualifyingTeams = new Map(), regionalRunners = new Set(), individuals = new Map();
    let resultMeets = 0;
    selected.forEach(m => {
      const results = hub.results.filter(r => r.meet_slug === m.slug).map(prepareRegionalResult).filter(r => r.normalizedGender === sex);
      if (!results.length) return;
      resultMeets++;
      const data = MSMQualifiers.computeQualifiers({results, rules:MSMQualifiers.rulesFromMeet(m)});
      data.races.filter(r => r.gender === sex).forEach(race => {
        race.teams.forEach(team => {
          const first = team.athletes[0]; const slug = first && first.raw.school_slug;
          if (!slug || MSMHub.classify(slug) !== cls) return;
          qualifyingTeams.set(slug, {school:team.school, teamMembers:MSMQualifiers.rulesFromMeet(m).teamMembers});
          results.filter(r => r.school_slug === slug && r.normalizedRaceType === race.race).forEach(r => regionalRunners.add(key(r.athlete_name, slug)));
        });
        [...race.individuals, ...race.wildcards].forEach(a => {
          const slug = a.raw.school_slug;
          if (!slug || MSMHub.classify(slug) !== cls) return;
          individuals.set(key(a.name, slug), {name:a.name, school_slug:slug});
          regionalRunners.add(key(a.name, slug));
        });
      });
    });
    if (!resultMeets) return {message:'Regional qualification rules exist, but no results are available for this division and gender.', teams:[], field:[], meets:selected, coverage};
    const chosen = [];
    qualifyingTeams.forEach((team, slug) => chosen.push(...athletes.filter(a => a.school_slug === slug).slice(0, team.teamMembers)));
    individuals.forEach((a, k) => { if (!qualifyingTeams.has(a.school_slug)) { const match = athletes.find(x => key(x.name,x.school_slug) === k); if (match) chosen.push(match); } });
    const field = chosen.map(a => ({...a, entry:regionalRunners.has(key(a.name,a.school_slug)) ? 'Regional runner (entry unconfirmed)' : 'Possible entry (not at regional)', projected:MSMRating.pointsToEquiv5Ksec(sex, a.rating)})).filter(a => Number.isFinite(a.projected)).sort((a,b) => a.projected - b.projected);
    const teamCounts = new Map(); field.forEach(a => { if (qualifyingTeams.has(a.school_slug)) teamCounts.set(a.school_slug, (teamCounts.get(a.school_slug)||0)+1); });
    const scoring = new Set(Array.from(teamCounts).filter(([,count]) => count >= 5).map(([slug]) => slug));
    let scorePlace = 0;
    field.forEach((a,i) => { a.place = i+1; a.scoringPlace = scoring.has(a.school_slug) ? ++scorePlace : null; });
    const teams = Array.from(qualifyingTeams, ([slug, team]) => { const runners = field.filter(a => a.school_slug === slug); return {slug, school:team.school, depth:runners.length, score:runners.length >= 5 ? runners.slice(0,5).reduce((n,a) => n+a.scoringPlace,0) : null, sixth:runners[5] ? runners[5].scoringPlace : Infinity}; }).sort((a,b) => (a.score ?? Infinity) - (b.score ?? Infinity) || a.sixth - b.sixth || a.school.localeCompare(b.school));
    const message = !teams.length && !individuals.size ? 'No Class ' + cls + ' qualifiers could be identified from the available regional results.' : '';
    return {message, teams, field, meets:selected, coverage, resultMeets, target:MSMQualifiers.rulesFromMeet(selected[0]).targetName || (hub.meets[MSMQualifiers.rulesFromMeet(selected[0]).targetSlug] || {}).name || 'State meet'};
  }

  function table(headers, rows, empty, id) {
    if (id) pagedTables[id] = {headers, rows, empty, page:0};
    return id ? `<div data-table="${id}">${tablePage(pagedTables[id], id)}</div>` : tablePage({headers, rows, empty, page:0}, null);
  }
  function tablePage(data, id) {
    const {headers, rows, empty, page} = data;
    if (!rows.length) return `<div class="division-card division-empty">${esc(empty)}</div>`;
    const start = id ? page * pageSize : 0;
    const shown = id ? rows.slice(start, start + pageSize) : rows;
    const controls = id && rows.length > pageSize ? `<div class="division-pagination"><span aria-live="polite">Showing ${start + 1}–${start + shown.length} of ${rows.length}</span><div><button type="button" class="division-button secondary" data-page="prev" ${page === 0 ? 'disabled' : ''} aria-label="Previous ${esc(id)} page">Previous</button><button type="button" class="division-button secondary" data-page="next" ${start + pageSize >= rows.length ? 'disabled' : ''} aria-label="Next ${esc(id)} page">Next</button></div></div>` : '';
    return `<div class="division-table-wrap"><table class="division-table"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${shown.map(row => '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>').join('')}</tbody></table></div>${controls}`;
  }
  content.addEventListener('click', event => {
    const button = event.target.closest('button[data-page]');
    if (!button) return;
    const container = button.closest('[data-table]');
    const data = pagedTables[container.dataset.table];
    if (!data) return;
    data.page += button.dataset.page === 'next' ? 1 : -1;
    container.innerHTML = tablePage(data, container.dataset.table);
    const nextFocus = container.querySelector(`button[data-page="${button.dataset.page}"]:not(:disabled)`) || container.querySelector('button[data-page]:not(:disabled)');
    if (nextFocus) nextFocus.focus();
  });
  function render() {
    if (!hub) return;
    pagedTables = {};
    const year = Number(season.value), sex = gender.value;
    const athletes = rankedAthletes(year, sex), teams = analyzeTeams(athletes), prediction = project(year, sex, rankedAthletes(year, sex, true));
    const scoringTeams = teams.filter(t => t.power != null);
    const leader = athletes[0], teamLeader = scoringTeams[0];
    const names = sex === 'M' ? 'Boys' : 'Girls';
    status.textContent = `${year} · ${names} · Class ${cls} · In-season WV performances; current classification mapping is used for all seasons.`;
    const rows = athletes.map((a,i) => [String(i+1), `<a href="${athleteLink(a)}">${esc(a.name)}</a>`, `<a href="${schoolLink(a.school_slug)}">${esc(a.school)}</a>`, esc(a.rating), esc(time(a.time)), esc(a.meet)]);
    const teamRows = teams.map((t,i) => [String(i+1), `<a href="${schoolLink(t.slug)}">${esc(t.school)}</a>`, t.power == null ? 'Incomplete' : esc(t.power), esc(t.depth), t.spread == null ? '—' : esc(t.spread)]);
    const ruleRows = prediction.coverage.map(({meet, rules, feedsState, hasResults}) => [
      `<a href="/CrossCountry/meet.html?slug=${encodeURIComponent(meet.slug)}">${esc(meet.name || meet.slug)}</a>`,
      rules ? `${esc(rules.teamSpots)} teams · ${esc(rules.teamMembers)} runners per team · ${esc(rules.individualSpots)} individuals · ${esc(rules.wildcardSpots)} wildcards` : 'Not configured',
      rules ? esc((rules.raceScope === 'all' ? 'All races' : 'Varsity only') + (feedsState ? '' : ' · target not identified as state meet') + (rules.note ? ' · ' + rules.note : '')) : '—',
      hasResults ? 'Available' : 'No results'
    ]);
    const officialRows = prediction.official ? prediction.field.map(a => [`<a href="${athleteLink(a)}">${esc(a.name)}</a>`, esc(a.school), esc(a.grade || '—'), esc(a.seed || '—'), esc(a.role === 'team' ? 'Team' : 'Individual'), esc(a.note || '—')]) : [];
    const projectionRows = prediction.teams.map((t,i) => [t.score == null ? '—' : String(i+1), `<a href="${schoolLink(t.slug)}">${esc(t.school)}</a>`, t.score == null ? 'Incomplete' : esc(t.score), esc(t.depth)]);
    const fieldRows = prediction.field.map(a => [a.place == null ? '—' : esc(a.place), `<a href="${athleteLink(a)}">${esc(a.name)}</a>`, esc(a.school), esc(time(a.projected)), a.entry.startsWith('Possible') ? '<span class="division-tag">Possible entry</span>' : esc(a.entry)]);
    const projectionNote = prediction.official ? `Official entries published by an administrator. Source: ${esc(prediction.source)} · Updated: ${esc(prediction.updatedAt)}. Projected times and standings remain estimates based on season ratings, not official results. For team scoring, each team's top seven rated entries are assumed to start; additional entries are possible alternates, not confirmed scratches. Athletes without a matching rating remain in the field without a projected time.` : 'An estimate, not an official entry list. Regional results and the meet’s published qualification settings determine the field. For qualifying teams, the best season-rated runners up to the configured team roster size are included even if they did not race at regionals; those runners are marked <strong>possible entry</strong> and their eligibility is unverified. Individual qualifiers are included where identifiable. Projection ratings exclude relay legs. Projected 5K times are neutral-condition MSM equivalents, not state-course or weather forecasts. Missing regional results, entry changes, combined races, or incomplete qualification rules can change the outcome.';
    content.innerHTML = `<section class="division-section division-fade"><h2>Division at a glance</h2><div class="division-grid"><div class="division-card"><div class="division-muted">Rated athletes</div><div class="division-stat">${athletes.length}</div><div class="division-muted">${names} · ${year}</div></div><div class="division-card"><div class="division-muted">Individual leader</div><div class="division-stat">${leader ? esc(leader.rating) : '—'}</div><div class="division-muted">${leader ? esc(leader.name + ' · ' + leader.school) : 'No rated results'}</div></div><div class="division-card"><div class="division-muted">Leading team power</div><div class="division-stat">${teamLeader ? esc(teamLeader.power) : '—'}</div><div class="division-muted">${teamLeader ? esc(teamLeader.school) : 'No complete teams'}</div></div></div></section><section id="panel-rankings" class="division-section division-panel" role="tabpanel" aria-labelledby="tab-rankings"><h2>Individual rankings</h2><p class="division-muted">Best in-season MSM rating per athlete, including relay legs as in the existing hub; higher is better. Time shown is from the rated performance, not necessarily a personal best. <a href="/CrossCountry/rankings-explained.html">How ratings work</a></p>${table(['Rank','Athlete','School','MSM','Time','Meet'],rows,'No rated results are available for this selection.','rankings')}</section><section id="panel-teams" class="division-section division-panel" role="tabpanel" aria-labelledby="tab-teams" hidden><h2>Team analysis</h2><p class="division-muted">Power is the sum of a team’s five best athlete ratings. Spread is the difference between its first and fifth rating; smaller indicates a tighter scoring pack.</p>${table(['Rank','Team','Top-five power','Rated runners','1–5 spread'],teamRows,'No team data is available for this selection.','teams')}</section><section id="panel-predictions" class="division-section division-panel" role="tabpanel" aria-labelledby="tab-predictions" hidden><h2>Road to states · projection</h2><p class="division-note">${projectionNote}</p>${lineupError ? `<p class="division-note">Official entries could not be checked: ${esc(lineupError)}. The field below is an estimate and may not reflect published entries.</p>` : ''}<p class="division-muted">${prediction.message ? esc(prediction.message) : prediction.official ? 'The published entry list determines the projected field.' : `Target: ${esc(prediction.target)} · ${prediction.resultMeets} of ${prediction.meets.length} configured regional meets have ${names.toLowerCase()} results. Check completeness and official qualification rules before relying on this field.`}</p><h3>Regional qualification rules</h3><p class="division-muted">The rules below are the same meet-specific settings used by each meet’s Road to States graphic. Regions without rules are omitted from the projection; open a meet to review its results.</p>${table(['Regional meet','Advancement per race','Scope and notes','Results'],ruleRows,'No regional meets identified for this division and season.')}${prediction.official ? `<h3>Official state entries</h3>${table(['Athlete','School','Grade','Seed time','Type','Qualification note'],officialRows,'No published entries.','official entries')}` : ''}<h3>Projected team standings</h3>${table(['Rank','Qualified team','Projected points','Projected runners'],projectionRows,'No qualifying team projections available.','projected teams')}<h3 class="division-subheading">Projected individual field</h3><p class="division-muted">${prediction.official ? 'Official entries; times and places are projected, and unrated entrants have no projected place.' : 'Ranked by neutral equivalent 5K. Possible entries are not confirmed state-meet participants.'}</p>${table(['Place','Athlete','School','Equivalent 5K','Entry status'],fieldRows,'No projected individual field available.','projected athletes')}</section>`;
    selectSection(activeSection, false);
    exported = {year, names, athletes, teams, prediction};
    document.getElementById('division-csv').disabled = false;
    document.getElementById('division-pdf').disabled = false;
  }

  function exportRows() {
    const {year,names,athletes,teams,prediction} = exported;
    const rows = [['Class',cls,'Season',year,'Gender',names], ['Method',prediction.official ? `Official entries published by an administrator; source: ${prediction.source}; updated: ${prediction.updatedAt}. Projected times and standings are estimates using season ratings and the top seven rated entries per team as assumed starters. Other entries are possible alternates, not confirmed scratches. Unrated entries have no projected time.` : `Current classification mapping is used for all seasons. MSM ratings from in-season WV performances include relay legs. Projection excludes relay legs and uses configured regional qualifying rules and neutral equivalent 5K; possible entries are unverified.${lineupError ? ' Official entries could not be checked: ' + lineupError : ''}`], ['Regional coverage',`${prediction.resultMeets || 0} of ${prediction.meets.length} configured meets with results`, 'Target',prediction.target || '', 'Status',prediction.message || ''], [], ['Regional qualification rules'], ['Meet','Teams','Runners per team','Individuals','Wildcards','Race scope','Note','Results'], ...prediction.coverage.map(({meet,rules,feedsState,hasResults}) => [meet.name || meet.slug, rules ? rules.teamSpots : 'Not configured', rules ? rules.teamMembers : '', rules ? rules.individualSpots : '', rules ? rules.wildcardSpots : '', rules ? rules.raceScope : '', rules ? [rules.note, feedsState ? '' : 'Target not identified as state meet'].filter(Boolean).join(' · ') : '', hasResults ? 'Available' : 'No results']), [], ['Individual rankings'], ['Rank','Athlete','School','MSM','Time','Meet']];
    athletes.forEach((a,i) => rows.push([i+1,a.name,a.school,a.rating,time(a.time),a.meet]));
    rows.push([],['Team analysis'],['Rank','Team','Top-five power','Rated runners','1–5 spread']);
    teams.forEach((t,i) => rows.push([i+1,t.school,t.power == null ? 'Incomplete' : t.power,t.depth,t.spread == null ? '' : t.spread]));
    rows.push([],['Official state entries'],['Athlete','School','Grade','Seed time','Type','Qualification note']);
    if (prediction.official) prediction.field.forEach(a => rows.push([a.name,a.school,a.grade,a.seed,a.role,a.note]));
    rows.push([],['State team projection'],['Rank','Team','Projected points','Projected runners']);
    prediction.teams.forEach((t,i) => rows.push([t.score == null ? '' : i+1,t.school,t.score == null ? 'Incomplete' : t.score,t.depth]));
    rows.push([],['Projected individual field'],['Place','Athlete','School','Equivalent 5K','Entry status']);
    prediction.field.forEach(a => rows.push([a.place,a.name,a.school,time(a.projected),a.entry]));
    return rows;
  }
  document.getElementById('division-csv').addEventListener('click', () => {
    const csv = exportRows().map(row => row.map(value => { const s = String(value == null ? '' : value); return '"' + (/^[\s]*[=+@\-\t\r]/.test(s) ? "'" + s : s).replace(/"/g,'""') + '"'; }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = `class-${cls}-${exported.year}-${exported.names.toLowerCase()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  const pdfDialog = document.getElementById('pdf-options');
  const pdfForm = document.getElementById('pdf-options-form');
  const pdfError = document.getElementById('pdf-options-error');
  document.getElementById('division-pdf').addEventListener('click', () => { pdfError.textContent = ''; pdfDialog.showModal(); });
  document.getElementById('pdf-cancel').addEventListener('click', () => pdfDialog.close());
  pdfForm.addEventListener('submit', async event => {
    event.preventDefault();
    const selected = new Set(Array.from(pdfForm.querySelectorAll('input[name="pdf-section"]:checked'), input => input.value));
    if (!selected.size) { pdfError.textContent = 'Select at least one section.'; return; }
    pdfError.textContent = '';
    const button = document.getElementById('pdf-generate');
    button.disabled = true;
    try {
      await MSMPdf.ready(); const doc = new window.jspdf.jsPDF();
      const header = await MSMPdf.brandHeader(doc,{title:`Class ${cls} Cross Country`,subtitle:`${exported.year} · ${exported.names} · Rankings and state projections`});
      const rows = exportRows();
      const headings = ['Regional qualification rules','Individual rankings','Team analysis','Official state entries','State team projection','Projected individual field'];
      const intro = rows.slice(0,3).map(row => [row.join(' · ')]);
      doc.autoTable({head:[['Report notes']],body:intro,didDrawPage:header,margin:{top:32,bottom:20},styles:{fontSize:8,cellPadding:2,overflow:'linebreak'},headStyles:{fillColor:[63,125,99]}});
      headings.forEach((title, index) => {
        if (!selected.has(title)) return;
        const start = rows.findIndex(r => r.length === 1 && r[0] === title);
        const end = index + 1 < headings.length ? rows.findIndex(r => r.length === 1 && r[0] === headings[index+1]) : rows.length;
        const columns = rows[start+1];
        const body = rows.slice(start+2,end).filter(r => r.length).map(r => r.map(v => String(v == null ? '' : v)));
        if (!body.length) body.push(['No data available']);
        doc.autoTable({startY:doc.lastAutoTable.finalY+7,head:[[{content:title,colSpan:columns.length}],columns],body,didDrawPage:header,margin:{top:32,bottom:20},styles:{fontSize:8,cellPadding:2,overflow:'linebreak'},headStyles:{fillColor:[63,125,99]}});
      });
      MSMPdf.finalize(doc); doc.save(`class-${cls}-${exported.year}-${exported.names.toLowerCase()}.pdf`);
      pdfDialog.close();
    } catch(e) { pdfError.textContent = 'PDF export failed: ' + e.message; }
    finally { button.disabled = false; }
  });
  async function loadLineup() {
    const request = ++lineupRequest;
    officialLineup = null; lineupError = '';
    status.textContent = 'Checking published state entries…';
    content.innerHTML = '';
    document.getElementById('division-csv').disabled = true;
    document.getElementById('division-pdf').disabled = true;
    try {
      const snapshot = await window.firebaseDatabase.ref(`state_lineups/${season.value}/${cls}/${gender.value}`).once('value');
      if (request !== lineupRequest) return;
      const record = snapshot.val();
      if (record) {
        const entries = record.entries && Object.values(record.entries);
        if (!Array.isArray(entries) || !entries.length || entries.some(e => !e || !e.name || !e.school_slug || !e.school || !['team','individual'].includes(e.role))) throw new Error('The published entry list is incomplete.');
        officialLineup = {...record, entries};
      }
    } catch (error) { if (request !== lineupRequest) return; lineupError = error.message || 'Database unavailable'; }
    render();
  }
  gender.addEventListener('change', loadLineup); season.addEventListener('change', loadLineup);

  async function loadStories() {
    const box = document.getElementById('division-stories');
    try {
      if (!window.firebaseDatabase) throw new Error('News database unavailable');
      const snap = await window.firebaseDatabase.ref('news').once('value'); const stories = [];
      snap.forEach(c => { const n = c.val() || {}; if (n.division === cls && n.title) stories.push({id:c.key,...n}); });
      stories.sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
      box.innerHTML = stories.length ? stories.map(n => `<a class="division-card" href="/news.html#/article/${encodeURIComponent(n.id)}"><span class="division-kicker">${esc(n.storyType === 'spotlight' ? 'Athlete spotlight' : (n.category || 'News'))}</span><h3>${esc(n.title)}</h3><p class="division-muted">${esc(String(n.content || '').replace(/<[^>]*>/g,'').slice(0,180))}${String(n.content || '').length > 180 ? '…' : ''}</p><span class="division-muted">${esc(n.date || '')} · Read story →</span></a>`).join('') : '<p class="division-muted">No division stories published yet.</p>';
    } catch(e) { box.textContent = 'Stories could not be loaded: ' + e.message; }
  }
  loadStories();
  MSMHub.load().then(async data => {
    hub = data;
    const current = MSMHub.currentSeason();
    let publishedYears = [];
    try {
      const snapshot = await window.firebaseDatabase.ref('state_lineups').once('value');
      const all = snapshot.val() || {};
      publishedYears = Object.keys(all).filter(y => /^\d{4}$/.test(y) && all[y] && all[y][cls]).map(Number);
    } catch (_) { /* The selected race is checked separately and reports failures. */ }
    const years = [...new Set([...hub.results.map(r => MSMHub.seasonOf(r)).filter(Number.isFinite), ...publishedYears, current])].sort((a,b) => b-a);
    season.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    season.value = String(current);
    loadLineup();
  }).catch(e => { status.textContent = 'Division data could not be loaded: ' + e.message; });
})();
