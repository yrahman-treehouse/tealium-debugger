# Chrome extension

The same debugger as `tampermonkey.user.js`, packaged as a Chrome extension. The userscript stays
the **only source**: `build.py` wraps it unchanged, so a change ships to both Tampermonkey users and
extension users from one commit.

| | Tampermonkey | Chrome extension |
|---|---|---|
| Install | open the raw URL | Chrome Web Store link, or *Load unpacked* |
| Updates | Tampermonkey polls the raw URL (daily by default) | Chrome updates Web Store installs itself; the extension also checks GitHub every 3 h and asks Chrome to update straight away |

Do not run both at once: each would hook `utag`, `fetch` and XHR, and every hit would be logged
twice. Disable the Tampermonkey script when you switch. Both read the page's own `localStorage`,
so captures, ticks and settings carry over.

## How a release happens

1. Change `tampermonkey.user.js` and **bump `@version`**. Same rule as before: no bump, no update.
2. Merge to `main`. The *Chrome extension* workflow then:
   - builds `dist/tealium-debugger-<version>.zip`,
   - creates GitHub release `v<version>` with the zip attached (skipped if that tag exists),
   - uploads the zip to the Chrome Web Store and submits it, once the `CWS_*` secrets exist.
3. The Web Store reviews it (usually hours, sometimes a day or two). Once it's approved, Chrome
   updates every install. The extension's own GitHub check makes that happen within about 3 hours
   of approval, not on Chrome's slower schedule.

PRs run the build too, as a check, but never release or publish.

## Build locally

```sh
python3 extension/build.py      # prints the version; output in dist/
```

Then go to `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick
`dist/extension/`. An unpacked install never auto-updates. When GitHub has a newer version, the
toolbar icon shows **NEW**, and clicking it opens the latest release.

## One-time Web Store setup

Chrome on Mac and Windows only auto-updates extensions from the Web Store, or ones pushed by
enterprise policy. A self-hosted `.crx` won't even install there. So the Store is the route.

1. **Developer account.** Register at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   (one-off fee). Use your Treehouse Google account if the item should be visible to treehouse.nl only.
2. **First upload, by hand.** Download the zip from the latest GitHub release. In the dashboard, choose
   *New item* and upload it. Then fill in the listing:
   - **Visibility:** *Private* (treehouse.nl users only; needs a Treehouse Workspace account) or
     *Unlisted* (anyone with the link). Don't pick Public.
   - **Single purpose:** "Debugging tool for Treehouse's own Tealium tracking: shows the events the
     site sends and the requests its tags make."
   - **Permission justification:** `alarms` is used to check GitHub for a newer version. The host
     access in the content-script matches is needed to read the tracking calls on Treehouse's own sites.
   - **Privacy:** the extension stores captured tracking data only in the page's `localStorage` on
     your machine and sends nothing anywhere. Its only request is to GitHub, for the version number.
   - A 1280×800 screenshot of the panel.
   Submit it. The 32-letter **extension id** is shown on the item's page.
3. **API access.**
   - In [Google Cloud](https://console.cloud.google.com/), enable the *Chrome Web Store API* on a project.
   - Create a service account there. It needs no IAM roles.
   - Create a JSON key for it.
   - Add the service account's email in the Developer Dashboard under **Account**.
   - Copy your **publisher id**. It's the id in the dashboard URL, `…/devconsole/<publisher id>/…`.
4. **Repo secrets.** Under GitHub → Settings → Secrets and variables → Actions:
   - `CWS_SERVICE_ACCOUNT_KEY`: the whole JSON key file
   - `CWS_PUBLISHER_ID`
   - `CWS_EXTENSION_ID`

   To check the credentials without publishing anything:
   `CWS_DRY_RUN=1 python3 extension/cws_publish.py x` (with the three variables exported). It stops
   after getting a token.

Until step 4 is done, the workflow still builds and creates the GitHub release, and only skips the
Web Store upload.
