javascript:(async function(){
    console.log("--- SCRAPING ATHLETIC.NET (AUTO-SCROLLING ENGINE) ---");
    
    // Use a Set to automatically handle deduplication across scroll chunks
    let csvRows = new Set(["event_name,place,grade,athlete_name,mark,school,heat,gender"]);
    let currentEvent = "Unknown Event";
    let currentGender = "Boys";
    let currentHeat = "1";

    function cleanMark(mark){
        if(!mark) return "";
        return mark
            .replace(/\s*\([+-]?\d+\.\d+\)/g, "")
            .replace(/[aAsS]+$/g, "")
            .replace(/\b(?:PB|SB|PR|NR|CR|MR|FR|WL|EL)\b/gi, "")
            .replace(/(?:a|s)?(?:PB|SB|PR|NR|CR|MR|FR|WL|EL)$/gi, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function parseVisible() {
        const allElements = document.querySelectorAll('h2, h3, h4, h5, h6, .event-title, .division-title, tr, div.result-row, li.list-group-item');
        
        allElements.forEach(el => {
            // 1. UPDATE EVENT & GENDER IF HEADER
            if (el.tagName.match(/^H[1-6]$/) || el.classList.contains('event-title') || el.classList.contains('division-title')) {
                let text = el.innerText.trim().replace(/\n/g,' ').replace(/\s+/g,' ');
                if(text.toLowerCase().includes("team scores") || text === "") return;
                
                currentEvent = text
                    .replace(/\s-\s\d{2}"(?:\s?\/\s?\d\.\d{3}m)?/, "")
                    .replace(/\s-\s\d+(?:\.\d+)?\s?(?:kg|lb)\b/i, "")
                    .replace(/\b(\d)x(\d{2,4})\sRelay\b/i, (match, legs, dist) => `${legs}x${dist}m Relay`);

                let lowerEvent = currentEvent.toLowerCase();
                if(lowerEvent.includes("women") || lowerEvent.includes("girl") || lowerEvent.includes("female")){
                    currentGender = "Girls";
                } else if(lowerEvent.includes("men") || lowerEvent.includes("boy") || lowerEvent.includes("male")){
                    currentGender = "Boys";
                }
                return;
            }

            // 2. SKIP HEAT HEADERS
            if(el.querySelector('th') || el.tagName === 'TH' || el.classList.contains('heat-header')){
                const text = el.innerText.toLowerCase();
                if(text.includes('heat') || text.includes('flight')){
                    currentHeat = text.replace(/[^0-9]/g, '');
                }
                return;
            }

            // 3. PARSE ROW DATA
            const cells = Array.from(el.querySelectorAll('td, .col, div[class*="cell"]'));
            if(cells.length < 3) return; 

            let name = "", school = "", grade = "", place = "", mark = "";

            const athleteLink = el.querySelector('a[href*="/athlete/" i], a[href*="Athlete.aspx" i]');
            if (athleteLink) name = athleteLink.innerText.trim();

            const schoolLink = el.querySelector('a[href*="/team/" i], a[href*="/school/" i], a[href*="School.aspx" i]');
            if (schoolLink) school = schoolLink.innerText.trim();

            cells.forEach(cell => {
                const text = cell.innerText.trim();
                if (!text || text === name || text === school) return;

                if (!place && /^\d+\.$|^\d+$/.test(text) && parseInt(text) > 0 && parseInt(text) < 200) {
                    place = text.replace('.', '');
                    return;
                }

                if (!grade && (cell.classList.contains('yr') || cell.classList.contains('grade') || /^(1[0-2]|[6-9]|FR|SO|JR|SR|7th|8th)$/i.test(text))) {
                    grade = text.replace(/th|nd|rd|st/i, '');
                    return;
                }

                if (!mark && (/(\d+[:.]\d+)|(\d+['"])|(\d+[-]\d+)/.test(text))) {
                    mark = text;
                    return;
                }
            });

            mark = cleanMark(mark);
            if(!school) school = "Unattached";

            if (currentEvent.toLowerCase().includes('relay') || currentEvent.toLowerCase().includes('shuttle')) {
                if (!name && school) name = school; 
                grade = ""; 
            }

            // 4. SAVE DATA
            if(name && mark && place && !isNaN(parseInt(place))) {
                const cleanRow = [
                    `"${currentEvent.replace(/"/g,'""')}"`,
                    `"${place.replace(/"/g,'""')}"`,
                    `"${grade.replace(/"/g,'""')}"`,
                    `"${name.replace(/"/g,'""')}"`,
                    `"${mark.replace(/"/g,'""')}"`,
                    `"${school.replace(/"/g,'""')}"`,
                    `"${currentHeat.replace(/"/g,'""')}"`,
                    `"${currentGender}"`
                ].join(",");
                
                csvRows.add(cleanRow);
            }
        });
    }

    // --- AUTO-SCROLL LOGIC ---
    let scrollAttempts = 0;
    
    const loader = document.createElement('div');
    loader.style.cssText = 'position:fixed;top:20px;right:20px;background:#28a745;color:#fff;padding:15px;z-index:999999;border-radius:8px;font-family:sans-serif;font-weight:bold;box-shadow:0 4px 6px rgba(0,0,0,0.3);';
    loader.innerText = 'Scraping results... Please wait while the page auto-scrolls.';
    document.body.appendChild(loader);

    window.scrollTo(0, 0); 

    const timer = setInterval(() => {
        parseVisible();
        
        window.scrollBy(0, window.innerHeight * 100);
        
        let currentHeight = document.documentElement.scrollHeight;
        let windowBottom = window.scrollY + window.innerHeight;
        
        if (windowBottom >= currentHeight - 50) {
            scrollAttempts++;
            if (scrollAttempts > 2) {
                clearInterval(timer);
                finishScrape();
            }
        } else {
            scrollAttempts = 0;
        }
    }, 50); 

    function finishScrape() {
        document.body.removeChild(loader);
        const finalArray = Array.from(csvRows);
        
        if (finalArray.length > 1) {
            const csvString = finalArray.join("\n");
            showFallbackUI(csvString, finalArray.length - 1);
        } else {
            alert(`❌ Found 0 results. Make sure you are on a results page.`);
        }
        window.scrollTo(0, 0);
    }

    function showFallbackUI(csvString, count) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;font-family:sans-serif;';
        
        const title = document.createElement('h2');
        title.innerText = `✅ Scraping Complete! Found ${count} results.`;
        title.style.cssText = 'color:white;margin-bottom:10px;';
        
        const subTitle = document.createElement('p');
        subTitle.innerText = 'Press Ctrl+C (or Cmd+C) to copy, then paste into your spreadsheet.';
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
        
        // Auto-highlight the text so it's ready to copy
        textArea.focus();
        textArea.select();
    }
})();