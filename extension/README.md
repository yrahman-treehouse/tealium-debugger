# Chrome extension

A small **loader** for the debugger in `tampermonkey.user.js`. The extension doesn't contain the
debugger as fixed code. It fetches the userscript from this repo's **latest GitHub release** and
runs it through Chrome's `userScripts` API, which is how Tampermonkey works too. A merged version
bump reaches every install within a few hours, with no Web Store, no review and no reinstall.

| | Tampermonkey | Chrome extension |
|---|---|---|
| Install | open the raw URL | load the zip once (below) |
| Script updates | Tampermonkey polls the raw URL on `main` | the extension polls the latest **release**, every 3 h, at browser start, and on a click of its icon |

Don't run both at once: each would hook `utag`, `fetch` and XHR, and every hit would be logged
twice. Disable the Tampermonkey script when you switch. Both read the page's own `localStorage`, so
captures, ticks and settings carry over.

## Install (once per person)

1. Download `tealium-debugger-extension-<n>.zip` from the
   [latest release](https://github.com/yrahman-treehouse/tealium-debugger/releases/latest) and unzip it
   somewhere permanent. Chrome reads from that folder, so don't delete it.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick the folder.
3. Click **Details** on the extension and switch on **Allow User Scripts**. Chrome 138+ requires
   this per extension; before 138, Developer mode covers it. Until you do, the toolbar icon shows
   a red **!**, and clicking it opens this page.

The extension ships with the script as it was at build time, so it works from the first page load.
It switches to the latest release as soon as its first check runs.

## Toolbar icon

The icon is worked out per tab. Hover over it for the debugger version and where it came from.

| Icon | Meaning | Click |
|---|---|---|
| green **T** | this site is one the debugger runs on, and it is capturing here | check GitHub now |
| grey **T** | any other site; the tooltip lists the sites it does run on | check GitHub now |
| red **!** badge | "Allow User Scripts" is off, so it runs nowhere | opens the extension's settings |
| orange **↻** badge | an update of the extension itself is ready (see below) | downloads it and opens this extension's page |

A badge only appears when there is something to do, and it applies to every tab until it's resolved.

## How a release happens

1. Change `tampermonkey.user.js` and **bump `@version`**. No bump, no release, no update.
2. Merge to `main`. The *Chrome extension* workflow creates release `v<version>` on that commit,
   with the extension zip attached.
3. Each install sees the new release on its next check. It applies from the next page load, and
   pages already open keep their version.

Only releases are fetched, never `main`, so code runs in people's browsers only after it has been
merged and versioned. A failed or malformed download changes nothing: the last good script keeps
running. The extension also never goes back to an older version.

## The shell and `SHELL_VERSION`

Script changes never need a new zip. The shell (`manifest.json`, `background.js`) does, and so does
**adding a site**: host permissions are fixed at install time, so a new `@match` domain only runs
after people load a new zip. When the shell changes, bump `extension/SHELL_VERSION` together with
`@version`. Installs that are behind then show **↻**.

To update, click **↻**. The extension downloads the new zip, shows it in Finder, and opens its own
page in `chrome://extensions`. Unzip the download over the extension's folder, then press **Update**
on that page. The extension can't do the unzip step itself, because an unpacked extension can't
replace its own files. Settings, site access and the extension id all stay, because it's the same
folder.

## Build locally

```sh
python3 extension/build.py      # prints "<shell version> <script version>"; output in dist/
```

## Trust

Anyone who can get a release published can run code on the matched sites in every installed browser,
which is the same trust Tampermonkey already places in the raw URL on `main`. Keep merge rights on
this repo to people who should have that.
