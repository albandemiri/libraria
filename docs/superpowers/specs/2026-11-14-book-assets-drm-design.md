# Book assets and DRM (backend): design

Status: ready for approval. Date: 2026-11-14. Branch: `phase-4/book-assets` (stacked on
`phase-3/publisher-portal`).

Governing documents:
- spec v2.1 §8, §9.1 (offline), §10.2, §11.2, §12, §13.1 #1/#4/#5/#6, §15,
  Appendix A §16.2;
- the DRM addendum §17, in
  `docs/superpowers/specs/Libraria_Technical_Architecture_Specification_v2.1.pdf`.

Where this design and the spec differ, the spec wins. The differences that
remain are recorded under "Calls I made".

## Why

Today Libraria cannot handle a real book.
- Nothing reads an EPUB a publisher provides.
- Book keys are derived from the login secret (`deriveBookKey(bookId,
  JWT_SECRET)`), which spec §8.4 and §17.3 call a P0 defect.
- Encrypted files are served from a public folder (`/assets`).
- `GET /library/:bookId/key` hands out a permanent raw key.

This project makes the backend able to:
- accept a publisher's EPUB;
- check, process and encrypt it properly;
- store it privately;
- give it only to entitled readers on registered devices, through licences
  that work offline for 30 days.

The reading app (rendering, using licences) is the next project. This one
gives that project a stable contract to build against.

## Decisions made with the user

- **Offline reading is required.** A desktop app is planned too.
- **Policy:**
  - at most 5 devices per account;
  - readers remove devices themselves, but after 3 removals in a rolling year
    they need support;
  - a book licence on a device lasts 30 days and renews silently when online;
  - after a refund or chargeback, or for a removed device or a suspended
    account, no new licences are issued. Existing ones stop at expiry, or as
    soon as the device is online.
- **Device churn, decided after the builder check:**
  - a device that has received no grant for **90 days** stops counting
    toward the 5 automatically;
  - removing a device that **never received a licence** does not count
    toward the 3 removals.
- **New versions of live books:**
  - a new version of a book that already has a live file waits as "Ready,
    not live" until the **publisher activates it**;
  - a book's first ready file becomes current automatically.
- **Approach A, device-bound licences:**
  - each device holds its own key pair;
  - the server unwraps the book key through KMS and re-wraps it so only that
    device can unwrap it;
  - the result is a signed licence with an expiry.
- **Order:** this backend project first, then the app reader.
- **Hosting is not chosen yet,** so KMS and object storage sit behind
  interfaces with local substitutes (spec §4.2). Real providers are a
  configuration step later.

## Goals

1. **Ingestion.** A publisher uploads an EPUB for a draft or live book. An
   isolated worker takes it through the stages in §16.2: `uploaded →
   validating → scanning → encrypting → storing → ready`, or `rejected` with a
   safe, actionable reason code, or `failed`. Only a `ready` asset can make a
   book publishable.
2. **EPUB validation and parsing** follow §17.7: size, entry count,
   compression ratio, paths, duplicates, container and OPF structure, and the
   allowed content policy. The worker extracts title, creators, language,
   identifier/ISBN, description, a cover image and a table-of-contents
   summary, and records them on the asset.
3. **Envelope encryption** follows §17.3. Each asset version gets a random
   256-bit DEK and is encrypted with AES-256-GCM, with a fresh 96-bit nonce and
   AAD bound to `assetId|version|algorithm|kmsKeyId`. The DEK is wrapped by
   KMS. Only the wrapped DEK and key reference are stored.
4. **Private storage.** The ciphertext goes to object storage under an opaque
   key. Its integrity is verified (SHA-256 of the ciphertext) before the asset
   becomes `ready`. Public `/assets` serving is removed.
5. **Devices.** A device registers with a public key, limited to 5 active per
   account. Readers can list and remove their devices, with the removal limit.
6. **Download authorization** (§17.6) is a short-lived grant to fetch the
   ciphertext through a backend proxy.
7. **Decryption authorization** (§17.6) is the 30-day device licence. It
   carries the DEK wrapped for that device's public key and is signed by the
   server. Calling the endpoint again renews it.
8. **Policy checks** for both authorizations follow §17.4 steps 1–5: account
   active, entitlement active, asset `ready` and the book's current version,
   device active and owned by the caller, rate limit. Denials don't reveal
   anything: one safe error code, with the internal reason code logged.
9. **Audit.** Every grant or denial, device event and ingestion
   rejection or failure writes an `asset_access_logs` or `audit_events` row.
   No keys, tokens, grant tokens or plaintext ever reach logs (§17.8).
10. **P0 clean-up:**
    - remove `deriveBookKey` and every JWT_SECRET-derived key;
    - remove `GET /library/:bookId/key` and `/asset`;
    - remove the `/assets` static route;
    - the seed creates its demo books through the real pipeline.

## Non-goals

- **The reader app:** EPUB engine choice, rendering, and the client side of
  licences and device registration. That is the next project. The mobile app
  only stops calling the removed endpoints (see "Mobile").
- **Real cloud KMS and object-storage adapters.** These come when hosting is
  chosen. The interfaces must make them drop-in.
- **Publisher moderation / staff approval** (§10.2 step 6, §15 "Publisher
  moderation"). Publishing stays publisher-controlled, as today. This remains
  a recorded open decision.
- **Platform attestation, watermarking, anomaly detection** (§17.9 P3).
- **Chunked or streamed encryption for large files.** EPUBs are encrypted and
  decrypted whole (see the size limit). Audiobooks will need chunking later.
- **The portal design pass.** The portal gets only the minimum upload and
  status UI needed to publish a real book.

## Anti-goals

- Plaintext EPUB bytes, plaintext DEKs, grant tokens or licence contents must
  never appear in logs, error responses, analytics or the database.
- A book must never become purchasable or readable with an asset that is not
  `ready`.
- A failed, interrupted or rejected upload must never replace the current
  asset of a live book.
- Login signing secrets and DRM keys must never be derivable from each other
  (§17.3, the key-separation test in §17.8).
- DRM must never be described as production-ready. The README must state the
  accepted residual risk from §17.10 and that the local KMS is a development
  substitute.

## Approaches considered (key delivery to devices)

1. **Device-bound licences (chosen).** The DEK is wrapped for the device's
   public key (ECDH-ES on P-256, HKDF-SHA-256, then AES-256-GCM, as in JWE
   `ECDH-ES+A256GCM`) and signed by the server. A copied licence is useless on
   another device. This releases the "minimum required capability" (§8.3,
   §17.4). It costs more client work.
2. **A plain DEK with an expiry, kept in secure storage.** Simpler, but an
   extracted key opens the book anywhere, which is more than the minimum.
3. **Server-side rendering.** Rejected: it doesn't work offline, and §17.10
   defers it.

P-256 is chosen over X25519 because WebCrypto supports P-256 ECDH, HKDF and
AES-GCM everywhere: in React Native WebViews, in desktop shells and in Node.

## Design

### Data (migration `0006_book_assets_drm.sql`)

- **`users.status`:** `active` or `suspended`, default `active`.
  - Suspension takes effect on **every authenticated request** within about
    30 seconds. `requireAuth` checks the account status through a small
    per-process cache with a 30-second TTL; the cache entry is cleared at
    once when an admin changes status in the same process.
  - A suspended account gets `403 ACCOUNT_SUSPENDED`, cannot log in (either
    login) and gets no grants.
- **`books.withdrawn_at`, `books.withdrawn_reason`:** the admin takedown
  switch. A withdrawn book gets no download or decryption grants for any
  version, and its licences report `revoked` at the next status check. It
  stays visible to admins only. It covers copyright takedown, malware found
  after release and suspected key compromise. For a key compromise the
  publisher then uploads and activates a new version, which gets a new DEK.
- **`book_assets`:** one row per immutable asset version.
  - Columns: `id`, `book_id`, `version` (unique per book, increasing),
    `state` (an enum of the §16.2 states), `reason_code`, `reason_detail`
    (safe text), `original_size_bytes`, `object_key` (opaque, null until
    stored), `ciphertext_size_bytes`, `ciphertext_sha256`,
    `encryption_algorithm` (`'AES-256-GCM'`), `nonce`, `auth_tag`,
    `extracted_metadata` (jsonb: title, creators, language, identifiers,
    description, toc summary, has_cover), `uploaded_by`, `created_at`,
    `updated_at`, `ready_at`, `activated_at`, `activated_by`.
  - "Ready, not live" is a `ready` asset that is not the book's
    `current_asset_id`. It is not a separate state.
  - Constraint: a `ready` row must have object_key, nonce, auth_tag and
    checksum.
- **`asset_keys`:** `asset_id` (PK/FK), `wrapped_dek`, `kms_key_id`,
  `kms_key_version`, `wrapping_algorithm`, `created_at`. It never holds a
  plaintext DEK.
- **`books.current_asset_id`:** points to a `ready` asset of the same book.
  - The old `available_needs_asset` CHECK is replaced: an available book must
    have a non-null `current_asset_id`, and the app enforces that the asset is
    ready.
  - The legacy columns `encrypted_file_url`, `encryption_iv`,
    `encryption_auth_tag` and `file_size_bytes` are dropped.
  - Existing available books are set unavailable, because their old assets
    used login-derived keys. Development only: re-running the seed restores
    them.
- **`asset_jobs`:** `id`, `asset_id`, `state` (queued, running, done,
  failed), `attempts`, `locked_at`, `last_error_code`, timestamps. The worker
  claims jobs with `FOR UPDATE SKIP LOCKED`.
- **`devices`:** `id`, `user_id`, `platform` (`ios`, `android`, `desktop`;
  there is no `web` platform now), `display_name`, `public_key_spki` (P-256),
  `registered_at`, `last_seen_at` (updated on every grant and status check),
  `licence_issued` (boolean, set at the device's first licence),
  `revoked_at`, `revocation_reason`.
  - A device **counts toward the 5** when it is not revoked and its
    `last_seen_at` is within the last 90 days.
  - An inactive device that comes back is counted again. If that would make 6,
    its request gets `409 DEVICE_LIMIT_REACHED` until the reader removes one.
  - The limit is enforced in a transaction with the user row locked.
- **`device_removals`:** `user_id`, `device_id`, `removed_at`, used for the
  rolling 365-day count of 3.
- **`download_grants`:** `id`, `token_sha256` (unique), `user_id`,
  `device_id`, `asset_id`, `expires_at`, `created_at`. The token is shown to
  the client once and only its hash is stored.
- **`licences`:** `id`, `user_id`, `device_id`, `asset_id`, `issued_at`,
  `expires_at`, `superseded_at`. This is an issuance record for audit and
  support. It does not hold key material.
- **`asset_access_logs`:** `user_id`, `asset_id`, `device_id`, `action`
  (`download_authorization` or `decryption_authorization`), `decision`,
  `reason_code`, `request_id`, `created_at` (§17.5).
- **`audit_events`:** `actor_id`, `action`, `resource_type`, `resource_id`,
  `metadata` (redacted), `created_at`. It records device registration and
  removal, asset rejection and failure, user suspension and admin device
  revocation.

### Interfaces (provider-neutral; §3.3, §17.5)

- **`KeyManagement`:**
  - `generateDataKey(): {plaintext: Buffer, wrapped: Buffer, keyId, keyVersion}`;
  - `unwrap(wrapped, keyId, keyVersion): Buffer`.
  - **Local adapter:** a 256-bit KEK from `DRM_LOCAL_KEK` (base64, required
    when using local KMS, independent of every other secret), wrapping with
    AES-256-GCM. `KMS_PROVIDER=local` is **refused when
    `NODE_ENV=production`** until a real adapter exists.
- **`ObjectStorage`:**
  - `put(key, data)`, `get(key)`, `head(key) → {size}`, `delete(key)`.
  - **Local adapter:** a directory from `ASSET_STORAGE_DIR`, outside any
    served path, with keys mapped to safe file names.
  - Two logical areas: `quarantine/` for the plaintext original, deleted after
    processing whatever the outcome, and `assets/` for ciphertext.
- **`MalwareScanner`:** `scan(path or buffer) → clean | infected(reason) | error`.
  - A `clamav` adapter talks to clamd over TCP (`CLAMAV_HOST`/`PORT`).
  - A `none` adapter passes everything and is allowed only outside
    production. In production, `SCANNER=none` is refused.
- **`LicenceSigner`:** Ed25519 signing with `LICENCE_SIGNING_PRIVATE_KEY`, a
  separate secret. The public key is published at
  `GET /api/v1/drm/licence-signing-key` so clients can verify licences.

Module files follow §17.5:
- `authorization.service.ts`
- `encryption.service.ts`
- `key-management.service.ts`
- `asset-ingestion.service.ts`
- `asset-delivery.service.ts`
- `device.service.ts`
- `drm.audit.ts`

They sit under `backend/src/drm/`, with adapters in `backend/src/drm/adapters/`.

### Ingestion pipeline

- **Upload: `POST /api/v1/publisher/books/:bookId/assets`**
  - The body is raw `application/epub+zip`, streamed, with a hard limit of
    `ASSET_MAX_UPLOAD_BYTES` (default **100 MB**, checked before parsing).
    Uses the publisher scope and `bookWriteScope`, as other book writes do.
  - It creates `book_assets(version = n+1, state = uploaded)`, stores the
    original in `quarantine/`, enqueues an `asset_jobs` row and returns
    **202** `{ asset }`.
  - One asset per book may be in a non-terminal state at a time. A second
    upload gets `409 ASSET_PROCESSING`.
- **Status:**
  - `GET /api/v1/publisher/books/:bookId/assets` lists versions with state and
    reason codes.
  - `GET /publisher/books/:bookId/assets/:assetId` returns one asset, plus
    `extracted_metadata`.
- **Worker: `npm run worker`, a separate process and a separate compose
  service.**
  - It polls `asset_jobs`.
  - Each job's parsing runs in a `worker_threads` Worker with `resourceLimits`
    (memory) and a wall-clock timeout (`ASSET_PROCESSING_TIMEOUT_MS`, default
    60 s). A timeout or crash gives `failed` with `PROCESSING_TIMEOUT` or
    `PROCESSING_ERROR`.
  - Network isolation is a deployment control, documented in the README and
    not enforced in code.
- **Validation (`validating`), rejected with these reason codes:**
  - the ZIP is read with `yauzl`, entries inspected without extracting to
    disk;
  - `mimetype` must be the first entry, stored, and equal to
    `application/epub+zip`;
  - `NOT_AN_EPUB`;
  - `ARCHIVE_TOO_LARGE`: total uncompressed size above 500 MB;
  - `TOO_MANY_ENTRIES`: more than 10,000 entries;
  - `COMPRESSION_RATIO`: a ratio above 100:1 for any entry larger than 1 MB
    uncompressed;
  - `UNSAFE_PATH`: an absolute path, `..`, a backslash or a drive letter;
  - `DUPLICATE_ENTRY`: also case-insensitive duplicates;
  - `INVALID_CONTAINER`: `META-INF/container.xml` names an OPF rootfile that
    must exist;
  - `INVALID_PACKAGE`: OPF parsing with `fast-xml-parser` (external entities
    and DTDs disabled) fails, or `dc:title` or `dc:language` is missing, or
    the manifest or spine is empty, or a spine item is missing from the
    archive;
  - `UNSUPPORTED_ENCRYPTION`: an `encryption.xml` other than font
    obfuscation, i.e. an already-DRM'd file;
  - `ENCRYPTED_ARCHIVE`.
- **Content policy (in `validating`):**
  - `SCRIPTED_CONTENT`: any manifest item with the `scripted` property, any
    `<script` element in XHTML or SVG content, or any JavaScript media type;
  - `REMOTE_RESOURCES`: the `remote-resources` property, or `http:` or
    `https:` resource references in the manifest;
  - `UNSUPPORTED_MEDIA`: manifest media types outside an allowlist (XHTML,
    HTML, CSS, SVG, PNG, JPEG, GIF, WebP, fonts, NCX, SMIL, audio for media
    overlays).
- **Scanning (`scanning`):** the scanner runs on the original. Results:
  `MALWARE_DETECTED` gives `rejected`; a scanner error gives `failed` with
  `SCAN_UNAVAILABLE` and the job can be retried.
- **Encrypting:** generate a DEK through KMS, encrypt with AES-256-GCM using
  the AAD above, write `asset_keys` and the nonce and tag. Zero the plaintext
  DEK buffer afterwards.
- **Storing:** `put` the ciphertext under `assets/{assetId}/v{version}`, then
  `get` it back or `head` it and verify the size and SHA-256. On success,
  `ready_at` is set.
- **Completion happens in one DB transaction:** state `ready` and extracted
  metadata recorded. If the book has **no current asset**, its
  `current_asset_id` is set to this asset (a first upload goes live
  automatically). Otherwise the asset stays "Ready, not live".
  - **Activation:** `POST /api/v1/publisher/books/:bookId/assets/:assetId/activate`
    sets `current_asset_id` to a `ready` asset of that book, with the same
    scope rules as other book writes. It records `activated_at` and
    `activated_by` and writes an audit event.
  - Activating an older ready version is allowed: it is a rollback.
  - The worker itself **never** changes the pointer of a book that already
    has one, so a late retry can never overtake a newer version.
- **Retries and the original upload:**
  - errors during processing are retried by the job, up to 3 attempts with
    backoff;
  - the asset's `state` only becomes `failed` once attempts are exhausted;
  - the quarantine original is kept until a terminal outcome. It is deleted
    at once on `ready` or `rejected`, and kept for 7 days on `failed`, so an
    operator can retry;
  - `POST /api/v1/admin/assets/:assetId/retry` (admin, audited) re-queues a
    `failed` asset whose original still exists, as §17.7's "operator review".
- **Cover image:** if the EPUB declares a cover (`cover-image` property or the
  EPUB2 `meta name="cover"`), the worker stores it unencrypted under
  `covers/{bookId}/{assetId}`. It is served publicly at
  `GET /api/v1/books/:bookId/cover`, with caching, and the image type is
  checked by its magic bytes. `books.cover_image_url` is set to that route
  **only if the publisher has not set one**.
- **`rejected` is final:** the publisher uploads again.
- **Publishing:** `POST /publisher/books/:id/publish` now requires
  `current_asset_id` to point to a `ready` asset; otherwise it returns 400
  `ASSET_REQUIRED`, as today. `POST /publisher/books/:id/asset` (the old
  pre-encrypted endpoint) is removed.

### Devices

- **`POST /api/v1/devices`** takes `{ platform, displayName, publicKey }`,
  where `publicKey` is a P-256 SPKI in base64url, validated by importing it.
  - It returns 201 `{ device }`.
  - A 6th active device gets `409 DEVICE_LIMIT_REACHED`, with the active
    devices listed in `details`, so the app can offer to remove one.
  - Re-registering the same public key for the same user returns the existing
    device (idempotent).
- **`GET /api/v1/devices`** lists the caller's devices.
- **`DELETE /api/v1/devices/:deviceId`** revokes a device.
  - It records a counted removal only if the device ever received a licence
    (`licence_issued`).
  - If there were already 3 counted removals in the last 365 days, it
    returns `409 DEVICE_REMOVAL_LIMIT`, and the message says to contact
    support.
  - Removing a device that never received a licence is always allowed and
    never counts.
  - A device removing itself follows the same rules.
- **`DELETE /api/v1/library/:bookId/device-access`** is the spec's §17.6
  route. It ends the calling device's licence for one book: the licence is
  marked superseded and the app deletes its local copy. It takes `deviceId`
  in the body. This is not a device removal and does not count towards the
  removal limit.
- **Admin:**
  - `DELETE /api/v1/admin/devices/:deviceId` revokes any device, with an
    audit event and no removal limit.
  - `PATCH /api/v1/admin/users/:id/status` takes `{ status }` to suspend or
    reactivate a user, audited.
  - `GET /api/v1/admin/users/:id/devices` lists a user's devices and lets
    support reset the removal count (an audited "support override").
- **`last_seen_at`** is updated on each grant.

### Delivery

- **`POST /api/v1/assets/:assetId/download-authorizations`** takes
  `{ deviceId }`.
  - It passes `authorization.service` checks.
  - It returns `{ downloadUrl: "/api/v1/asset-downloads/<token>", expiresAt,
    sizeBytes, sha256 }`. The token is 256 random bits and expires after 5
    minutes; it can be reused within that time so downloads can resume.
- **`GET /api/v1/asset-downloads/:token`** streams the ciphertext.
  - It needs no session, because the token is the bearer credential (§17.2
    #1). It checks the token's hash and expiry and that the asset is still
    `ready`.
  - Headers: `Cache-Control: no-store` and
    `Content-Type: application/octet-stream`.
  - It supports `Range` requests.
- **`POST /api/v1/assets/:assetId/decryption-authorizations`** takes
  `{ deviceId }`. It runs the same checks again, then:
  - unwraps the DEK through KMS;
  - generates an ephemeral P-256 key and runs ECDH with the device public key;
  - derives a key with HKDF-SHA-256 (salt = licence id, info =
    `"libraria-licence-v1"`);
  - encrypts the DEK with AES-256-GCM (AAD = licence id | asset id | device
    id);
  - zeroes all key buffers;
  - signs the licence payload with Ed25519.

  It returns `{ licence }`:
  ```
  { v: 1, licenceId, assetId, assetVersion, bookId, deviceId, issuedAt, expiresAt,
    content: { algorithm: "AES-256-GCM", nonce, authTag, aad: { assetId, version, algorithm, kmsKeyId } },
    wrappedKey: { alg: "ECDH-ES+HKDF-SHA256+A256GCM", epk (SPKI b64url), iv, ciphertext, tag },
    signature }   // Ed25519 over the canonical JSON of all other fields
  ```
  - `expiresAt` is now plus `LICENCE_DAYS` (30). Calling the endpoint again
    issues a fresh licence and marks earlier ones superseded.
  - The licence is only for the book's **current** asset.
  - **Requests for a replaced asset:** a request for an asset that is no
    longer current, from a caller who otherwise passes every check (entitled,
    active, own device), gets **`409 ASSET_SUPERSEDED`** with
    `details: { currentAssetId, version, sizeBytes, sha256 }`. The app
    downloads the new version instead of treating it as a revocation. A
    caller who fails any other check gets the generic 403, so nothing is
    revealed.
- **The reader learns the current file from the library.** `GET /library`
  and `GET /library/:bookId` items gain
  `asset: { assetId, version, sizeBytes, sha256 } | null`, the book's current
  ready asset. It is null for withdrawn books or books without a ready asset.
- **`POST /api/v1/licences/status`** is the online check-in. It takes
  `{ deviceId, licenceIds: uuid[] (max 500) }` for the calling user's own
  device, and returns `{ licences: [{ licenceId, status, currentAsset? }] }`:
  - `valid`;
  - `expired`;
  - `revoked`: the app deletes the book and the licence. This covers a
    refunded or lost entitlement, a suspended account, a revoked device, a
    withdrawn book, and device-access removal;
  - `superseded`: a newer licence exists for the same book;
  - `replaced`: the book has a new current asset, given in `currentAsset`;
    the app downloads it and renews;
  - `unknown`: not issued to this device.

  The owning device sees the real outcome for its own licences: this is not
  enumeration, because they are its own records. The call also updates
  `last_seen_at`. The app calls it once each time it comes online, then
  renews only licences that are `valid` and close to expiry, or `replaced`.
- **Authorization policy** (`authorization.service.ts`), with each check
  giving an internal reason code:
  - the account is active (`ACCOUNT_SUSPENDED`);
  - the entitlement for the book is active (`NO_ENTITLEMENT`). Refunds and
    lost chargebacks already revoke entitlements;
  - the book is not withdrawn (`BOOK_WITHDRAWN`);
  - the asset is `ready` (`ASSET_UNAVAILABLE`) and is the book's current
    asset. A non-current asset gives `409 ASSET_SUPERSEDED` once every other
    check passes;
  - the device belongs to the caller and is not revoked (`DEVICE_REVOKED` or
    `DEVICE_UNKNOWN`);
  - the rate limit holds (`RATE_LIMITED`, which returns 429 `RATE_LIMITED`).

  Every other denial returns **403 `ASSET_ACCESS_DENIED`** with no reason.
  The reason goes to `asset_access_logs` only.
- **Unpublished books:** a book that was unpublished after purchase stays
  readable by its existing owners. Unpublishing affects the storefront, not
  entitlements (§10.2 step 7). It needs only a ready current asset.
- **Rate limits:** a small in-memory sliding window, noted as per-instance.
  Defaults:
  - download authorizations: 10 per hour per device and asset;
  - decryption authorizations: 10 per hour per device and asset;
  - licence status checks: 60 per hour per device;
  - a backstop of 300 grants per hour per user;
  - uploads: 20 per hour per publisher.

  So a reader with a large library is never throttled during a normal
  check-in.
- **Admin takedown:**
  - `POST /api/v1/admin/books/:bookId/withdraw` takes `{ reason }` and sets
    `withdrawn_at`. It also unpublishes the book.
  - `POST /api/v1/admin/books/:bookId/reinstate` clears the withdrawal.
  - Both are audited.

  It lives in `backend/src/middleware/rate-limit.ts`, so the existing login
  routes can adopt it later.

### Mobile and the portal (minimum touch)

- **Mobile:** `ReaderScreen` stops calling the removed `/library/:id/asset`
  and `/key` endpoints. It keeps its placeholder text and adds a note that
  the reader is being rebuilt. Real reading is the next project.
- **Portal:**
  - the book edit page gains an "Upload EPUB" control, which streams the
    file with the portal header;
  - it shows a version list with state badges;
  - rejection reasons are translated by reason code, in Albanian and English;
  - the page polls while an asset is processing;
  - a ready version that is not live gets a "Make this version live"
    button, which asks for confirmation and explains that readers will
    receive it;
  - publish stays disabled until there is a ready current asset.

  No other portal changes: the design pass comes later.

### Seed, configuration and docs

- **Seed:** the seed builds its sample EPUBs with the existing `buildSampleEpub`,
  runs them through the ingestion service synchronously, in-process with the
  `none` scanner, and marks them ready. It no longer writes `public/assets`.
- **Environment:**
  - `KMS_PROVIDER` (`local`), `DRM_LOCAL_KEK`;
  - `ASSET_STORAGE_DIR`;
  - `SCANNER` (`none` or `clamav`), `CLAMAV_HOST`, `CLAMAV_PORT`;
  - `LICENCE_SIGNING_PRIVATE_KEY`, `LICENCE_DAYS` (default 30);
  - `ASSET_MAX_UPLOAD_BYTES`, `ASSET_PROCESSING_TIMEOUT_MS`.

  All are validated in `env.ts`. In production, `local` KMS and the `none`
  scanner are refused, and a development KEK or signing key is refused.
  `.env.example` documents a command to generate each key.
- **docker compose:** a new `worker` service running the same image with
  `npm run worker`. A `clamav` service is optional, behind a compose profile,
  so normal startup stays light.
- **README:**
  - a "Books and DRM" section covering the pipeline, the policy and the
    endpoints;
  - the §17.10 accepted residual risk stated plainly;
  - "local KMS is a development substitute";
  - the worker network-isolation requirement for production.

### Testing (§13.1, §17.8)

- **Unit tests:**
  - the GCM round trip; tampered ciphertext, nonce, tag or AAD fail closed;
  - nonce uniqueness across 10,000 encryptions;
  - the local KMS wrap and unwrap, and that the wrong KEK fails;
  - the licence round trip: a Node-side "client" uses WebCrypto-compatible
    primitives to unwrap the DEK with the device private key and decrypt a
    sample asset;
  - a tampered licence signature is detected;
  - the policy function with all reason codes;
  - rate-limit windows;
  - the env refusals in production.
- **Ingestion tests, with crafted fixtures:**
  - a valid EPUB 2 and a valid EPUB 3 become `ready` with the right extracted
    metadata and a cover;
  - each reason code has a fixture: a ZIP bomb by ratio, path traversal,
    duplicate entries, a missing mimetype, mimetype not first, a bad
    container, a missing title, scripted content, remote resources, too many
    entries, an oversized upload (413 before parsing), and encryption.xml;
  - a timeout gives `failed`;
  - a failed re-upload leaves the previous current asset live.
- **Integration tests:**
  - a reader without an entitlement, with a refunded purchase, with a
    suspended account, or with a revoked or foreign device gets 403
    `ASSET_ACCESS_DENIED`, and the reason code is logged (§13.1 #1, #4);
  - the device limit, the removal limit and the support reset;
  - a device idle for more than 90 days stops counting; removing a device
    that never received a licence doesn't count;
  - a first upload goes live automatically; a second ready version stays
    not live until activated; activation and rollback work; a late retry
    never moves the pointer;
  - a superseded asset request returns 409 with the current asset for an
    entitled owner, but 403 for anyone else;
  - licence status returns valid, revoked (refund, suspension, revoked
    device, withdrawn book), replaced and unknown as appropriate;
  - suspension blocks ordinary API calls within the cache window (tested with
    the cache cleared);
  - an admin retry re-queues a failed asset; withdrawing a book blocks grants
    and reinstating restores them;
  - a download token works for 5 minutes, then fails; an unknown token gets
    404; Range requests work;
  - the full path: upload, worker, ready, publish, buy, register device,
    download, licence, then decrypt in the test with the device private key,
    and the bytes match the original EPUB (§13.1 #6);
  - changing `JWT_SECRET` does not change or expose any DEK (key separation);
  - log redaction: grant tokens, licence contents and DEKs never appear in the
    logs captured during the tests;
  - `/assets/*` gives 404;
  - the old `/library/:id/key` gives 404.

## Calls I made (to check)

- The upload limit is 100 MB. The uncompressed limit is 500 MB, at most
  10,000 entries and at most a 100:1 compression ratio.
- EPUBs with scripts or remote resources are **rejected**, not stripped,
  because stripping silently changes the publisher's book. Publishers get a
  clear reason code.
- Covers found in the EPUB are stored unencrypted and served publicly, since
  covers are storefront material (§11.2). The cover only fills
  `cover_image_url` if the publisher has left it empty.
- Ciphertext is delivered through a backend proxy with a 5-minute token, not
  signed storage URLs. That fits local storage and gives tighter control
  (§17.2 #1); it can switch later.
- Licences are for the book's current version only. A new upload means
  readers download the new version at their next renewal. Old versions stay
  stored but no longer get licences.
- A book unpublished after purchase stays readable by its owners.
- In-memory rate limits per instance are enough for now, and documented as
  such.
- Existing dev books are set unavailable by the migration and recreated by
  the seed. There are no production books yet.
- `users.status` and an admin suspend endpoint are added, because the
  approved policy covers suspended accounts. Suspension applies to every
  authenticated request within about 30 seconds, through a per-process
  status cache in `requireAuth`.
- The online check-in is one bulk licence-status call that tells the owning
  device the real outcome for its own licences. Requests for a replaced
  asset get `409 ASSET_SUPERSEDED` (only after every other check passes).
  Library items expose the current asset.
- Rate limits are per device and asset, with a per-user backstop.
- Retries never move the live pointer. Failed originals are kept 7 days for
  an admin retry.
- An admin takedown (withdraw/reinstate) blocks delivery of every version.
- `web` is not a device platform for now. On iPhone the device key should
  live in the Keychain so it survives a reinstall; that is the next
  project's job.

## Left to the builder

- The exact SQL, the worker polling interval and the backoff timing.
- The yauzl and fast-xml-parser usage details, within the limits above.
- Fixture generation: building crafted EPUBs and ZIPs in tests through the
  existing `createZipArchive` helper (extended for compression where needed).
- Portal component structure for the upload UI.
