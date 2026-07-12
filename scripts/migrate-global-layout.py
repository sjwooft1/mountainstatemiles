#!/usr/bin/env python3
"""Migrates HTML pages to use global header/footer via components.js"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HEAD_ASSETS = """
  <link rel="stylesheet" href="/assets/main.css" />
  
  <script src="/assets/theme-toggle.js" defer></script>
  <script src="/assets/components.js" defer></script>"""

MOBILE_MENU_RE = re.compile(
    r"\s*const menuToggle = document\.querySelector\(['\"]\.mobile-menu-toggle['\"]\);"
    r"[\s\S]*?"
    r"navMenu\.classList\.remove\(['\"]mobile-open['\"]\);\s*\}\s*\);\s*\}\s*\)",
    re.MULTILINE,
)


def find_html_files(directory):
    files = []
    for dirpath, dirnames, filenames in os.walk(directory):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git')]
        for name in filenames:
            if name.endswith('.html'):
                files.append(os.path.join(dirpath, name))
    return files


def ensure_head_assets(content):
    if 'components.js' in content:
        content = re.sub(
            r'\s*<script src="(\.\./)?(/assets/)?theme-toggle\.js"></script>\s*',
            '\n',
            content,
        )
        return content
    return content.replace('</head>', HEAD_ASSETS + '\n</head>')


def remove_legacy_nav(content):
    content = re.sub(r'\s*<header>[\s\S]*?</header>\s*', '\n', content, flags=re.IGNORECASE)
    content = re.sub(r'\s*<footer>[\s\S]*?</footer>\s*', '\n', content, flags=re.IGNORECASE)
    content = re.sub(
        r'\s*<script src="(\.\./)?(/assets/)?theme-toggle\.js"></script>\s*',
        '\n',
        content,
    )
    content = MOBILE_MENU_RE.sub('\n', content)
    return content


def ensure_global_shell(content):
    if 'id="global-header"' not in content:
        content = re.sub(
            r'(<body[^>]*>)',
            r'\1\n\n  <div id="global-header"></div>\n',
            content,
            count=1,
            flags=re.IGNORECASE,
        )
    if 'id="global-footer"' not in content:
        content = re.sub(
            r'</body>',
            '\n  <div id="global-footer"></div>\n\n</body>',
            content,
            count=1,
            flags=re.IGNORECASE,
        )
    return content


def ensure_main_wrapper(content):
    if re.search(r'<main[\s>]', content, re.IGNORECASE):
        def add_content_section(match):
            class_attr = match.group(1)
            classes = match.group(2)
            if not class_attr:
                return '<main class="content-section"'
            if classes and 'content-section' in classes:
                return match.group(0)
            return f'<main class="content-section {classes.strip()}"'

        return re.sub(r'<main(\s+class="([^"]*)")?', add_content_section, content, flags=re.IGNORECASE)

    header_marker = '<div id="global-header"></div>'
    footer_marker = '<div id="global-footer"></div>'
    header_idx = content.find(header_marker)
    footer_idx = content.find(footer_marker)
    if header_idx == -1 or footer_idx == -1 or footer_idx <= header_idx:
        return content

    before = content[: header_idx + len(header_marker)]
    middle = content[header_idx + len(header_marker) : footer_idx]
    after = content[footer_idx:]
    trimmed = middle.strip()
    if not trimmed or trimmed.startswith('<main'):
        return content

    middle = middle.lstrip('\n')
    return f"{before}\n\n  <main class=\"content-section\">\n{middle}\n  </main>\n\n{after}"


def dedupe_main_css(content):
    seen = False
    lines = content.split('\n')
    result = []
    for line in lines:
        if re.match(r'^\s*<link rel="stylesheet" href="/assets/main\.css"\s*/?>\s*$', line):
            if seen:
                continue
            seen = True
            result.append('  <link rel="stylesheet" href="/assets/main.css" />')
        else:
            result.append(line)
    return '\n'.join(result)


def process_file(file_path):
    rel = os.path.relpath(file_path, ROOT)
    if rel == 'index.html':
        return rel, 'skipped'

    with open(file_path, 'r', encoding='utf-8') as f:
        original = f.read()

    content = original
    content = remove_legacy_nav(content)
    content = ensure_head_assets(content)
    content = ensure_global_shell(content)
    content = ensure_main_wrapper(content)
    content = dedupe_main_css(content)
    content = re.sub(r'\n{4,}', '\n\n\n', content)

    if content != original:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return rel, 'changed'
    return rel, 'unchanged'


def main():
    files = find_html_files(ROOT)
    changed = []
    for file_path in files:
        rel, status = process_file(file_path)
        if status == 'changed':
            changed.append(rel)

    print(f'Processed {len(files)} files')
    print(f'Changed: {len(changed)}')
    for rel in changed:
        print(f'  - {rel}')


if __name__ == '__main__':
    main()
