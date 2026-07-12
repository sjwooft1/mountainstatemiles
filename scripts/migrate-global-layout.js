#!/usr/bin/env node
/**
 * Migrates HTML pages to use global header/footer via components.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function findHtmlFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      findHtmlFiles(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

const HEAD_ASSETS = `
  <link rel="stylesheet" href="/assets/main.css" />
  
  <script src="/assets/theme-toggle.js" defer></script>
  <script src="/assets/components.js" defer></script>`;

const MOBILE_MENU_RE = /\s*const menuToggle = document\.querySelector\(['"]\.mobile-menu-toggle['"]\);[\s\S]*?navMenu\.classList\.remove\(['"]mobile-open['"]\);\s*\}\s*\);\s*\}\s*\)/g;

function ensureHeadAssets(content) {
  if (content.includes('components.js')) {
    content = content.replace(
      /<script src="(\/assets\/)?theme-toggle\.js"><\/script>\s*/g,
      ''
    );
    return content;
  }

  content = content.replace('</head>', `${HEAD_ASSETS}\n</head>`);
  return content;
}

function removeLegacyNav(content) {
  content = content.replace(/\s*<header>[\s\S]*?<\/header>\s*/gi, '\n');
  content = content.replace(/\s*<footer>[\s\S]*?<\/footer>\s*/gi, '\n');
  content = content.replace(/\s*<script src="(\.\.\/)?(\/assets\/)?theme-toggle\.js"><\/script>\s*/g, '\n');
  content = content.replace(MOBILE_MENU_RE, '\n');
  return content;
}

function ensureGlobalShell(content) {
  if (!content.includes('id="global-header"')) {
    content = content.replace(/(<body[^>]*>)/i, '$1\n\n  <div id="global-header"></div>\n');
  }

  if (!content.includes('id="global-footer"')) {
    content = content.replace(/<\/body>/i, '\n  <div id="global-footer"></div>\n\n</body>');
  }

  return content;
}

function ensureMainWrapper(content) {
  if (/<main[\s>]/i.test(content)) {
    content = content.replace(/<main(\s+class="([^"]*)")?/gi, (match, classAttr, classes) => {
      if (!classAttr) return '<main class="content-section"';
      if (classes.includes('content-section')) return match;
      return `<main class="content-section ${classes.trim()}"`;
    });
    return content;
  }

  const headerMarker = '<div id="global-header"></div>';
  const footerMarker = '<div id="global-footer"></div>';
  const headerIdx = content.indexOf(headerMarker);
  const footerIdx = content.indexOf(footerMarker);
  if (headerIdx === -1 || footerIdx === -1 || footerIdx <= headerIdx) return content;

  const before = content.slice(0, headerIdx + headerMarker.length);
  const middle = content.slice(headerIdx + headerMarker.length, footerIdx);
  const after = content.slice(footerIdx);

  const trimmedMiddle = middle.trim();
  if (!trimmedMiddle || trimmedMiddle.startsWith('<main')) return content;

  return `${before}\n\n  <main class="content-section">\n${middle.replace(/^\n+/, '')}\n  </main>\n\n${after}`;
}

function dedupeMainCss(content) {
  let seen = false;
  return content.replace(/^\s*<link rel="stylesheet" href="\/assets\/main\.css"\s*\/?>\s*$/gm, (match) => {
    if (seen) return '';
    seen = true;
    return '  <link rel="stylesheet" href="/assets/main.css" />';
  });
}

function processFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (rel === 'index.html') return { rel, skipped: true };

  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  content = removeLegacyNav(content);
  content = ensureHeadAssets(content);
  content = ensureGlobalShell(content);
  content = ensureMainWrapper(content);
  content = dedupeMainCss(content);

  // Normalize excessive blank lines
  content = content.replace(/\n{4,}/g, '\n\n\n');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    return { rel, changed: true };
  }
  return { rel, changed: false };
}

const files = findHtmlFiles(ROOT);
const results = files.map(processFile);
const changed = results.filter((r) => r.changed);
const skipped = results.filter((r) => r.skipped);

console.log(`Processed ${files.length} files`);
console.log(`Changed: ${changed.length}`);
changed.forEach((r) => console.log(`  - ${r.rel}`));
if (skipped.length) console.log(`Skipped: ${skipped.map((r) => r.rel).join(', ')}`);
