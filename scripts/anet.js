javascript:(function(){
                console.log("--- SCRAPING ATHLETIC.NET (HEURISTIC ENGINE) ---");
                
                // Grab headers and rows together to process the page top-to-bottom
                const allElements = document.querySelectorAll('h2, h3, h4, h5, .event-title, tr, div.result-row, li.list-group-item');
                let csvRows = ["event_name,place,grade,athlete_name,mark,school,heat,gender"];
                let count = 0;
                
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
                
                allElements.forEach(el => {
                    // 1. UPDATE EVENT & GENDER IF HEADER
                    if (el.tagName.match(/^H[1-6]$/) || el.classList.contains('event-title') || el.classList.contains('division-title')) {
                        let text = el.innerText.trim().replace(/\n/g,' ').replace(/\s+/g,' ');
                        
                        // Skip irrelevant headers
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
                        return; // Move to the next element
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
                
                    // Safely extract links (Handles both old and new Athletic.net URL structures)
                    const athleteLink = el.querySelector('a[href*="/athlete/" i], a[href*="Athlete.aspx" i]');
                    if (athleteLink) name = athleteLink.innerText.trim();
                
                    const schoolLink = el.querySelector('a[href*="/team/" i], a[href*="/school/" i], a[href*="School.aspx" i]');
                    if (schoolLink) school = schoolLink.innerText.trim();
                
                    // Iterate over cells to fill in the missing pieces heuristically
                    cells.forEach(cell => {
                        const text = cell.innerText.trim();
                        if (!text) return;
                
                        // Skip if this cell is purely the name or school we already extracted
                        if (name && text === name) return;
                        if (school && text === school) return;
                
                        // Place: First standalone number found
                        if (!place && /^\d+\.$|^\d+$/.test(text) && parseInt(text) > 0 && parseInt(text) < 200) {
                            place = text.replace('.', '');
                            return;
                        }
                
                        // Grade: Check for Athletic.net classes OR standard grade numbers/letters
                        if (!grade && (cell.classList.contains('yr') || cell.classList.contains('grade') || /^(1[0-2]|[6-9]|FR|SO|JR|SR|7th|8th)$/i.test(text))) {
                            grade = text.replace(/th|nd|rd|st/i, '');
                            return;
                        }
                
                        // Mark: Regex looking for time formats (10.55), distances (22-04), or metrics (1.85m)
                        if (!mark && (/(\d+[:.]\d+)|(\d+['"])|(\d+[-]\d+)/.test(text))) {
                            mark = text;
                            return;
                        }
                    });
                
                    mark = cleanMark(mark);
                    if(!school) school = "Unattached";
                
                    // RELAY LOGIC
                    if (currentEvent.toLowerCase().includes('relay') || currentEvent.toLowerCase().includes('shuttle')) {
                        if (!name && school) name = school; // Default to School name if athletes aren't listed
                        grade = ""; // Relays don't have a single grade
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
                
                        if (!csvRows.includes(cleanRow)) {
                            csvRows.push(cleanRow);
                            count++;
                        }
                    }
                });
                
                if(count > 0){
                  const temp = document.createElement("textarea");
                  document.body.appendChild(temp);
                  temp.value = csvRows.join("\n");
                  temp.select();
                  document.execCommand("copy");
                  document.body.removeChild(temp);
                  alert(`✅ Copied ${count} results to clipboard!`);
                } else {
                  alert(`❌ Found 0 results. (Checked ${allElements.length} elements). Make sure the full 'Results' tab is fully loaded on the screen.`);
                }
                })();
                