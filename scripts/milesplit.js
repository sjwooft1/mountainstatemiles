javascript:(async function(){
    console.log("--- SCRAPING MILESPLIT (FORMATTED RESULTS) ---");

    // Output columns match anet.js, plus a trailing `state` column. MileSplit links each
    // team to a state subdomain (e.g. wv.milesplit.com/teams/... vs oh.milesplit.com/...),
    // so we can detect each athlete's home state and feed it straight into the importer's
    // state tag (WV athletes get ranked; out-of-state runners still score).
    const HEADER = "event_name,place,grade,athlete_name,mark,school,heat,gender,state";
    let csvRows = new Set([HEADER]);

    let currentEvent = "Unknown Event";
    let currentGender = "Boys";
    const currentHeat = "1"; // MileSplit formatted results aren't split by heat.

    // Map a milesplit team URL to a 2-letter state. Subdomain wins (wv./oh./pa.);
    // www./milesplit.com links carry no state, so we return "" and let the importer's
    // Meet Home State default fill it in.
    function stateFromTeamHref(href){
        if(!href) return "";
        const m = href.match(/https?:\/\/([a-z]{2})\.milesplit\.com/i);
        if(m && m[1].toLowerCase() !== "ms"){ // "ms" would be Mississippi, not "middle school"
            return m[1].toUpperCase();
        }
        return "";
    }

    // Normalize a grade token (SR/JR/SO/FR or 9-12 / 7th-8th) to the importer's format.
    function cleanGrade(text){
        if(!text) return "";
        const t = text.trim().toUpperCase().replace(/(ST|ND|RD|TH)$/,"");
        if(/^(FR|SO|JR|SR)$/.test(t)) return t;
        if(/^(1[0-2]|[6-9])$/.test(t)) return t;
        return "";
    }

    // Strip MileSplit annotations off a mark, matching anet.js's cleanMark behavior.
    function cleanMark(mark){
        if(!mark) return "";
        return mark
            .replace(/\s*\([+-]?\d+\.\d+\)/g, "")
            .replace(/\b(?:PB|SB|PR|NR|CR|MR|FR|WL|EL)\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    // Pull event + gender from the section heading nearest a results table,
    // e.g. "Varsity Boys 5000 Meter Run".
    function readHeading(text){
        if(!text) return;
        let t = text.replace(/\n/g,' ').replace(/\s+/g,' ').trim();
        if(!t || /team scores/i.test(t)) return;
        currentEvent = t;
        const lower = t.toLowerCase();
        if(lower.includes("women") || lower.includes("girl") || lower.includes("female")) currentGender = "Girls";
        else if(lower.includes("men") || lower.includes("boy") || lower.includes("male")) currentGender = "Boys";
    }

    // A results row is an individual finish: has an athlete link (/athletes/) AND a mark.
    // Team-score rows link to /teams/ only and have no /athletes/ link, so they're skipped.
    function parseRow(tr){
        const athleteLink = tr.querySelector('a[href*="/athletes/" i], a[href*="/athlete/" i]');
        if(!athleteLink) return; // not an individual result row

        const teamLink = tr.querySelector('a[href*="/teams/" i], a[href*="/team/" i]');
        const cells = Array.from(tr.querySelectorAll('td'));
        if(cells.length < 3) return;

        const name = athleteLink.innerText.trim();
        const school = teamLink ? teamLink.innerText.trim() : "Unattached";
        const state = teamLink ? stateFromTeamHref(teamLink.getAttribute('href')) : "";

        // Place: first purely-numeric cell.
        let place = "";
        for(const c of cells){
            const txt = c.innerText.trim();
            if(/^\d+$/.test(txt)){ place = txt; break; }
        }

        // Grade: the athlete cell usually holds "Name SR". Grab the trailing token,
        // else scan cells for a grade-looking value.
        let grade = "";
        const athleteCell = athleteLink.closest('td') || athleteLink.parentElement;
        if(athleteCell){
            const after = athleteCell.innerText.replace(name, "").trim();
            grade = cleanGrade(after.split(/\s+/).pop());
        }
        if(!grade){
            for(const c of cells){
                const g = cleanGrade(c.innerText.trim());
                if(g){ grade = g; break; }
            }
        }

        // Mark: a time (mm:ss.xx) or distance-looking cell that isn't the name/school.
        let mark = "";
        for(const c of cells){
            const txt = c.innerText.trim();
            if(!txt || txt === name || txt === school) continue;
            if(/(\d+[:.]\d+)|(\d+['"])|(\d+-\d+)/.test(txt)){ mark = txt; break; }
        }
        mark = cleanMark(mark);

        if(name && mark && place && !isNaN(parseInt(place))){
            const row = [
                currentEvent, place, grade, name, mark, school, currentHeat, currentGender, state
            ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(",");
            csvRows.add(row);
        }
    }

    // Walk the document top-to-bottom: update event/gender at each heading, then parse
    // every table row under it. Skip the Team Scores table entirely.
    function parseVisible(){
        const nodes = document.querySelectorAll('h1,h2,h3,h4,h5,h6,.event-title,.division-title,table');
        nodes.forEach(node => {
            if(/^H[1-6]$/.test(node.tagName) || node.classList.contains('event-title') || node.classList.contains('division-title')){
                readHeading(node.innerText.trim());
                return;
            }
            if(node.tagName === 'TABLE'){
                // Detect a team-scores table by its header cells (Pts / Avg / Spread) and skip it.
                const headText = (node.querySelector('thead')?.innerText || node.querySelector('tr')?.innerText || "").toLowerCase();
                if(headText.includes('spread') || headText.includes('displacer') || (headText.includes('pts') && headText.includes('avg'))) return;
                node.querySelectorAll('tbody tr, tr').forEach(parseRow);
            }
        });
    }

    // --- Light auto-scroll to force any lazy-loaded rows to render, then parse. ---
    const loader = document.createElement('div');
    loader.style.cssText = 'position:fixed;top:20px;right:20px;background:#0284c7;color:#fff;padding:15px;z-index:999999;border-radius:8px;font-family:sans-serif;font-weight:bold;box-shadow:0 4px 6px rgba(0,0,0,0.3);';
    loader.innerText = 'Scraping MileSplit results...';
    document.body.appendChild(loader);

    window.scrollTo(0, 0);
    let lastHeight = 0, stable = 0;
    const timer = setInterval(() => {
        parseVisible();
        window.scrollBy(0, window.innerHeight * 50);
        const h = document.documentElement.scrollHeight;
        if(h === lastHeight){
            stable++;
            if(stable > 2){ clearInterval(timer); finishScrape(); }
        } else { stable = 0; lastHeight = h; }
    }, 60);

    function finishScrape(){
        parseVisible(); // final pass at the bottom
        document.body.removeChild(loader);
        const finalArray = Array.from(csvRows);
        window.scrollTo(0, 0);
        if(finalArray.length > 1){
            showFallbackUI(finalArray.join("\n"), finalArray.length - 1);
        } else {
            alert("Found 0 results. Open a MileSplit results page (Formatted view) and try again.");
        }
    }

    function showFallbackUI(csvString, count){
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;font-family:sans-serif;';

        const title = document.createElement('h2');
        title.innerText = `Scraping Complete — ${count} results.`;
        title.style.cssText = 'color:white;margin-bottom:10px;';

        const subTitle = document.createElement('p');
        subTitle.innerText = 'Press Ctrl+C (or Cmd+C) to copy, then paste into the CSV Import Engine.';
        subTitle.style.cssText = 'color:#ddd;margin-bottom:20px;';

        const textArea = document.createElement('textarea');
        textArea.value = csvString;
        textArea.style.cssText = 'width:80%;max-width:1000px;height:60%;margin-bottom:20px;padding:10px;font-family:monospace;white-space:pre;overflow:auto;border-radius:4px;border:none;';

        const closeBtn = document.createElement('button');
        closeBtn.innerText = 'Close Window';
        closeBtn.style.cssText = 'padding:12px 24px;font-size:16px;cursor:pointer;background:#dc3545;color:white;border:none;border-radius:4px;font-weight:bold;';
        closeBtn.onclick = () => document.body.removeChild(overlay);

        overlay.appendChild(title);
        overlay.appendChild(subTitle);
        overlay.appendChild(textArea);
        overlay.appendChild(closeBtn);
        document.body.appendChild(overlay);

        textArea.focus();
        textArea.select();
    }
})();
