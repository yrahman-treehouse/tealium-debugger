// Loader for the Treehouse Tealium debugger.
//
// The debugger itself is not part of this extension. It is tampermonkey.user.js
// from the GitHub repo, registered at runtime through chrome.userScripts:
//
//   1. On install, the bundled seed (the script as it was at build time) is
//      registered straight away, so the very first page load is covered.
//   2. On install, browser start, every few hours, and when the toolbar button
//      is clicked, the latest GITHUB RELEASE is checked. Its userscript replaces
//      the registered one if its @version is newer. A release, not main, so
//      only merged and versioned builds ever run.
//   3. The last good script lives in chrome.storage.local. A failed fetch or a
//      malformed file changes nothing.
//
// A new script applies from the next page load. A page that is already open
// keeps the version it started with.
//
// chrome.userScripts only works once the user has switched on "Allow User
// Scripts" for this extension (Chrome 138+; Developer mode before that). Until
// then the toolbar icon shows OFF, and clicking it opens the settings page.
'use strict';

const REPO = 'yrahman-treehouse/tealium-debugger';
const LATEST_RELEASE = 'https://api.github.com/repos/' + REPO + '/releases/latest';
const RAW = (ref, path) => 'https://raw.githubusercontent.com/' + REPO + '/' + ref + '/' + path;
const RELEASES_PAGE = 'https://github.com/' + REPO + '/releases/latest';
const SCRIPT_ID = 'tealium-debugger';
const ALARM = 'github-check';
const EVERY_MINUTES = 180;
const WHILE_OFF_MINUTES = 1;   // re-check quickly until the toggle is switched on
const RUN_AT = { 'document-start': 'document_start', 'document-end': 'document_end',
                 'document-idle': 'document_idle', 'document-body': 'document_end' };

// ── pure helpers (no chrome.* — tested outside the browser) ──────────────────
function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Parse a userscript into what userScripts.register needs. Returns null for
// anything that does not look like our script, so a bad download is ignored.
function parseUserscript(code) {
  const m = /\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/.exec(code || '');
  if (!m) return null;
  const meta = {};
  m[1].split('\n').forEach((line) => {
    // The value is optional: flags such as @noframes stand alone.
    const hm = /^\s*\/\/\s*@(\S+)(?:\s+(.*\S))?\s*$/.exec(line);
    if (hm) (meta[hm[1]] = meta[hm[1]] || []).push(hm[2] || '');
  });
  const version = (meta.version || [])[0];
  const matches = meta.match || [];
  if (!version || !/^\d+(\.\d+){0,3}$/.test(version) || !matches.length) return null;
  return {
    version,
    matches,
    runAt: RUN_AT[(meta['run-at'] || [])[0]] || 'document_idle',
    allFrames: !meta.noframes,
    code,
  };
}

// Keep only the @match patterns this install has host permission for. A
// pattern outside them cannot run anyway, and it means the shell is behind.
function allowedMatches(matches, granted) {
  const ok = matches.filter((p) => granted.indexOf(p) >= 0);
  return { ok, dropped: matches.filter((p) => granted.indexOf(p) < 0) };
}

// ── chrome glue ──────────────────────────────────────────────────────────────
async function userScriptsAvailable() {
  try {
    await chrome.userScripts.getScripts();
    return true;
  } catch (e) {
    return false;
  }
}

async function setState(badge, colour, title) {
  await chrome.action.setBadgeText({ text: badge });
  if (badge) await chrome.action.setBadgeBackgroundColor({ color: colour });
  await chrome.action.setTitle({ title });
}

async function stored() {
  const { script } = await chrome.storage.local.get('script');
  if (script) return script;
  const seed = parseUserscript(await (await fetch(chrome.runtime.getURL('seed.user.js'))).text());
  if (!seed) throw new Error('bundled seed is unreadable');
  seed.source = 'bundled';
  await chrome.storage.local.set({ script: seed });
  return seed;
}

async function register(script) {
  const granted = chrome.runtime.getManifest().host_permissions || [];
  const { ok, dropped } = allowedMatches(script.matches, granted);
  const def = {
    id: SCRIPT_ID,
    matches: ok,
    js: [{ code: script.code }],
    runAt: script.runAt,
    world: 'MAIN',       // page context, like Tampermonkey's @grant none
    allFrames: script.allFrames,
  };
  const existing = await chrome.userScripts.getScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.userScripts.update([def]);
  else await chrome.userScripts.register([def]);
  return dropped;
}

async function latestRelease() {
  const res = await fetch(LATEST_RELEASE, { cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return null;              // no release yet
  if (!res.ok) throw new Error('GitHub API ' + res.status);
  const tag = (await res.json()).tag_name;
  const code = await (await fetch(RAW(tag, 'tampermonkey.user.js'), { cache: 'no-store' })).text();
  const script = parseUserscript(code);
  if (!script) throw new Error('release ' + tag + ' has no readable userscript');
  script.source = tag;
  let shell = null;
  try {
    const r = await fetch(RAW(tag, 'extension/SHELL_VERSION'), { cache: 'no-store' });
    if (r.ok) shell = (await r.text()).trim();
  } catch (e) {}
  return { script, shell };
}

let running = null;
function sync() {           // one at a time; overlapping triggers share a run
  if (!running) running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  if (!(await userScriptsAvailable())) {
    chrome.alarms.create(ALARM, { periodInMinutes: WHILE_OFF_MINUTES });
    await setState('OFF', '#e53935',
      'Tealium event capture is OFF: switch on "Allow User Scripts" for this ' +
      'extension (click to open its settings).');
    return;
  }
  chrome.alarms.create(ALARM, { periodInMinutes: EVERY_MINUTES });

  let script = await stored();
  let dropped = await register(script);     // registrations do not survive an extension update
  let note = '';
  let shellBehind = false;
  try {
    const rel = await latestRelease();
    if (rel && newer(rel.script.version, script.version)) {
      dropped = await register(rel.script);   // register first: store only what is running
      await chrome.storage.local.set({ script: rel.script });
      script = rel.script;
    }
    if (rel && rel.shell && newer(rel.shell, chrome.runtime.getManifest().version)) shellBehind = true;
  } catch (e) {
    note = ' (GitHub check failed: ' + e.message + '; still running the last good version)';
  }

  const shellVersion = chrome.runtime.getManifest().version;
  if (shellBehind || dropped.length) {
    await setState('UPD', '#fb8c00',
      'Debugger ' + script.version + ' is running, but the extension itself (' + shellVersion +
      ') needs updating' + (dropped.length ? ' to cover ' + dropped.join(', ') : '') +
      '. Click to open the release, then load the new zip.' + note);
    return;
  }
  await setState('', '', 'Tealium event capture: debugger ' + script.version +
    ' from ' + script.source + ', extension ' + shellVersion + note);
}

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) sync(); });

chrome.action.onClicked.addListener(async () => {
  const badge = await chrome.action.getBadgeText({});
  if (badge === 'OFF') {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  } else if (badge === 'UPD') {
    chrome.tabs.create({ url: RELEASES_PAGE });
  } else {
    sync();   // a click is also a manual "check now"
  }
});
