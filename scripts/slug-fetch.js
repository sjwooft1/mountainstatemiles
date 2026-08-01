(function() {
    'use strict';

    // 1. Create the floating button element
    const btn = document.createElement('button');
    btn.innerHTML = '📋 Extract HS Slugs';

    // Style the floating button
    btn.style.position = 'fixed';
    btn.style.bottom = '20px';
    btn.style.right = '40px';
    btn.style.zIndex = '999999';
    btn.style.padding = '12px 18px';
    btn.style.backgroundColor = '#10b981'; // Green theme to match success state
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.fontWeight = 'bold';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)';

    // Button click behavior
    btn.onclick = function() {
        // Division checking and formatting functions
        const isMiddleSchoolFallback = name => /(middle|junior|ms\b|jh\b|intermediate|int\b|youth|club)/i.test(name);

        const getDivisionForLink = link => {
            let current = link;
            for (let i = 0; i < 8; i++) {
                if (!current || current === document.body) break;

                const heading = current.querySelector('h1, h2, h3, h4, h5, h6, .division-header, [class*="header"]');
                if (heading) {
                    const text = heading.textContent.toLowerCase();
                    if (text.includes('middle') || text.includes('junior') || text.includes('ms') || text.includes('jh')) return 'ms';
                    if (text.includes('high') || text.includes('hs') || text.includes('varsity')) return 'hs';
                }

                let sibling = current.previousElementSibling;
                while (sibling) {
                    const text = sibling.textContent.toLowerCase();
                    if (sibling.matches('h1, h2, h3, h4, h5, h6, .division-header, [class*="header"]') || text.includes('school') || text.includes('high') || text.includes('middle')) {
                        if (text.includes('middle') || text.includes('junior') || text.includes('ms') || text.includes('jh')) return 'ms';
                        if (text.includes('high') || text.includes('hs') || text.includes('varsity')) return 'hs';
                    }
                    sibling = sibling.previousElementSibling;
                }

                current = current.parentElement;
            }
            return isMiddleSchoolFallback(link.textContent) ? 'ms' : 'hs';
        };

        const extractCleanName = link => {
            const clone = link.cloneNode(true);
            const logoElements = clone.querySelectorAll('img, .teams-list-logo-box, [class*="logo"], [class*="image"]');
            logoElements.forEach(el => el.remove());
            return clone.textContent.replace(/\s+/g, ' ').trim();
        };

        const toSlug = name => {
            let cleanName = name.toLowerCase().trim();
            cleanName = cleanName
                .replace(/\bhigh school\b/g, '')
                .replace(/\bmiddle school\b/g, '')
                .replace(/\bjunior high\b/g, '')
                .replace(/\btrack club\b/g, '')
                .replace(/\bhigh\b/g, '')
                .replace(/\bschool\b/g, '')
                .replace(/&/g, 'and')
                .trim();

            const exceptions = {
                "south charleston": "so-charleston",
                "woodrow wilson": "woodrow",
                "buckhannon-upshur": "buckhannon"
            };

            if (exceptions[cleanName]) return exceptions[cleanName];

            return cleanName
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-+|-+$/g, '');
        };

        // Extract only High School teams
        const uniqueSlugs = new Set();
        const links = document.querySelectorAll('a[href*="/team/"]');

        links.forEach(link => {
            const name = extractCleanName(link);
            if (name && name.length > 2 && !name.includes('Roster') && !name.includes('Results') && !name.includes('Home') && !name.toLowerCase().includes('athletic')) {
                const isMS = getDivisionForLink(link) === 'ms';
                if (!isMS) {
                    uniqueSlugs.add(toSlug(name));
                }
            }
        });

        const sortedOutput = Array.from(uniqueSlugs).sort().join(', ');

        // Safe background copy using Tampermonkey API
        if (sortedOutput) {
            GM_setClipboard(sortedOutput);
            console.log(`%c✅ Copied ${uniqueSlugs.size} High School slugs to your clipboard!`, 'color: #10b981; font-weight: bold; font-size: 14px;');
            console.log(sortedOutput);

            // Visual feedback on the button itself
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅ Copied!';
            btn.style.backgroundColor = '#059669';
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.backgroundColor = '#10b981';
            }, 2000);
        } else {
            console.warn("⚠️ No High School teams found on this page.");
        }
    };

    // Append the floating button to the web page
    document.body.appendChild(btn);
})();

