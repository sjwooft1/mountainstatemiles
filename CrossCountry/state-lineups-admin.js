/* State lineups are protected by Firebase rules, not the legacy admin page gate. */
(function () {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = s => String(s || '').trim().toLowerCase().replace(/\s+(high\s+)?school\s*$/i, '').replace(/\s+hs\s*$/i, '').replace(/[^a-z0-9]/g, '');
  const auth = firebase.auth();
  const db = window.firebaseDatabase;
  let host, schools = [], entries = [], dirty = false, loadId = 0, loadedPath = '', authorized = false;
  const el = id => document.getElementById(id);
  const message = (text, error) => { const box = el('lineup-status'); if (box) { box.textContent = text; box.className = error ? 'alert alert-danger' : 'alert alert-success'; } };
  const currentPath = () => `state_lineups/${el('lineup-year').value}/${el('lineup-class').value}/${el('lineup-gender').value}`;

  // RFC 4180-style parsing, including quoted commas, newlines and doubled quotes.
  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const rows = []; let row = [], field = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else field += c;
      } else if (c === '"' && field === '' && !closed) quoted = true;
      else if (c === ',') { row.push(field); field = ''; closed = false; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); if (row.some(v => v.trim())) rows.push(row);
        row = []; field = ''; closed = false;
      } else if (closed && !/\s/.test(c)) throw new Error('Unexpected character after closing quote.');
      else if (!closed) field += c;
    }
    if (quoted) throw new Error('Unclosed quoted field.');
    row.push(field); if (row.some(v => v.trim())) rows.push(row);
    return rows;
  }

  function findSchool(name) {
    const matches = schools.filter(s => normalize(s.name) === normalize(name) || normalize(s.slug) === normalize(name));
    return matches.length === 1 ? matches[0].slug : '';
  }
  function parseEntries(text, division) {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('The CSV is empty.');
    if (/^(grade|year|class)$/i.test(rows[0][0].trim()) && /name|athlete/i.test(rows[0][1] || '')) rows.shift();
    if (!rows.length) throw new Error('The CSV has a header but no entries.');
    return rows.map((row, index) => {
      if (row.length !== 5) throw new Error(`Row ${index + 1}: expected five columns (grade, athlete, seed time, school, qualification note), found ${row.length}.`);
      const [grade, name, seed, school, note] = row.map(x => x.trim());
      if (!name || !school) throw new Error(`Row ${index + 1}: athlete and school are required.`);
      const match = note.match(/^(AAAA|AAA|AA|A)(?=[NS\s]|$)/i);
      if (match && match[1].toUpperCase() !== division) throw new Error(`Row ${index + 1}: qualification note indicates Class ${match[1].toUpperCase()}, not Class ${division}.`);
      const role = /(?:^|\s)t\d+\b/i.test(note) ? 'team' : /(?:^|\s)i\d+\b/i.test(note) ? 'individual' : '';
      return {name, school, school_slug:findSchool(school), grade, seed, note, role};
    });
  }
  function syncRows() {
    if (!el('lineup-rows')) return;
    el('lineup-rows').querySelectorAll('tr[data-index]').forEach(tr => {
      const row = entries[Number(tr.dataset.index)];
      tr.querySelectorAll('[data-field]').forEach(input => row[input.dataset.field] = input.value.trim());
      const selected = schools.find(s => s.slug === row.school_slug);
      if (selected) row.school = selected.name;
    });
  }
  function renderRows() {
    const body = el('lineup-rows'); if (!body) return;
    const options = schools.map(s => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join('');
    body.innerHTML = entries.map((r, i) => `<tr data-index="${i}"><td><input data-field="name" aria-label="Athlete ${i + 1}" value="${esc(r.name)}"></td><td><select data-field="school_slug" aria-label="School ${i + 1}"><option value="">Choose school${r.school ? ' (' + esc(r.school) + ')' : ''}</option>${options.replace(`value="${esc(r.school_slug)}"`, `value="${esc(r.school_slug)}" selected`)}</select></td><td><input data-field="grade" aria-label="Grade ${i + 1}" value="${esc(r.grade)}"></td><td><input data-field="seed" aria-label="Seed time ${i + 1}" value="${esc(r.seed)}"></td><td><select data-field="role" aria-label="Entry type ${i + 1}"><option value="">Choose type</option><option value="team" ${r.role === 'team' ? 'selected' : ''}>Team</option><option value="individual" ${r.role === 'individual' ? 'selected' : ''}>Individual</option></select></td><td><input data-field="note" aria-label="Qualification note ${i + 1}" value="${esc(r.note)}"></td><td><button type="button" class="btn btn-danger btn-small" data-remove="${i}">Remove</button></td></tr>`).join('');
    el('lineup-count').textContent = `${entries.length} entries${dirty ? ' · unsaved changes' : ''}`;
  }
  function validate() {
    const seen = new Set();
    if (!entries.length) throw new Error('Add at least one entry. To withdraw a published list, use Unpublish.');
    entries.forEach((r, i) => {
      if (!r.name || !r.school_slug || !['team','individual'].includes(r.role)) throw new Error(`Entry ${i + 1}: athlete, a matched school, and entry type are required.`);
      if (!schools.some(s => s.slug === r.school_slug)) throw new Error(`Entry ${i + 1}: choose a valid school.`);
      if (r.seed && (!/^\d+:\d{2}(?:\.\d+)?$/.test(r.seed) || Number(r.seed.split(':')[1]) >= 60)) throw new Error(`Entry ${i + 1}: seed time must be m:ss or m:ss.d, with seconds under 60, or blank.`);
      const id = r.name.toLowerCase().replace(/\s+/g, ' ') + '|' + r.school_slug;
      if (seen.has(id)) throw new Error(`Entry ${i + 1}: duplicate athlete and school.`);
      seen.add(id);
    });
  }
  function enableEditor(enabled) {
    const fieldset = el('lineup-editor'); if (fieldset) fieldset.disabled = !enabled;
  }
  async function checkUser(user) {
    authorized = false; enableEditor(false);
    if (!el('lineup-auth-status')) return;
    if (!user) { el('lineup-auth-status').textContent = 'Not signed in to Firebase.'; return; }
    el('lineup-auth-status').textContent = 'Checking lineup administrator access…';
    try {
      const result = await db.ref('state_lineup_admins/' + user.uid).once('value');
      if (auth.currentUser !== user || !el('lineup-auth-status')) return;
      authorized = result.val() === true;
      el('lineup-auth-status').textContent = authorized ? `Signed in as ${user.email || user.uid}. Lineup access granted.` : 'This account is not an authorized lineup administrator.';
      enableEditor(authorized);
      if (authorized) await loadLineup();
    } catch (error) { if (el('lineup-auth-status')) el('lineup-auth-status').textContent = 'Could not verify admin access. Check the Firebase rules: ' + error.message; }
  }
  async function loadLineup() {
    const id = ++loadId, path = currentPath();
    enableEditor(false); loadedPath = '';
    try {
      const snap = await db.ref(path).once('value');
      if (id !== loadId || !el('lineup-rows')) return;
      const value = snap.val();
      entries = value && value.entries ? Object.values(value.entries).map(r => ({name:r.name || '', school:r.school || '', school_slug:r.school_slug || '', grade:r.grade || '', seed:r.seed || '', note:r.note || '', role:r.role || ''})) : [];
      el('lineup-source').value = value && value.source || '';
      dirty = false; loadedPath = path; renderRows(); enableEditor(authorized);
      message(value ? `Published list loaded. Last updated: ${value.updatedAt || 'unknown'}.` : 'No published list for this selection.');
    } catch (error) { if (id === loadId) { enableEditor(authorized); message('Could not load this lineup: ' + error.message, true); } }
  }
  async function render(container) {
    host = container; loadId++; loadedPath = ''; entries = []; dirty = false;
    host.innerHTML = `<div class="panel"><h3>State lineups</h3><p class="muted">Sign in with an authorized Firebase account to review, edit, publish or withdraw official entries. This is separate from the old XC admin login.</p><div class="qual-hero-note"><strong>Setup required:</strong> publishing is secure only after the database owner reviews and deploys the lineup-specific Firebase rules. The legacy page login is not protection. See <a href="state-lineups-setup.md">setup instructions</a>.</div><form id="lineup-login" class="form-grid"><div class="form-group"><label for="lineup-email">Firebase admin email</label><input id="lineup-email" type="email" autocomplete="username" required></div><div class="form-group"><label for="lineup-password">Password</label><input id="lineup-password" type="password" autocomplete="current-password" required></div><div><button class="btn btn-primary" type="submit">Sign in</button> <button class="btn btn-secondary" type="button" id="lineup-signout">Sign out</button></div></form><p id="lineup-auth-status" role="status">Checking sign-in…</p><div id="lineup-status" role="status"></div></div><fieldset id="lineup-editor" disabled style="border:0;padding:0;margin:16px 0"><div class="panel"><h3>Selected state race</h3><div class="form-grid"><div class="form-group"><label for="lineup-year">Season</label><input id="lineup-year" type="number" min="1900" max="2100" value="${new Date().getFullYear()}"></div><div class="form-group"><label for="lineup-class">Division</label><select id="lineup-class"><option>A</option><option>AA</option><option>AAA</option><option>AAAA</option></select></div><div class="form-group"><label for="lineup-gender">Race</label><select id="lineup-gender"><option value="M">Boys</option><option value="F">Girls</option></select></div><div class="form-group"><label for="lineup-source">Official source / meet</label><input id="lineup-source" placeholder="e.g. WVSSAC entries, meet date"></div></div><p class="muted">Select the correct season, division and gender yourself: the sample CSV does not identify all three. Verify the source and every entry before publishing.</p><label for="lineup-csv">Import Athletic.net entries CSV</label> <input type="file" id="lineup-csv" accept=".csv,text/csv"><p class="muted">Supported sample format: grade, athlete, seed time, school, qualification note (five columns; no header required). Import replaces this draft. Choose the school and team/individual type for unmatched rows.</p><button type="button" class="btn btn-secondary" id="lineup-add">+ Add entry</button> <span id="lineup-count"></span><div class="grid-scroll"><table class="grid-table"><thead><tr><th>Athlete</th><th>School</th><th>Grade</th><th>Seed</th><th>Type</th><th>Qualification note</th><th></th></tr></thead><tbody id="lineup-rows"></tbody></table></div><p><button type="button" class="btn btn-primary" id="lineup-publish">Publish official entries</button> <button type="button" class="btn btn-danger" id="lineup-unpublish">Unpublish</button></p></div></fieldset>`;
    try {
      const snap = await db.ref('crosscountry/schools').once('value');
      if (host !== container || !el('lineup-login')) return;
      schools = []; snap.forEach(child => { const s = child.val() || {}; if (s.slug && s.name) schools.push({slug:s.slug, name:s.name}); });
      schools.sort((a,b) => a.name.localeCompare(b.name));
      if (!schools.length) throw new Error('No schools are available to match entries.');
    } catch (error) { message('Could not load schools: ' + error.message, true); return; }
    el('lineup-login').addEventListener('submit', async e => { e.preventDefault(); try { await auth.signInWithEmailAndPassword(el('lineup-email').value.trim(), el('lineup-password').value); el('lineup-password').value = ''; } catch (error) { message('Sign-in failed: ' + error.message, true); } });
    el('lineup-signout').addEventListener('click', async () => { if (dirty && !confirm('Discard unsaved lineup changes and sign out?')) return; try { await auth.signOut(); entries = []; dirty = false; loadedPath = ''; renderRows(); } catch (error) { message('Sign-out failed: ' + error.message, true); } });
    ['lineup-year','lineup-class','lineup-gender'].forEach(id => {
      const input = el(id); input.dataset.previous = input.value;
      input.addEventListener('change', () => {
        if (dirty && !confirm('Discard unsaved lineup changes and change races?')) { input.value = input.dataset.previous; return; }
        if (id === 'lineup-year' && (!input.checkValidity() || !input.value)) { input.value = input.dataset.previous; message('Choose a season from 1900 to 2100.', true); return; }
        input.dataset.previous = input.value; loadLineup();
      });
    });
    el('lineup-source').addEventListener('input', () => { dirty = true; el('lineup-count').textContent = `${entries.length} entries · unsaved changes`; });
    el('lineup-rows').addEventListener('input', () => { dirty = true; el('lineup-count').textContent = `${entries.length} entries · unsaved changes`; });
    el('lineup-rows').addEventListener('change', () => { syncRows(); dirty = true; renderRows(); });
    el('lineup-rows').addEventListener('click', e => { const b = e.target.closest('[data-remove]'); if (!b) return; syncRows(); entries.splice(Number(b.dataset.remove),1); dirty = true; renderRows(); });
    el('lineup-add').addEventListener('click', () => { syncRows(); entries.push({name:'',school:'',school_slug:'',grade:'',seed:'',note:'',role:''}); dirty = true; renderRows(); });
    el('lineup-csv').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      if ((entries.length || dirty) && !confirm('Replace the current draft with this CSV?')) { e.target.value = ''; return; }
      const path = currentPath();
      try {
        const parsed = parseEntries(await file.text(), el('lineup-class').value);
        if (path !== currentPath() || path !== loadedPath) throw new Error('The selected race changed while the file was loading; import it again.');
        entries = parsed; dirty = true; renderRows();
        const unmatched = entries.filter(r => !r.school_slug || !r.role).length;
        message(`Imported ${entries.length} entries for review. ${unmatched} need a school or entry type selected. Verify the race and source before publishing.`);
      } catch (error) { message('Import failed: ' + error.message, true); }
      e.target.value = '';
    });
    el('lineup-publish').addEventListener('click', async () => {
      try {
        syncRows(); validate();
        const source = el('lineup-source').value.trim(); if (!source) throw new Error('Provide the official source or meet before publishing.');
        const path = currentPath(); if (!authorized || !auth.currentUser || path !== loadedPath) throw new Error('Sign in and load the selected race before publishing.');
        if (!confirm(`Publish ${entries.length} entries as official for ${el('lineup-year').value}, Class ${el('lineup-class').value}, ${el('lineup-gender').value === 'M' ? 'Boys' : 'Girls'}? This replaces the existing list.`)) return;
        const user = auth.currentUser;
        const data = {source, updatedAt:new Date().toISOString(), updatedBy:user.uid, entries:entries.map(r => ({...r}))};
        enableEditor(false); await db.ref(path).set(data);
        if (el('lineup-rows') && currentPath() === path) { dirty = false; renderRows(); message('Official entries published.'); }
      } catch (error) { message('Publish failed: ' + error.message, true); }
      finally { enableEditor(authorized); }
    });
    el('lineup-unpublish').addEventListener('click', async () => {
      const path = currentPath();
      if (!authorized || !auth.currentUser || path !== loadedPath) return message('Sign in and load the selected race first.', true);
      if (!confirm('Withdraw the published entries for this race? Unsaved changes will be discarded.')) return;
      try { enableEditor(false); await db.ref(path).remove(); await loadLineup(); }
      catch (error) { message('Unpublish failed: ' + error.message, true); }
      finally { enableEditor(authorized); }
    });
    if (!render.unsubscribe) render.unsubscribe = auth.onAuthStateChanged(user => checkUser(user));
    else checkUser(auth.currentUser);
  }
  function confirmLeave() { return !dirty || confirm('Discard unsaved lineup changes?'); }
  window.StateLineupsAdmin = {render, parseCSV, parseEntries, confirmLeave};
})();
