# Tealium event capture — Treehouse

A browser debugger for Treehouse's tracking. On our sites it shows every Tealium event the page
asks for, what Tealium actually **sent** to its servers, and the vendor pixels the tags fire
(Meta, Google, TikTok, Snap and others). You can filter all of it and export it as JSON or CSV.

It runs on rentaroof.co.uk, huurwoningen.nl, huurwoningen.com, pararius.nl, pararius.com,
immomiet.de, mietsy.de and toitpourtoi.fr.

## Install it (once, about 3 minutes)

You need **Chrome** or **Brave**, version 138 or newer (check under *About*). Other Chromium
browsers such as Edge should work the same way, but only Chrome and Brave have been tested.

### 1. Download

Open the [latest release](https://github.com/yrahman-treehouse/tealium-debugger/releases/latest).
Under **Assets**, download **`tealium-debugger-extension-<number>.zip`**. You don't need the
"Source code" downloads.

### 2. Unzip it into a folder you'll keep

The browser runs the extension straight from this folder. If the folder is moved or deleted,
the extension stops working. So don't leave it in Downloads.

**Mac:** open Terminal and paste:

```sh
mkdir -p ~/Applications/"Tealium Debugger Extension"
unzip -o "$(ls -t ~/Downloads/tealium-debugger-extension-*.zip | head -1)" -d ~/Applications/"Tealium Debugger Extension"
```

This takes the newest extension zip in Downloads, so it also works later on, when older ones are
still there.

**Windows:** right-click the zip, choose **Extract All…**, and extract it to
`Documents\Tealium Debugger Extension`.

Either way, the folder should now contain `manifest.json`, `background.js`, `seed.user.js` and an
`icons` folder. If you only see a single folder inside it, that inner folder is the one to use in
the next step.

### 3. Load it into the browser

1. Go to `chrome://extensions` (Brave: `brave://extensions`).
2. Turn on **Developer mode**, top right.
3. Click **Load unpacked** and select the folder from step 2.
   - On a Mac, `~/Applications` is the *Applications* folder inside your home folder, not the main
     Applications folder. In the file picker, press **⌘⇧G** and paste
     `~/Applications/Tealium Debugger Extension`.

### 4. Switch on "Allow User Scripts" (don't skip this)

On the new **Tealium event capture — Treehouse** card, click **Details** and switch on
**Allow User Scripts**. Without it the extension runs nowhere, and its icon shows a red **!**.

### 5. Pin it

Click the puzzle-piece icon in the toolbar and pin **Tealium event capture**, so its **T** icon is
always visible.

### 6. Check it works

Open any page on pararius.nl or huurwoningen.nl:

- the **T** in the toolbar turns **green**. Hover over it and it says
  *"Tealium event capture is on for this site"*;
- a dark **TAGS** pill appears at the bottom right of the page. Click it to open the panel;
- open the browser console (**⌥⌘J** on Mac, **Ctrl+Shift+J** on Windows) and you'll see each event
  laid out as it happens.

If you already use the Tampermonkey version of this debugger, **turn that script off**. With both
running, every event is logged twice. Your settings and captures carry over, because both read
the same page storage.

## Updates

- **The debugger itself updates by itself.** The extension checks GitHub every few hours, at
  browser start, and when you click the **T**. New versions apply from the next page load. You
  don't need to do anything.
- **Occasionally the extension needs a new zip.** You'll see an orange **↻** on the **T**. Click
  it: the new zip downloads and the extension's page opens. Then:
  - **Mac:** paste the same two lines from step 2 into Terminal again.
  - **Windows:** *Extract All…* to the same `Documents\Tealium Debugger Extension` folder and
    choose to replace the files.

  Then press **Update** on the extensions page. Always reuse the **same folder**. Loading a new
  folder creates a second copy of the extension, with "Allow User Scripts" switched off again.

## The toolbar icon

| You see | Meaning | Click it to |
|---|---|---|
| green **T** | it's capturing on this site | check for updates now |
| grey **T** | it doesn't run on this site; hover to see where it does | check for updates now |
| red **!** | "Allow User Scripts" is off (step 4) | open the setting |
| orange **↻** | an update needs a new zip (see *Updates*) | download it |

## If something's wrong

| Problem | Fix |
|---|---|
| Red **!** on the icon | Step 4: *Details* → **Allow User Scripts** on. |
| Grey **T** on a Treehouse site | On the extension's *Details* page, under **Site access**, make sure the Treehouse sites are allowed. |
| No **TAGS** pill on the page | Reload the page. A page that was already open before installing or updating keeps the old state. |
| "Manifest file is missing or unreadable" | You selected the wrong folder. Select the one that directly contains `manifest.json`. |
| Every event shows twice | Turn off the Tampermonkey version (see step 6). |
| The browser warns about developer-mode extensions | Expected for extensions installed this way. Keep it enabled. |

## Good to know

- Captures are kept only in your own browser (the page's local storage) and are never sent
  anywhere. The extension's only network request is to GitHub, to check for updates.
- Some captured fields hold personal data, such as the rental-profile answers (income, age,
  employment status). Check an export before sharing it outside your own machine, and use
  **Clear** in the panel to wipe what's stored.
- Maintainers: how the extension is built and released is in [`extension/README.md`](extension/README.md).
