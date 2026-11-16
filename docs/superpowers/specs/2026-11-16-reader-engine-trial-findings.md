# Reader engine trial: findings

**Date:** 2026-11-15/16
**Question:** can the mobile reader render real EPUBs and decrypt them on the device,
using the backend's real DRM format, inside Expo Go (no native modules, no Apple
Developer account)?
**Answer:** yes. Build the reader on **foliate-js in a WebView, with WebCrypto
decryption inside the WebView**. The items under "Must do in the reader project" are
required; the trial shows each one is solvable.

The trial code is throwaway and is not merged. See "Where things are" at the end.

## Setup

- **Device:** iPhone, iOS 18.7, Expo Go (SDK 58), over the LAN. Expo Go requires the
  same Expo account to be signed in on the phone and in the CLI (`npx expo login`).
- **Desktop check:** the same WebView page in headless Chrome 157, driven over the
  DevTools protocol, which also recorded every network request.
- **Engine:** foliate-js at commit `78914ae` (MIT), bundled with esbuild into one
  inline script (about 124 KB). The PDF, MOBI, FB2, comic and text-to-speech
  modules are stubbed out.
- **Format:** each fixture was encrypted with the backend's own `encryptAsset` and
  `wrapDekForDevice`, and licensed with `signLicence`. The app did the whole reader
  contract in the WebView:
  1. check the ciphertext SHA-256;
  2. verify the Ed25519 licence signature;
  3. check the device and expiry;
  4. ECDH P-256, then HKDF-SHA-256, then AES-GCM unwrap of the DEK;
  5. AES-256-GCM decryption of the book.
- **Books:**
  - an Albanian edge-case test book, in EPUB 3 and EPUB 2;
  - two Wikisource books by Naim Frashëri;
  - two large English EPUBs (1.9 and 2.6 MB);
  - a deliberately hostile EPUB.

## Results

| Check | iPhone (iOS 18.7) | Desktop Chrome |
| --- | --- | --- |
| Secure context with `baseUrl: https://reader.libraria.invalid/` | yes | yes |
| WebCrypto: P-256 ECDH (91-byte SPKI export), HKDF, AES-GCM, SHA-256 | all pass | all pass |
| WebCrypto Ed25519 (licence signature) | passes | passes |
| Device key import (PKCS#8) | works | works |
| Decrypt to first page | 30–190 ms | 20–170 ms |
| Albanian text (ë ç Ë Ç, „…“ «…», dashes), embedded font | correct | correct |
| Nested contents list, links to anchors and across files | work | work |
| Reopen at saved CFI after a full WebView reload | same text | same text, all 7 books |
| Tampered licence / wrong device AAD / wrong content AAD | all rejected | all rejected |
| Hostile EPUB: inline script, `onerror`, SVG `onload`, `javascript:` link | none ran | none ran |
| Hostile EPUB: remote CSS, image, iframe, object, meta refresh | blocked | blocked by CSP before any request (network log) |
| ZIP Unicode Path field (0x7075) trick | ignored | ignored |
| Text sharpness, margins, swipe feel | good (user) | — |

## Must do in the reader project

1. **Content security (the reader contract requires it).** foliate-js renders each
   chapter in an iframe with `sandbox="allow-same-origin allow-scripts"`, which
   cancels the sandbox. The trial blocked scripts and remote loads in four layers:
   - **Top-level CSP:** the WebView page allows only its own nonce'd script, and
     only `blob:`/`data:` for everything else.
   - **Per-chapter CSP:** foliate's `transformTarget` `data` event lets us inject
     `<meta http-equiv="Content-Security-Policy">` with `script-src 'none'` and
     `default-src 'none'` into every chapter before it is displayed.
   - **Sanitising:** remove `<script>`, `on*` attributes, `javascript:` URLs and
     meta refresh.
   - **Navigation:** handle foliate's `external-link` event without navigating, and
     give the WebView an `onShouldStartLoadWithRequest` allowlist (our base URL,
     `about:`, `blob:`, `data:`).

   Pass `originWhitelist={['*']}` and decide in `onShouldStartLoadWithRequest`.
   Otherwise react-native-webview opens non-matching URLs in Safari.
2. **Our own ZIP loader.** zip.js (inside foliate-js) uses the Info-ZIP Unicode Path
   field (0x7075), which the reader contract forbids. Key entries by `rawFilename`
   (decoded as UTF-8) and keep the first occurrence of a name.
3. **Keep the position when the font size or theme changes.** On iOS, foliate's own
   anchor drifted by up to a page. Before calling `setStyles`:
   - save the collapsed start CFI of the page (`CFI.collapse(lastLocation.cfi)`);
   - re-fit tables, then `goTo` that CFI once the layout has settled.

   After the fix, the saved start stayed on the visible page in all 7 books.
4. **Ignore the first `relocate` of a load if its range is empty.** iOS sends one
   during layout. Don't save that position.
5. **Fit tables to the page.** A table wider than the column bleeds into the next
   page. The working rule, `fitTables` in the trial:
   - keep the natural size if it fits;
   - otherwise shrink the table's text, to 75% at the least;
   - if it still doesn't fit, make the table element itself a horizontal scroller.
     Use `display:block; overflow-x:auto`, with no wrapper element so CFIs inside
     tables don't change. Stop touch events from bubbling, so a swipe on the table
     scrolls it instead of turning the page.

   Forced cell wrapping was tried and rejected: it broke words and numbers letter
   by letter.
6. **Animate page turns:** set the paginator's `animated` attribute. Without it, a
   swipe jumps on release instead of finishing the slide.
7. **Language fallback:** when the EPUB has no `dc:language`, set
   `book.metadata.language` from the book's language in the API before opening.
   This drives hyphenation and the `lang` attribute. The backend now accepts such
   files and records `languageSource: "book"` (see README, "Books and DRM").
8. **Device key:** the trial imported a fixed test key on purpose.
   - The app must generate the P-256 key on the device and register the SPKI key
     (`POST /devices`).
   - Decide where to keep the private key: a non-extractable `CryptoKey` in the
     WebView's IndexedDB (needs a stable origin) or PKCS#8 in `expo-secure-store`.
     That choice decides offline reading after an app restart, so test it.

## Should do (product polish)

- **Footnotes:** they currently jump to the note. Show them as pop-ups instead
  (foliate ships `footnotes.js`).
- **Page-turn styles:** keep slide as the default, and offer "cover" and "fade". An
  Apple Books–style curl needs a 3D page snapshot; it's optional, for later.
- **Wide tables:** add "tap a table to view it full screen".
- **Passing data to the WebView:** base64 through `injectJavaScript` was instant up
  to 2.6 MB. For much larger books, measure, and consider chunks or reading the
  file directly.

## Known issues

- **foliate-js exception:** "Cannot destructure property 'style' of null" in
  `columnize`, seen once in Chrome during rapid reopen and restyle, and not
  reproduced since. Guard reflows against unloaded sections; the trial needed this
  for table fitting too.

## Content and test data notes

- **Wikisource:** EPUB exports (ws-export) have an empty `dc:language`, which is
  what prompted the backend change. They have no cover image, so they need one
  uploaded in the portal. Albanian texts are on multilingual wikisource.org, since
  there's no separate Albanian site. Chapter exports of *Kanuni i Lekë Dukagjinit*
  failed.
- **Test books:** they are in the git-excluded `Books/sq-test` and
  `Books/sq-wikisource`. The English files in `Books/` are local-only copies and
  must never be uploaded, used in demo data or shared.

## Where things are

- **Branch and worktree:** `spike/reader-engine`, in the worktree
  `../libraria-reader-spike` (not merged, not pushed).
- **App code:** `mobile/spike/SpikeScreen.tsx` (test screen) and
  `mobile/spike/web/entry.js` (WebView code: crypto, ZIP loader, hardening, table
  fitting, position pinning).
- **Build and fixtures:**
  - `mobile/spike/build-reader-html.mjs`: bundle plus strict-CSP page;
  - `mobile/spike/make-fixtures.ts`: encrypted fixtures and licences made with
    the backend's crypto;
  - `mobile/spike/gen-sq-test-epub.mts`: the Albanian test book generator.
- **Desktop harness:** `mobile/spike/desktop-harness/`.
