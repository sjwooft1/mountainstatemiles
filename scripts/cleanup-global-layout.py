#!/usr/bin/env python3
"""Cleanup pass after global layout migration."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MOBILE_MENU_PATTERNS = [
    re.compile(
        r"[ \t]*const menuToggle = document\.querySelector\(\s*['\"]\.mobile-menu-toggle['\"]\s*\);\s*\n"
        r"[ \t]*const navMenu = document\.getElementById\(\s*['\"]main-nav['\"]\s*\);\s*\n"
        r"(?:[ \t]*\n)?"
        r"[ \t]*if \(menuToggle && navMenu\) \{[\s\S]*?[ \t]*\}\s*\n?",
        re.MULTILINE,
    ),
    re.compile(
        r"[ \t]*document\.querySelector\(['\"]\.mobile-menu-toggle['\"]\)\.addEventListener\(['\"]click['\"], \(\) => \{[\s\S]*?\}\);\s*\n?",
        re.MULTILINE,
    ),
]

INJECTED_EXPORT_SCRIPTS = re.compile(
    r"(</style>)\s*\n\s*<script src=\"/assets/theme-toggle\.js\" defer></script>\s*"
    r"\n\s*<script src=\"/assets/components\.js\" defer></script>\s*\n(</head><body>)",
    re.MULTILINE,
)

SITE_NAV_HEADER = re.compile(r"\s*<header class=\"site-nav\">[\s\S]*?</header>\s*", re.MULTILINE)


def find_html_files(directory):
    files = []
    for dirpath, dirnames, filenames in os.walk(directory):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git', 'scripts')]
        for name in filenames:
            if name.endswith('.html'):
                files.append(os.path.join(dirpath, name))
    return files


def cleanup(content):
    for pattern in MOBILE_MENU_PATTERNS:
        content = pattern.sub('\n', content)
    content = INJECTED_EXPORT_SCRIPTS.sub(r'\1\n\2', content)
    content = SITE_NAV_HEADER.sub('\n', content)
    return content


def main():
    changed = []
    for file_path in find_html_files(ROOT):
        with open(file_path, 'r', encoding='utf-8') as f:
            original = f.read()
        content = cleanup(original)
        if content != original:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            changed.append(os.path.relpath(file_path, ROOT))
    print(f'Cleaned {len(changed)} files')
    for rel in changed:
        print(f'  - {rel}')


if __name__ == '__main__':
    main()
