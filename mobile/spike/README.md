# Reader engine trial (throwaway)

Proves the reader approach: foliate-js in a WebView, with the backend's real DRM
format decrypted by WebCrypto inside the WebView, running in Expo Go. The results
and the must-do list for the real reader are in
`docs/superpowers/specs/2026-11-16-reader-engine-trial-findings.md` on `main`.

**Not for merging.** On this branch `mobile/App.tsx` shows the trial screen
instead of the app, and the trial uses a fixed test device key.

## What is where

| Path | What |
| --- | --- |
| `SpikeScreen.tsx` | The trial screen: book list, reader controls, results |
| `web/entry.js` | Runs in the WebView: licence check, key unwrap, decryption, ZIP loader, chapter hardening, table fitting, position pinning |
| `build-reader-html.mjs` | Bundles `web/entry.js` + foliate-js into `readerHtml.generated.ts` (strict-CSP page) |
| `make-fixtures.ts` | Encrypts test EPUBs with the backend's own code and issues signed licences into `mobile/spike-fixtures/` |
| `gen-sq-test-epub.mts` | Generates the Albanian edge-case test book (EPUB 3 and EPUB 2) |
| `patch-wikisource-language.py` | Adds `dc:language` = `sq` to a Wikisource export |
| `vendor/foliate-js/` | foliate-js (MIT), pinned, see `VENDORED.txt` |
| `desktop-harness/` | The same WebView page run in headless Chrome over CDP, with a network log |

## Run it (Windows or Linux)

Generated files and test keys are git-ignored. The test books must be in the
git-ignored `Books/` folder of this checkout: `Books/sq-test`,
`Books/sq-wikisource`, and optionally the local-only English books in `Books/`.
Books that are missing are skipped.

```sh
cd backend && npm ci                     # esbuild, sharp and the DRM code come from here
npx tsx ../mobile/spike/gen-sq-test-epub.mts ../Books/sq-test   # only if Books/sq-test is missing
npx tsx ../mobile/spike/make-fixtures.ts   # defaults to ../Books/...; or pass <sq-test> <sq-wikisource> <english dir>
cd ../mobile && npm ci
node spike/build-reader-html.mjs
npx expo login                            # same account as Expo Go on the phone
REACT_NATIVE_PACKAGER_HOSTNAME=<this machine's LAN IP> npx expo start --lan
```

Then scan the QR code with the iPhone camera, which opens Expo Go. The phone must
be on the same network. The app's `[SPIKE]` log lines appear in the Expo terminal.

To find the LAN IP:
- **Linux:** `ip -4 addr`.
- **Windows:** `ipconfig`.

PowerShell sets the variable differently:
`$env:REACT_NATIVE_PACKAGER_HOSTNAME='<ip>'; npx expo start --lan`.

## Desktop regression (headless Chrome)

```sh
cd mobile/spike/desktop-harness
node make-harness.mjs          # needs spike-fixtures and readerHtml.generated.ts
node serve.mjs &               # serves harness.html on 127.0.0.1:47123
node cdp.mjs                   # full run; results in result.json, network log on stdout
node overflow-driver.mjs && node make-harness-overflow.mjs   # table-overflow sweep
                               # (rerun cdp.mjs to execute it)
node cdp-shot.mjs              # phone-sized screenshots of the table page
```

On Linux, set `CHROME_PATH` if Chrome isn't installed as `chromium`, for example
`CHROME_PATH=google-chrome-stable`.
