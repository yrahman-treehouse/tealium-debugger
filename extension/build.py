#!/usr/bin/env python3
"""Build the Chrome extension shell that runs tampermonkey.user.js.

The extension is a LOADER, not a copy of the debugger. It ships the current
userscript only as a seed, so it works offline from the first page load. After
that, background.js fetches the userscript from the repo's latest GitHub release
and registers it through chrome.userScripts, so script changes reach every
install without rebuilding or reinstalling the extension.

    dist/extension/                            load this with "Load unpacked"
    dist/tealium-debugger-extension-<v>.zip    the same, zipped, for a release

The shell has its own version (extension/SHELL_VERSION). Bump it only when the
shell itself changes: manifest, background.js, or a new site in @match (host
permissions are fixed at install time, so a new domain needs a new shell).

Standard library only. Run from anywhere:  python3 extension/build.py
Prints "<shell version> <script version>", and appends shell=, script= and zip=
to $GITHUB_OUTPUT when that is set (the release workflow reads them).
"""
import json
import os
import re
import shutil
import struct
import sys
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tampermonkey.user.js')
HERE = os.path.join(ROOT, 'extension')
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(DIST, 'extension')

DESCRIPTION = ('Runs the Treehouse Tealium debugger and keeps it current from GitHub: '
               'utag events, Tealium beacons and the vendor pixels they fire.')
assert len(DESCRIPTION) <= 132, len(DESCRIPTION)
VERSION_RE = r'(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}'


def header(src):
    """Return {key: [values]} from the ==UserScript== block."""
    m = re.search(r'// ==UserScript==(.*?)// ==/UserScript==', src, re.S)
    if not m:
        sys.exit('no ==UserScript== header in ' + SRC)
    out = {}
    for line in m.group(1).splitlines():
        hm = re.match(r'\s*//\s*@(\S+)\s+(.*\S)\s*$', line)
        if hm:
            out.setdefault(hm.group(1), []).append(hm.group(2))
    return out


def valid_version(v, what):
    # Chrome takes 1-4 dot-separated integers, each 0-65535, no leading zeros.
    if not re.fullmatch(VERSION_RE, v):
        sys.exit('%s %r is not a valid Chrome extension version' % (what, v))
    return v


def png(size, draw):
    """Minimal RGBA PNG writer; draw(x, y) -> (r, g, b, a)."""
    raw = b''.join(b'\x00' + b''.join(bytes(draw(x, y)) for x in range(size))
                   for y in range(size))

    def chunk(kind, data):
        c = kind + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def icon(size, off=False):
    # The console's utag.view green (PILL_VIEW) with a white "T", rounded corners.
    # The off variant is the same T in muted grey: the toolbar shows it on every
    # site the debugger does not run on, so the icon itself says on/off without
    # a badge.
    white, clear = (255, 255, 255, 255), (0, 0, 0, 0)
    green = (0x6b, 0x6b, 0x6b, 255) if off else (0x1b, 0x7f, 0x3b, 255)
    if off:
        white = (0xd0, 0xd0, 0xd0, 255)
    r = size * 0.18

    def draw(x, y):
        cx, cy = x + 0.5, y + 0.5
        for ox, oy in ((r, r), (size - r, r), (r, size - r), (size - r, size - r)):
            if (cx < r or cx > size - r) and (cy < r or cy > size - r):
                if (cx - ox) ** 2 + (cy - oy) ** 2 > r * r and abs(cx - ox) <= r and abs(cy - oy) <= r:
                    return clear
        fx, fy = cx / size, cy / size
        if 0.22 <= fy <= 0.36 and 0.2 <= fx <= 0.8:
            return white
        if 0.36 <= fy <= 0.8 and 0.42 <= fx <= 0.58:
            return white
        return green

    return png(size, draw)


def main():
    with open(SRC, encoding='utf-8') as f:
        src = f.read()
    h = header(src)
    script_version = valid_version(h['version'][0], '@version')
    # The pill shows VERSION from inside the script; it must match the header.
    vm = re.search(r"^\s*var VERSION = '([^']*)';", src, re.M)
    if not vm or vm.group(1) != script_version:
        sys.exit("var VERSION = '%s' in tampermonkey.user.js does not match @version %s; "
                 "bump both together" % (vm.group(1) if vm else '<missing>', script_version))
    with open(os.path.join(HERE, 'SHELL_VERSION'), encoding='utf-8') as f:
        shell_version = valid_version(f.read().strip(), 'SHELL_VERSION')
    matches = h.get('match', [])
    if not matches:
        sys.exit('no @match lines in the userscript header')

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(os.path.join(OUT, 'icons'))

    manifest = {
        'manifest_version': 3,
        'name': h['name'][0],
        'short_name': 'Tealium capture',
        'version': shell_version,
        'description': DESCRIPTION,
        'homepage_url': 'https://github.com/yrahman-treehouse/tealium-debugger',
        # chrome.userScripts with world MAIN. From 138 it is switched on per
        # extension by the "Allow User Scripts" toggle; before that by
        # Developer mode, which an unpacked install has on anyway.
        'minimum_chrome_version': '120',
        'icons': {s: 'icons/%s.png' % s for s in ('16', '48', '128')},
        'action': {
            'default_title': 'Tealium event capture',
            'default_icon': {s: 'icons/%s.png' % s for s in ('16', '48')},
        },
        'background': {'service_worker': 'background.js'},
        # userScripts: run the debugger. storage: keep the last good script.
        # alarms: the periodic GitHub check. The GitHub API and raw hosts send
        # Access-Control-Allow-Origin: *, so they need no host permission.
        # downloads: the ↻ click fetches the new extension zip and shows it in
        # Finder, since an unpacked extension cannot replace its own files.
        'permissions': ['userScripts', 'storage', 'alarms', 'downloads'],
        # The sites the debugger may run on, read from @match at build time.
        # A script fetched later can narrow this list but never widen it.
        'host_permissions': matches,
    }
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')
    shutil.copyfile(SRC, os.path.join(OUT, 'seed.user.js'))
    shutil.copyfile(os.path.join(HERE, 'background.js'), os.path.join(OUT, 'background.js'))
    for s in (16, 48, 128):
        with open(os.path.join(OUT, 'icons', '%d.png' % s), 'wb') as f:
            f.write(icon(s))
    for s in (16, 48):           # toolbar sizes only; see icon(off=True)
        with open(os.path.join(OUT, 'icons', 'off-%d.png' % s), 'wb') as f:
            f.write(icon(s, off=True))

    zip_path = os.path.join(DIST, 'tealium-debugger-extension-%s.zip' % shell_version)
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(OUT):
            for name in sorted(files):
                full = os.path.join(base, name)
                z.write(full, os.path.relpath(full, OUT))

    print(shell_version, script_version)
    gh_out = os.environ.get('GITHUB_OUTPUT')
    if gh_out:
        with open(gh_out, 'a', encoding='utf-8') as f:
            f.write('shell=%s\nscript=%s\nzip=%s\n'
                    % (shell_version, script_version, os.path.relpath(zip_path, ROOT)))


if __name__ == '__main__':
    main()
