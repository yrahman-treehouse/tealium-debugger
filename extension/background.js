// Update check against the GitHub repo the extension is built from.
//
// A Web Store install is updated by Chrome itself, but Chrome only polls every
// few hours. This compares the @version on GitHub's main branch with the
// running version and, when GitHub is ahead, asks Chrome to look for the
// update now — so a merge reaches the browser as soon as the Store has
// approved it, not hours later.
//
// An unpacked install cannot be updated by Chrome at all. For those, and for a
// Store version still in review, the toolbar icon shows a NEW badge; clicking
// it opens the latest GitHub release, whose zip is the new build.
'use strict';

const SOURCE = 'https://raw.githubusercontent.com/yrahman-treehouse/tealium-debugger/main/tampermonkey.user.js';
const RELEASES = 'https://github.com/yrahman-treehouse/tealium-debugger/releases/latest';
const ALARM = 'github-version-check';
const EVERY_MINUTES = 180;

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function githubVersion() {
  const res = await fetch(SOURCE, { cache: 'no-store' });
  if (!res.ok) throw new Error('GitHub returned ' + res.status);
  // The header sits at the top; no need to hold the whole 300 KB.
  const text = (await res.text()).slice(0, 4000);
  const m = text.match(/@version\s+(\S+)/);
  if (!m) throw new Error('no @version on GitHub');
  return m[1];
}

async function setState(badge, title) {
  await chrome.action.setBadgeText({ text: badge });
  if (badge) await chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
  await chrome.action.setTitle({ title });
}

async function check() {
  const local = chrome.runtime.getManifest().version;
  let remote;
  try {
    remote = await githubVersion();
  } catch (e) {
    await setState('', 'Tealium event capture ' + local + ' (update check failed: ' + e.message + ')');
    return;
  }
  if (!newer(remote, local)) {
    await setState('', 'Tealium event capture ' + local + ' — up to date');
    return;
  }
  let status = 'no_update';
  try {
    status = (await chrome.runtime.requestUpdateCheck()).status;
  } catch (e) {
    // Unpacked installs have no update URL to check.
  }
  if (status === 'update_available') {
    await setState('…', 'Tealium event capture ' + remote + ' is downloading');
    return;   // onUpdateAvailable below reloads into it
  }
  await setState('NEW', 'Tealium event capture ' + remote + ' is on GitHub, you have ' +
    local + '. Click to open the release.');
}

chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: EVERY_MINUTES });
  check();
});
chrome.runtime.onStartup.addListener(check);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) check(); });

chrome.action.onClicked.addListener(async () => {
  const badge = await chrome.action.getBadgeText({});
  if (badge === 'NEW') {
    chrome.tabs.create({ url: RELEASES });
  } else {
    check();   // a click is also a manual "check now"
  }
});
