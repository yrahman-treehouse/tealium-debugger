#!/usr/bin/env python3
"""Build the Chrome extension from tampermonkey.user.js.

The userscript stays the single source. This reads its header (@name, @version,
@match, @run-at) and writes an unpacked MV3 extension plus a zip ready for the
Chrome Web Store:

    dist/extension/                       load this with "Load unpacked"
    dist/tealium-debugger-<version>.zip   upload this to the Web Store

Standard library only. Run from anywhere:  python3 extension/build.py
Prints the version on stdout, and appends version=/zip= to $GITHUB_OUTPUT when
that is set (the release workflow reads them).
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

# The Web Store caps the manifest description at 132 characters, and the
# userscript's own @description is far longer, so the extension has its own.
DESCRIPTION = ('Logs utag events, Tealium beacons and the vendor pixels they fire on '
               'Treehouse sites, with a field picker and JSON/CSV export.')
assert len(DESCRIPTION) <= 132, len(DESCRIPTION)

RUN_AT = {'document-start': 'document_start', 'document-end': 'document_end',
          'document-idle': 'document_idle', 'document-body': 'document_end'}


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


def chrome_version(v):
    # Chrome takes 1-4 dot-separated integers, each 0-65535, no leading zeros.
    if not re.fullmatch(r'(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}', v):
        sys.exit('@version %r is not a valid Chrome extension version' % v)
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


def icon(size):
    # The console's utag.view green (PILL_VIEW) with a white "T", rounded corners.
    green, white, clear = (0x1b, 0x7f, 0x3b, 255), (255, 255, 255, 255), (0, 0, 0, 0)
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
    version = chrome_version(h['version'][0])
    matches = h.get('match', [])
    if not matches:
        sys.exit('no @match lines in the userscript header')
    run_at = RUN_AT.get(h.get('run-at', ['document-idle'])[0], 'document_idle')

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(os.path.join(OUT, 'icons'))

    manifest = {
        'manifest_version': 3,
        'name': h['name'][0],
        'short_name': 'Tealium capture',
        'version': version,
        'description': DESCRIPTION,
        'homepage_url': 'https://github.com/yrahman-treehouse/tealium-debugger',
        # world: MAIN needs 111. The script hooks utag, fetch and XHR on the
        # page itself, exactly as Tampermonkey's @grant none runs it, and reads
        # the page's own localStorage, so captures and ticks carry over.
        'minimum_chrome_version': '111',
        'icons': {s: 'icons/%s.png' % s for s in ('16', '48', '128')},
        'action': {
            'default_title': 'Tealium event capture %s' % version,
            'default_icon': {s: 'icons/%s.png' % s for s in ('16', '48')},
        },
        'background': {'service_worker': 'background.js'},
        # alarms: the periodic GitHub version check. Nothing else is needed:
        # the raw GitHub URL sends Access-Control-Allow-Origin: *, and opening
        # a tab from the toolbar button needs no permission.
        'permissions': ['alarms'],
        'content_scripts': [{
            'matches': matches,
            'js': ['content.js'],
            'run_at': run_at,
            'world': 'MAIN',
            # Tampermonkey runs a userscript without @noframes in every
            # matching frame; keep that behaviour identical.
            'all_frames': True,
        }],
    }
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')
    shutil.copyfile(SRC, os.path.join(OUT, 'content.js'))
    shutil.copyfile(os.path.join(HERE, 'background.js'), os.path.join(OUT, 'background.js'))
    for s in (16, 48, 128):
        with open(os.path.join(OUT, 'icons', '%d.png' % s), 'wb') as f:
            f.write(icon(s))

    zip_path = os.path.join(DIST, 'tealium-debugger-%s.zip' % version)
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(OUT):
            for name in sorted(files):
                full = os.path.join(base, name)
                z.write(full, os.path.relpath(full, OUT))

    print(version)
    gh_out = os.environ.get('GITHUB_OUTPUT')
    if gh_out:
        with open(gh_out, 'a', encoding='utf-8') as f:
            f.write('version=%s\nzip=%s\n' % (version, os.path.relpath(zip_path, ROOT)))


if __name__ == '__main__':
    main()
