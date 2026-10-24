/**
 * Mountain State Miles - Contextual Component Injector
 * Dynamically swaps navigation layouts for /track/ vs /crosscountry/ paths.
 */

// Global Core Links (Always visible)
const BASE_LINKS = [
    { name: 'Home', url: '/home/' },
    { name: 'News', url: '/news' },
  ];
  
  // Contextual Sport Navigation configurations
  const SPORT_LINKS = {
    crosscountry: [
      { name: 'XC Meets', url: 'CrossCountry/meets.html' },
      { name: 'XC Rankings', url: 'CrossCountry/rankings.html' },
      { name: 'Schools', url: 'CrossCountry/schools.html' },
      { name: 'Courses', url: 'CrossCountry/courses/course%20viewer.html' },
      { name: 'XC Simulator', url: '/CrossCountry/simulator.html' },
      { name: 'Training Paces', url: '/CrossCountry/paces.html' },
      { name: 'Portal', url: '/Portal/portal.html' },
      { name: 'Fantasy', url: '/Fantasy/index.html' },
      { name: 'Track Home', url: '/Track/index.html' },
    ],
    track: [
      { name: 'Track Meets', url: '/Track/meets.html' },
      { name: 'Track Rankings', url: '/Track/rankings.html' },
      { name: 'Teams', url: '/Track/teams.html' },
      { name: 'Events', url: '/Track/events.html' },
      { name: 'Analytics', url: '/Track/analytics.html'},
      { name: 'Portal', url: '/Portal/portal.html' },
      { name: 'Fantasy', url: '/Fantasy/index.html' },
      { name: 'Cross Country', url: '/CrossCountry/xc.html' },
    ],
    default: [
      { name: 'About', url:'/home/about.html'},
      { name: 'Track', url: '/Track/index.html' },
      { name: 'Cross Country', url: '/CrossCountry/xc.html' },
      { name: 'Portal', url: '/Portal/portal.html' },
      { name: 'Fantasy', url: '/Fantasy/index.html' },
    ]
  };
  
  // ---- Sport / nav icon set (inline SVG, currentColor so they theme cleanly) ----
  const ICONS = {
    xc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18l5.5-9 3.5 5.5 3-6.5L22 18z"/><path d="M6 18c2-2 4-1 5-3" stroke-dasharray="2 2.4"/><circle cx="17.5" cy="5" r="2"/></svg>`,
    track: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="5"/><rect x="6" y="10" width="12" height="4" rx="2"/></svg>`,
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18l5.5-9 3.5 5.5 3-6.5L22 18z"/><circle cx="17.5" cy="5" r="2"/></svg>`,
    news: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="13" height="15" rx="2"/><path d="M17 9h2a2 2 0 012 2v7a2 2 0 01-2 2"/><path d="M7 9h7M7 12h7M7 15h5"/></svg>`,
    about: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.6" fill="currentColor"/></svg>`,
    school: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10l8-5 8 5v10"/><path d="M9 20v-6h6v6"/></svg>`,
    course: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4l6 2 5-2v14l-5 2-6-2-5 2V6z"/><path d="M9 4v14M15 6v14"/></svg>`,
    portal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20V5a1 1 0 011-1h8a1 1 0 011 1v15"/><path d="M4 20h16"/><circle cx="13" cy="12" r="1" fill="currentColor" stroke="none"/></svg>`,
    paces: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.5 2"/><path d="M10 3h4M12 3v3"/></svg>`,
    teams: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M15 19c0-2 1.2-3.6 3-4"/></svg>`,
  };

  function iconForLink(name) {
    const n = name.toLowerCase();
    if (n.includes('track')) return ICONS.track;
    if (n.includes('xc') || n.includes('cross country')) return ICONS.xc;
    if (n.includes('news')) return ICONS.news;
    if (n.includes('about')) return ICONS.about;
    if (n.includes('school')) return ICONS.school;
    if (n.includes('course')) return ICONS.course;
    if (n.includes('portal')) return ICONS.portal;
    if (n.includes('pace')) return ICONS.paces;
    if (n.includes('team')) return ICONS.teams;
    return ICONS.home;
  }

  // Computes the absolute depth mapping relative to the domain root
  function getPathPrefix() {
    const path = window.location.pathname;
    if (path === '/' || path.endsWith('/index.html')) {
      return '';
    }
    const segments = path.split('/').filter(s => s.length > 0);
    if (segments.length <= 1) return '';
    return '../'.repeat(segments.length - 1);
  }
  
  // Detects the sport category using path classification
  function getCurrentSportContext() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/crosscountry') || path.includes('/xc')) {
      return 'crosscountry';
    }
    if (path.includes('/track')) {
      return 'track';
    }
    return 'default';
  }
  
  function injectHeader() {
    const headerContainer = document.getElementById('global-header');
    if (!headerContainer) return;
  
    const prefix = getPathPrefix();
    const currentPath = window.location.pathname;
    const context = getCurrentSportContext();
  
    // Merge foundational core items with contextual sport navigation modules
    const currentNavConfig = [...BASE_LINKS, ...SPORT_LINKS[context]];
  
    const linksHtml = currentNavConfig.map(link => {
      const resolvedUrl = prefix + link.url;
      // Highlight if current url path structure contains the exact link criteria
      const isActive = currentPath.includes(link.url.split('.')[0]) ? 'active' : '';
      
      return `<a href="${resolvedUrl}" class="nav-link ${isActive}"><span class="nav-ico">${iconForLink(link.name)}</span>${link.name}</a>`;
    }).join('');

    // Full-screen expand links — big rows with icons and staggered entrance
    const megaLinksHtml = currentNavConfig.map((link, i) => {
      const resolvedUrl = prefix + link.url;
      const isActive = currentPath.includes(link.url.split('.')[0]) ? 'active' : '';

      return `<a href="${resolvedUrl}" class="mega-link ${isActive}" style="--i:${i}">
        <span class="mega-ico">${iconForLink(link.name)}</span>
        <span class="mega-name">${link.name}</span>
        <span class="mega-arrow">&rarr;</span>
      </a>`;
    }).join('');
  
    headerContainer.innerHTML = `
      <header class="site-header">
        <div class="header-scene" aria-hidden="true">
          <div class="header-sun"></div>
          <svg class="header-ridges" viewBox="0 0 1440 100" width="100%" height="62" preserveAspectRatio="none">
            <path class="ridge ridge-far" d="M0,60 Q120,30 240,52 T480,44 T720,54 T960,40 T1200,52 T1440,44 L1440,100 L0,100 Z" />
            <path class="ridge ridge-mid" d="M0,78 Q160,56 320,72 T640,64 T960,74 T1280,66 T1440,72 L1440,100 L0,100 Z" />
            <path class="ridge ridge-near" d="M0,92 Q180,80 360,88 T720,84 T1080,90 T1440,86 L1440,100 L0,100 Z" />
          </svg>
          <div class="header-lanes"></div>
        </div>
        
        <div class="header-container">
          <a href="${prefix || 'index.html'}" class="brand-logo" aria-label="Mountain State Miles home">
            <img class="brand-logo-img" src="/assets/images/logo1.svg" alt="Mountain State Miles"
                 width="52" height="52"
                 data-theme-light-src="/assets/images/logo1.svg"
                 data-theme-dark-src="/assets/images/logob.svg" />
            <span class="brand-wordmark"><span class="brand-bold">MOUNTAIN STATE</span> MILES</span>
          </a>
          ${context !== 'default' ? `<span class="sport-badge ${context}" title="${context === 'track' ? 'Track &amp; Field' : 'Cross Country'}">${context === 'track' ? ICONS.track : ICONS.xc}</span>` : ''}
          
          <nav class="desktop-nav">
            ${linksHtml}
            <button class="theme-toggle" aria-label="Toggle theme">🌙</button>
            <button class="mega-toggle" aria-label="Open full menu" aria-expanded="false" aria-controls="mega-menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 18l5.5-9 3.5 5.5 3-6.5L22 18z"/></svg>
              Explore
            </button>
          </nav>
  
          <div class="header-actions-mobile">
            <button class="theme-toggle" aria-label="Toggle theme">🌙</button>
            <button class="mobile-menu-toggle" aria-label="Open Menu" aria-expanded="false" aria-controls="mega-menu">
              <span></span><span></span><span></span>
            </button>
          </div>
        </div>
      </header>
  
      <div class="mega-menu" id="mega-menu" aria-hidden="true">
        <div class="mega-backdrop"></div>
        <div class="mega-scene" aria-hidden="true">
          <div class="mega-sun"></div>
          <svg class="mega-ridges" viewBox="0 0 1440 520" preserveAspectRatio="none">
            <path class="mridge mridge-1" d="M0,300 C120,240 240,290 360,250 C480,210 600,280 720,260 C840,240 960,200 1080,230 C1200,260 1320,240 1440,270 L1440,520 L0,520 Z" />
            <path class="mridge mridge-2" d="M0,360 C160,310 300,350 460,330 C620,310 760,360 920,345 C1080,330 1240,300 1440,340 L1440,520 L0,520 Z" />
            <path class="mridge mridge-3" d="M0,420 C180,380 340,410 520,395 C700,380 860,420 1040,410 C1220,400 1340,385 1440,405 L1440,520 L0,520 Z" />
            <path class="mridge mridge-4" d="M0,470 Q200,440 420,460 T860,455 T1440,465 L1440,520 L0,520 Z" />
          </svg>
        </div>
        <div class="mega-bar">
          <span class="mega-brand">
            <img class="mega-brand-logo" src="/assets/images/logob.svg" alt="" width="44" height="44" />
            <span class="brand-bold">MOUNTAIN STATE</span> MILES
          </span>
          <button class="mega-close" aria-label="Close menu">&times;</button>
        </div>
        <div class="mega-inner">
          <nav class="mega-links">
            ${megaLinksHtml}
          </nav>
        </div>
        <div class="mega-foot">West Virginia&rsquo;s home for Track &amp; Cross Country</div>
      </div>
      <img src="/assets/images/bg.png" alt="Background Image" class="page-background-image" 
      data-theme-light-src="/assets/images/background.png"
      data-theme-dark-src="/assets/images/bg.png" />
    `;
  
    setupMobileMenu();
  }
  
  function injectFooter() {
    const footerContainer = document.getElementById('global-footer');
    if (!footerContainer) return;
  
    const prefix = getPathPrefix();
    const context = getCurrentSportContext();
    const currentYear = new Date().getFullYear();
    const currentNavConfig = [...BASE_LINKS, ...SPORT_LINKS[context]];
  
    footerContainer.innerHTML = `
      <footer class="site-footer">
        <div class="footer-container">
        <div class="footer-brand">
          <img src="/assets/images/MSM runner.svg" alt="Mountain State Miles Logo" class="footer-logo"
               width="120" height="120"
               data-theme-light-src="/assets/images/MSM runner.svg"
               data-theme-dark-src="/assets/images/msmrunner.svg">
          
          <div class="brand-text">
            <h3 class="msm">MOUNTAIN STATE MILES</h3>
            <p>The premier hub for West Virginia Track & Cross Country data.</p>
          </div>
        </div>

          <div class="footer-links">
            <h4>Navigation (${context === 'default' ? 'General' : context === 'track' ? 'Track & Field' : 'Cross Country'})</h4>
            <ul>
              ${currentNavConfig.map(link => `<li><a href="${prefix + link.url}">${link.name}</a></li>`).join('')}
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p>&copy; ${currentYear} Mountain State Miles. All rights reserved.</p>
        </div>
      </footer>
    `;
  }

  
  function setupMobileMenu() {
    const mega = document.getElementById('mega-menu');
    if (!mega) return;

    const openers = document.querySelectorAll('.mega-toggle, .mobile-menu-toggle');
    const closeBtn = mega.querySelector('.mega-close');
    const backdrop = mega.querySelector('.mega-backdrop');

    const open = () => {
      mega.classList.add('open');
      mega.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      openers.forEach(b => b.setAttribute('aria-expanded', 'true'));
    };

    const close = () => {
      mega.classList.remove('open');
      mega.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      openers.forEach(b => b.setAttribute('aria-expanded', 'false'));
    };

    openers.forEach(btn => btn.addEventListener('click', open));
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    mega.querySelectorAll('.mega-link').forEach(l => l.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectHeader();
      injectFooter();
    });
  } else {
    injectHeader();
    injectFooter();
  }