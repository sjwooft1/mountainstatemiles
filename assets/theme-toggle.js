/**
 * Theme Toggle - Light/Dark Mode Manager
 * Handles theme switching with localStorage persistence
 */

class ThemeManager {
  constructor() {
    this.STORAGE_KEY = 'msm-theme';
    this.LIGHT = 'light';
    this.DARK = 'dark';
    this.init();
  }

  /**
   * Initialize theme on page load
   */
  init() {
    // Get saved theme or system preference
    const savedTheme = this.getSavedTheme();
    const preferredTheme = savedTheme || this.getSystemPreference();
    
    this.setTheme(preferredTheme);
    this.setupToggleButton();
    this.watchSystemPreference();
  }

  /**
   * Get theme from localStorage
   */
  getSavedTheme() {
    try {
      return localStorage.getItem(this.STORAGE_KEY);
    } catch (e) {
      console.warn('localStorage not available:', e);
      return null;
    }
  }

  /**
   * Get system color scheme preference
   */
  getSystemPreference() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return this.DARK;
    }
    return this.LIGHT;
  }

  /**
   * Set theme and update DOM
   */
  setTheme(theme) {
    const validTheme = [this.LIGHT, this.DARK].includes(theme) ? theme : this.LIGHT;
    
    // Update data attribute on html element
    document.documentElement.setAttribute('data-theme', validTheme);
    
    // Save to localStorage
    try {
      localStorage.setItem(this.STORAGE_KEY, validTheme);
    } catch (e) {
      console.warn('Could not save theme to localStorage:', e);
    }
    
    // Update toggle button icon
    this.updateToggleIcon(validTheme);
  }

  /**
   * Get current theme
   */
  getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || this.LIGHT;
  }

  /**
   * Toggle between light and dark mode
   */
  toggleTheme() {
    const currentTheme = this.getCurrentTheme();
    const newTheme = currentTheme === this.LIGHT ? this.DARK : this.LIGHT;
    this.setTheme(newTheme);
  }

  /**
   * Setup toggle button click handler
   */
  setupToggleButton() {
    const toggleButton = document.querySelector('.theme-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', () => this.toggleTheme());
      toggleButton.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggleTheme();
        }
      });
    }
  }

  /**
   * Update toggle button icon based on current theme
   */
  updateToggleIcon(theme) {
    const toggleButton = document.querySelector('.theme-toggle');
    if (toggleButton) {
      toggleButton.setAttribute('aria-label', 
        theme === this.LIGHT ? 'Switch to dark mode' : 'Switch to light mode'
      );
      toggleButton.innerHTML = theme === this.LIGHT ? '🌙' : '☀️';
    }
  }

  /**
   * Watch for system theme preference changes
   */
  watchSystemPreference() {
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      // Listen for changes
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', (e) => {
          const savedTheme = this.getSavedTheme();
          
          // Only update if user hasn't manually set a theme
          if (!savedTheme) {
            const newTheme = e.matches ? this.DARK : this.LIGHT;
            this.setTheme(newTheme);
          }
        });
      }
    }
  }
}

// Initialize theme manager when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.themeManager = new ThemeManager();
  });
} else {
  window.themeManager = new ThemeManager();
}
