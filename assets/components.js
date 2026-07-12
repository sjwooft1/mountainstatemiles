/**
 * Mountain State Miles - Contextual Component Injector
 * Dynamically swaps navigation layouts for /track/ vs /crosscountry/ paths.
 */

// Global Core Links (Always visible)
const BASE_LINKS = [
    { name: 'Home', url: '/home/' },
    
  ];
  
  // Contextual Sport Navigation configurations
  const SPORT_LINKS = {
    crosscountry: [
      { name: 'XC Meets', url: '/CrossCountry/meets.html' },
      { name: 'XC Rankings', url: '/CrossCountry/rankings.html' },
      { name: 'Schools', url: '/CrossCountry/schools.html' },
      { name: 'Courses', url: '/CrossCountry/courses/course%20viewer.html?course=chick-fil-a' }
    ],
    track: [
      { name: 'Track Meets', url: '/Track/meets.html' },
      { name: 'Track Rankings', url: '/Track/rankings.html' },
      { name: 'Teams', url: '/Track/teams.html' },
      { name: 'Analytics', url: '/Track/analytics.html'},
      { name: 'Athlete', url:'/Track/athlete.html'}
    ],
    default: [
      { name: 'About', url:'/home/about.html'},
      { name: 'Weather', url:'/weather.html'},
      { name: 'Track', url: '/Track/index.html' },
      { name: 'Cross Country', url: '/crosscountry/xc.html' },
    ]
  };
  
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
      
      return `<a href="${resolvedUrl}" class="nav-link ${isActive}">${link.name}</a>`;
    }).join('');
  
    headerContainer.innerHTML = `
      <header class="site-header">
        <div class="header-container">
          <a href="${prefix || 'index.html'}" class="brand-logo">
            <span class="brand-bold">MOUNTAIN STATE</span> MILES
            ${context !== 'default' ? `<span class="sport-badge">${context === 'track' ? 'TRACK' : 'XC'}</span>` : ''}
          </a>
          
          <nav class="desktop-nav">
            ${linksHtml}
            <button class="theme-toggle" aria-label="Toggle theme">🌙</button>
          </nav>
  
          <div class="header-actions-mobile">
            <button class="theme-toggle" aria-label="Toggle theme">🌙</button>
            <button class="mobile-menu-toggle" aria-label="Open Menu">
              <span></span><span></span><span></span>
            </button>
          </div>
        </div>
      </header>
  
      <div class="mobile-sidebar" id="mobile-sidebar">
        <div class="sidebar-backdrop"></div>
        <div class="sidebar-content">
          <div class="sidebar-header">
            <span class="brand-bold">MSM</span> MENU
            <button class="sidebar-close">&times;</button>
          </div>
          <nav class="mobile-nav-links">
            ${linksHtml}
          </nav>
        </div>
      </div>
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
            <h3>MOUNTAIN STATE MILES</h3>
            <p>The premier hub for West Virginia Track & Cross Country data.</p>
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
    const toggleBtn = document.querySelector('.mobile-menu-toggle');
    const closeBtn = document.querySelector('.sidebar-close');
    const sidebar = document.getElementById('mobile-sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
  
    if (!toggleBtn || !sidebar) return;
  
    toggleBtn.addEventListener('click', () => sidebar.classList.add('open'));
    closeBtn.addEventListener('click', () => sidebar.classList.remove('open'));
    backdrop.addEventListener('click', () => sidebar.classList.remove('open'));
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