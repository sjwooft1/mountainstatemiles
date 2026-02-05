# 🌙 Dark Mode - Quick Start Guide

## What's New?

Your Mountain State Miles website now has a beautiful dark mode! 

### How Users Use It

1. **Look for the theme button** in the top-right corner of the navbar (🌙 moon or ☀️ sun icon)
2. **Click the button** to toggle between light and dark mode
3. **Your preference is saved** - it will remember your choice next time you visit

### What Changes

**Light Mode (Default):**
- White background
- Black text
- Great for daytime reading

**Dark Mode:**
- Dark gray background (#1a1a1a)
- White text
- Easier on the eyes at night
- Reduces blue light exposure

---

## For Developers

### Where to Find Dark Mode Code

**CSS Variables** (`/assets/main.css`):
- Lines with `:root` contain the color definitions
- `@media (prefers-color-scheme: dark)` handles system preference
- `html[data-theme="dark/light"]` handles manual overrides

**JavaScript** (`/assets/theme-toggle.js`):
- Complete theme manager class
- ~180 lines of code
- Handles all theme switching logic

**HTML Components**:
- `home/index.html` - Has theme toggle button
- `Track/index.html` - Has theme toggle button  
- `news.html` - Has theme toggle button

### How to Test Dark Mode

**In Browser DevTools:**
1. Open DevTools (F12)
2. Go to Rendering tab
3. Find "Emulate CSS media feature prefers-color-scheme"
4. Select "dark" or "light"
5. Watch the site change colors instantly

**Manual Toggle:**
- Click the moon/sun icon in navbar
- See theme change immediately
- Refresh page - theme persists

### Adding Dark Mode to New Pages

To add dark mode support to a new page:

1. **Link the CSS:**
   ```html
   <link rel="stylesheet" href="/assets/main.css">
   ```

2. **Add theme toggle button to navbar:**
   ```html
   <button class="theme-toggle" aria-label="Switch theme">🌙</button>
   ```

3. **Load the theme manager:**
   ```html
   <script src="/assets/theme-toggle.js"></script>
   ```

4. **Use CSS variables:**
   ```css
   .my-element {
     background: var(--bg-primary);
     color: var(--text-primary);
     border: 1px solid var(--border);
   }
   ```

### Available CSS Variables

```css
/* Background Colors */
--bg-primary          /* Main background */
--bg-secondary        /* Secondary/card background */

/* Text Colors */
--text-primary        /* Main text */
--text-secondary      /* Secondary/helper text */
--text-tertiary       /* Tertiary/faded text */

/* UI Elements */
--border              /* Border color */
--border-light        /* Light borders */
--shadow-light        /* Light shadows */
--shadow-medium       /* Medium shadows */

/* Semantic (Theme Independent) */
--success             /* Green - #10b981 */
--danger              /* Red - #ef4444 */
--warning             /* Orange - #f59e0b */
```

### Check Current Theme in JavaScript

```javascript
// Get current theme
const theme = window.themeManager.getCurrentTheme();
console.log(theme); // "light" or "dark"

// Set theme manually
window.themeManager.setTheme('dark');

// Toggle theme
window.themeManager.toggleTheme();
```

---

## Color Palettes

### Light Mode
| Element | Color | Hex |
|---------|-------|-----|
| Background | White | #ffffff |
| Text Primary | Black | #000000 |
| Text Secondary | Gray | #666666 |
| Borders | Light Gray | #e0e0e0 |

### Dark Mode
| Element | Color | Hex |
|---------|-------|-----|
| Background | Dark Gray | #1a1a1a |
| Text Primary | White | #ffffff |
| Text Secondary | Light Gray | #b0b0b0 |
| Borders | Medium Gray | #404040 |

---

## Browser Support

✅ Works in all modern browsers:
- Chrome/Chromium
- Firefox
- Safari
- Edge
- Opera

---

## Troubleshooting

**Theme button not showing?**
- Make sure `/assets/main.css` is linked
- Make sure `/assets/theme-toggle.js` is loaded
- Check browser console for errors

**Theme not persisting?**
- Check if localStorage is enabled
- Try clearing browser cache
- Check private/incognito mode (doesn't persist)

**Colors look wrong?**
- Hard refresh page (Cmd+Shift+R or Ctrl+Shift+R)
- Clear browser cache
- Check if CSS variables are loading

---

## Files You Need to Know About

| File | Purpose | Size |
|------|---------|------|
| `/assets/main.css` | All styles + theme variables | ~25KB |
| `/assets/theme-toggle.js` | Theme manager class | ~3KB |
| `home/index.html` | Homepage with toggle | Updated |
| `Track/index.html` | Track page with toggle | Updated |
| `news.html` | News page with toggle | Updated |

---

## Pro Tips

💡 **For the Best Experience:**
- Light mode is best for daytime/bright environments
- Dark mode is best for evening/night reading
- System automatically detects OS preference on first visit
- Your choice is remembered across all sessions

💡 **For Developers:**
- Always use CSS variables instead of hardcoded colors
- Test your components in both light and dark modes
- Check contrast ratios meet accessibility standards
- Use `var(--bg-primary)` and `var(--text-primary)` consistently

---

**Status:** ✅ Live & Ready to Use  
**Last Updated:** February 3, 2026
