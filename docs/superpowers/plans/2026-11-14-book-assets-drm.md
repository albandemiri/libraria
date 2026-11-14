# Book Assets and DRM (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real EPUBs flow through the backend end to end: validated upload,
isolated processing, per-asset envelope encryption, private storage,
devices, short-lived download grants and 30-day device-bound licences. The
P0 legacy key paths are removed.

**Architecture:**
- **Layout:** a new `backend/src/drm/` module (spec §17.5) with
  provider-neutral interfaces for KMS, object storage, malware scanning and
  licence signing, plus local adapters.
- **Ingestion:** runs in a separate worker process (`npm run worker`) that
  claims jobs from Postgres and parses each EPUB inside a resource-limited
  `worker_threads` Worker.
- **Delivery:** every download and decryption grant goes through one policy
  function, and every decision is audited.

**Tech Stack:**
- **Existing:** Node 24, Express 5, TypeScript, zod 4, pg, PostgreSQL 15,
  node:test via tsx, Biome.
- **New dependencies:** `yauzl` (ZIP reading) and `fast-xml-parser` (OPF and
  container XML).
- **Crypto:** Node `crypto` only: AES-256-GCM, P-256 ECDH, HKDF-SHA-256,
  Ed25519.
- **Portal:** the existing React app.

**Spec:** `docs/superpowers/specs/2026-11-14-book-assets-drm-design.md`. It
governs, together with `docs/superpowers/specs/Libraria_Technical_Architecture_Specification_v2.1.pdf`
§8, §17 and Appendix A §16.2.

## Global Constraints

- **Asset states** (enum `asset_state`): `uploaded`, `validating`,
  `scanning`, `encrypting`, `storing`, `ready`, `rejected`, `failed`.
  "Ready, not live" means `state = 'ready'` and the asset is not the book's
  `current_asset_id`.
- **Asset encryption:**
  - AES-256-GCM with a 256-bit random DEK per asset version and a 96-bit
    random nonce per encryption.
  - The AAD is the UTF-8 string `${assetId}|${version}|AES-256-GCM|${kmsKeyId}`.
  - Plaintext DEKs are never persisted and never logged. DEK buffers are
    zeroed after use.
- **Device licences:**
  - P-256 SPKI public keys, base64url-encoded.
  - Wrap = ECDH(ephemeral P-256, device key), then HKDF-SHA-256 with
    `ikm = shared secret`, `salt = UTF-8(licenceId)`,
    `info = "libraria-licence-v1"` and length 32, then AES-256-GCM with a
    12-byte IV and AAD `${licenceId}|${assetId}|${deviceId}`.
  - `alg` label: `"ECDH-ES+HKDF-SHA256+A256GCM"`.
  - Signature: Ed25519 over canonical JSON (keys sorted recursively, no
    whitespace) of the licence without `signature`, encoded as base64url.
- **Policy numbers:**
  - `LICENCE_DAYS = 30`;
  - at most 5 counted devices: not revoked, and `last_seen_at` within 90
    days;
  - 3 counted removals per rolling 365 days, counted only if
    `licence_issued`;
  - download tokens are 256 random bits, live 5 minutes and are reusable
    within that time; only the SHA-256 hash is stored;
  - uploads up to `ASSET_MAX_UPLOAD_BYTES = 100 MB`;
  - at most 500 MB uncompressed, at most 10,000 entries, compression ratio up
    to 100:1 for entries over 1 MB;
  - `ASSET_PROCESSING_TIMEOUT_MS = 60000`;
  - 3 job attempts with backoff; failed originals kept 7 days.
- **Rate limits** (in-memory, per instance):
  - download and decryption authorizations: 10 per hour per device and asset;
  - licence status: 60 per hour per device;
  - 300 grants per hour per user;
  - uploads: 20 per hour per publisher.
- **Ingestion reason codes:** `NOT_AN_EPUB`, `ARCHIVE_TOO_LARGE`,
  `TOO_MANY_ENTRIES`, `COMPRESSION_RATIO`, `UNSAFE_PATH`, `DUPLICATE_ENTRY`,
  `INVALID_CONTAINER`, `INVALID_PACKAGE`, `UNSUPPORTED_ENCRYPTION`,
  `ENCRYPTED_ARCHIVE`, `SCRIPTED_CONTENT`, `REMOTE_RESOURCES`,
  `UNSUPPORTED_MEDIA`, `MALWARE_DETECTED`, `SCAN_UNAVAILABLE`,
  `PROCESSING_TIMEOUT`, `PROCESSING_ERROR`.
- **Authorization reason codes** (logged only): `ACCOUNT_SUSPENDED`,
  `NO_ENTITLEMENT`, `BOOK_WITHDRAWN`, `ASSET_UNAVAILABLE`, `DEVICE_UNKNOWN`,
  `DEVICE_REVOKED`, `RATE_LIMITED`.
  - Clients see only `403 ASSET_ACCESS_DENIED` or `429 RATE_LIMITED`.
  - The exception is `409 ASSET_SUPERSEDED`, returned only after every other
    check passes.
- **New API error codes** (added to `errorCodes`): `ASSET_PROCESSING`,
  `ASSET_ACCESS_DENIED`, `ASSET_SUPERSEDED`, `DEVICE_LIMIT_REACHED`,
  `DEVICE_REMOVAL_LIMIT`, `ACCOUNT_SUSPENDED`, `RATE_LIMITED`.
- **Production refusals** in `env.ts`: when `NODE_ENV=production`, startup
  refuses `KMS_PROVIDER=local`, `SCANNER=none`, the built-in development KEK
  and the built-in development licence signing key.
- **Key separation:** no DRM key is derived from `JWT_SECRET` or any other
  secret. `deriveBookKey` is deleted.
- **Never in logs, error bodies or the database:** plaintext EPUB bytes,
  DEKs, grant tokens, licence `wrappedKey` contents.
- **Migrations:** forward-only, in a new file
  `0006_book_assets_drm.sql`; 0001–0005 are never edited.
- **Commits and Docker:** do not commit or push unless the user asks; skip
  the "Commit" steps. Keep Docker checks quick: the clamav service sits
  behind a compose profile and is not started by default.
- **Done means** all of these pass:
  - `backend/`: `npm run lint`, `npm run typecheck`, `npm test`,
    `npm run test:integration` (with `docker compose up -d db`),
    `npm run build`;
  - `portal/`: lint, typecheck, test and build;
  - `mobile/`: `npm run typecheck`.

## Review Focus

1. **A huge or non-EPUB upload.** It must get `413 PAYLOAD_TOO_LARGE` as soon
   as the stream passes 100 MB, without buffering the rest. Tested in
   Task 5.
2. **Two concurrent registrations of a 6th device.** Exactly one wins and
   at most 5 are counted. Tested in Task 6.
3. **A worker that crashes mid-job.** Its job must not stay `running`
   forever: a lock older than 3× the timeout is reclaimed and retried.
   Tested in Task 5.
4. **A garbage, wrong-curve or private-key `publicKey` on device
   registration.** Must get `400 VALIDATION_FAILED`, never 500. Tested in
   Task 6.
5. **A Range header beyond the ciphertext size, or malformed.** Must get
   `416` or the full body, never a crash or a partial wrong body. Tested in
   Task 7.

---

### Task 1: DRM crypto core (encryption, local KMS, device wrapping, licence signing)

**Files:**
- Create:
  - `backend/src/drm/encryption.service.ts`
  - `backend/src/drm/key-management.service.ts`
  - `backend/src/drm/adapters/local-kms.ts`
  - `backend/src/drm/licence-crypto.ts`
  - `backend/src/drm/canonical-json.ts`
- Modify:
  - `backend/src/config/env.ts`: `KMS_PROVIDER` (`local`, default `local`),
    `DRM_LOCAL_KEK` (base64 of 32 bytes, with a built-in dev default),
    `LICENCE_SIGNING_PRIVATE_KEY` (Ed25519 PKCS#8 PEM, with a built-in dev
    default), `LICENCE_DAYS` (default 30);
  - `backend/.env.example` and `.env.example`: document these, with
    generation commands for both keys.
- Test:
  - `backend/src/drm/encryption.service.test.ts`
  - `backend/src/drm/key-management.service.test.ts`
  - `backend/src/drm/licence-crypto.test.ts`
  - `backend/src/config/env.test.ts`

**Interfaces:**
- **Produces (`encryption.service.ts`):**
  - `assetAad(a: { assetId: string; version: number; kmsKeyId: string }): Buffer`
  - `encryptAsset(plaintext: Buffer, dek: Buffer, aad: Buffer): { ciphertext: Buffer; nonce: Buffer; authTag: Buffer }`
  - `decryptAsset(ciphertext: Buffer, dek: Buffer, nonce: Buffer, authTag: Buffer, aad: Buffer): Buffer`
    throws `DecryptionError` on any authentication failure.
- **Produces (`key-management.service.ts`):**
  - `interface KeyManagement { generateDataKey(): Promise<{ plaintext: Buffer; wrapped: Buffer; keyId: string; keyVersion: string }>; unwrap(wrapped: Buffer, keyId: string, keyVersion: string): Promise<Buffer> }`
  - `export function keyManagement(): KeyManagement`: a cached instance
    chosen from `KMS_PROVIDER`.
  - Local adapter: `keyId = 'local'`, `keyVersion = 'v1'`. The wrapped format
    is `nonce(12) | tag(16) | ciphertext(32)` under the KEK, with AAD
    `"libraria-dek-v1"`.
- **Produces (`licence-crypto.ts`):**
  - `wrapDekForDevice(dek: Buffer, devicePublicKeySpkiB64u: string, ids: { licenceId: string; assetId: string; deviceId: string }): { alg: string; epk: string; iv: string; ciphertext: string; tag: string }`
  - `unwrapDekForDevice(wrapped, devicePrivateKey: crypto.KeyObject, ids): Buffer`.
    This is the client-side reference implementation, used by tests and by
    the next project's client.
  - `signLicence(payload: object): string` and
    `verifyLicence(licence: object & { signature: string }, publicKeyPem: string): boolean`.
  - `licenceSigningPublicKeyPem(): string`
  - `parseDevicePublicKey(spkiB64u: string): crypto.KeyObject` throws
    `InvalidDeviceKeyError` unless the key is a P-256 public key.
- **Produces (`canonical-json.ts`):** `canonicalJson(value: unknown): string`.

- [ ] **Step 1: Write failing tests.**
  - **Encryption:**
    - a round trip of 1 MB of random bytes;
    - flipping one bit in the ciphertext, nonce, tag or AAD throws
      `DecryptionError`;
    - 10,000 `encryptAsset` calls give 10,000 distinct nonces;
    - `assetAad({assetId:'a',version:2,kmsKeyId:'local'})` equals
      `Buffer.from('a|2|AES-256-GCM|local')`.
  - **KMS:**
    - generate, then unwrap, returns the same plaintext;
    - unwrap with a different KEK throws;
    - two `generateDataKey` calls give different DEKs and different wrapped
      blobs.
  - **Licence crypto:**
    - generate a P-256 key pair in the test, wrap a DEK for it and unwrap it
      with the private key;
    - unwrapping with another device's private key throws;
    - changing any id in the AAD throws;
    - `parseDevicePublicKey` rejects: garbage, an Ed25519 key, a P-384 key, a
      private key encoding and an empty string;
    - `signLicence` then `verifyLicence` is true, and changing `expiresAt` by
      1 ms makes it false;
    - `canonicalJson({b:1,a:{d:2,c:[3,{f:1,e:2}]}})` equals
      `'{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}'`.
  - **Key separation:** derive nothing from `JWT_SECRET`. Assert that
    `generateDataKey` output does not change when `process.env.JWT_SECRET`
    changes: the DEKs are random, and the KEK comes only from
    `DRM_LOCAL_KEK`.
  - **Env:**
    - production with `KMS_PROVIDER=local` throws `/KMS_PROVIDER=local/`;
    - production with the dev KEK throws, and with the dev signing key throws;
    - a `DRM_LOCAL_KEK` that is not 32 bytes throws.

- [ ] **Step 2: Run** `cd backend && npx tsx --test src/drm/*.test.ts src/config/env.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** with Node `crypto` (`createCipheriv('aes-256-gcm')`, `createECDH` or `diffieHellman` with KeyObjects, `hkdfSync`, `sign(null, …)` for Ed25519). Zero the DEK and shared-secret buffers with `.fill(0)` after use.

- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `npm run lint` and `npm run typecheck`.

- [ ] **Step 5: Commit**, but only if authorised: `feat(drm): envelope encryption, local KMS and device licence crypto`.

---

### Task 2: Object storage and malware scanner adapters

**Files:**
- Create:
  - `backend/src/drm/object-storage.ts` (interface and factory);
  - `backend/src/drm/adapters/local-storage.ts`;
  - `backend/src/drm/malware-scanner.ts` (interface and factory);
  - `backend/src/drm/adapters/clamav-scanner.ts` (clamd `INSTREAM` over TCP);
  - `backend/src/drm/adapters/none-scanner.ts`.
- Modify:
  - `backend/src/config/env.ts`: `ASSET_STORAGE_DIR` (default
    `./var/asset-storage`), `SCANNER` (`none` or `clamav`, default `none`),
    `CLAMAV_HOST`, `CLAMAV_PORT` (default 3310); in production, `SCANNER=none`
    is refused;
  - `.gitignore`: add `backend/var/`;
  - both `.env.example` files.
- Test:
  - `backend/src/drm/adapters/local-storage.test.ts`
  - `backend/src/drm/adapters/clamav-scanner.test.ts`, using a local fake TCP
    server.

**Interfaces:**
- **Produces:**
  - `interface ObjectStorage { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; getRange(key: string, start: number, endInclusive: number): Promise<Buffer>; head(key: string): Promise<{ size: number } | null>; delete(key: string): Promise<void> }`
  - `objectStorage(): ObjectStorage`
  - Keys must match `/^(quarantine|assets|covers)\/[A-Za-z0-9._\/-]+$/` with
    no `..`; others throw `InvalidObjectKeyError`. Writes are atomic: write
    to a temporary file, then rename.
  - `interface MalwareScanner { scan(data: Buffer): Promise<{ result: 'clean' } | { result: 'infected'; signature: string } | { result: 'error'; message: string }> }`
  - `malwareScanner(): MalwareScanner`

- [ ] **Step 1: Write failing tests.**
  - **Storage:**
    - put, get and head round trip;
    - `getRange(key, 2, 5)` returns 4 bytes;
    - delete, then head, returns null;
    - the keys `../x`, `assets/../../etc`, `/abs` and `other/x` throw
      `InvalidObjectKeyError`;
    - the storage directory is created on demand.
  - **ClamAV:**
    - the fake clamd replies `stream: OK`, giving clean, and
      `stream: Eicar-Test-Signature FOUND`, giving infected with the
      signature;
    - a refused connection gives error;
    - a server that never replies gives error after a 10 s timeout. Make the
      timeout injectable so the test uses 100 ms.
  - **Env:** production with `SCANNER=none` throws.

- [ ] **Step 2: Run** `npx tsx --test src/drm/adapters/*.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the adapters. ClamAV `zINSTREAM` sends 4-byte big-endian chunk lengths and ends with zero.

- [ ] **Step 4: Run** the tests again. Expected: PASS. Then lint and typecheck.

- [ ] **Step 5: Commit**, but only if authorised: `feat(drm): local object storage and malware scanner adapters`.

---

### Task 3: EPUB validation and parsing in a resource-limited thread

**Files:**
- Create:
  - `backend/src/drm/epub/validate-epub.ts`, the pure function;
  - `backend/src/drm/epub/epub-worker-thread.ts`, the thread entry;
  - `backend/src/drm/epub/run-validation.ts`, which spawns the Worker with
    limits.
- Modify:
  - `backend/package.json`: add the dependencies `yauzl` and
    `fast-xml-parser`, and `@types/yauzl` as a dev dependency;
  - `backend/src/utils/epub.ts`: extend `createZipArchive` with an optional
    per-entry `compress: boolean` (deflate), so tests can build ZIP bombs and
    mixed archives.
- Test:
  - `backend/src/drm/epub/validate-epub.test.ts`
  - `backend/src/drm/epub/fixtures.ts`, a test helper that builds EPUBs.

**Interfaces:**
- **Produces:**
  - `type EpubReasonCode` is the union of the ingestion reason codes in the
    Global Constraints, minus the scan, timeout and processing ones.
  - `interface ExtractedMetadata { title: string; creators: string[]; language: string; identifiers: string[]; isbn: string | null; description: string | null; tocSummary: Array<{ label: string; depth: number }>; hasCover: boolean; epubVersion: '2.0' | '3.0' | string }`
  - `validateEpub(data: Buffer): Promise<{ ok: true; metadata: ExtractedMetadata; cover: { mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: Buffer } | null } | { ok: false; reasonCode: EpubReasonCode; detail: string }>`
    - `detail` is safe, publisher-facing English. It never contains server
      paths.
    - `isbn` is the first identifier that is a valid ISBN-13 (checksum
      verified, hyphens removed).
    - `tocSummary` comes from the EPUB3 nav, or the NCX for EPUB2, capped at
      200 items.
  - `runValidation(data: Buffer, opts?: { timeoutMs?: number; maxOldGenerationSizeMb?: number }): Promise<ValidateResult | { ok: false; reasonCode: 'PROCESSING_TIMEOUT' | 'PROCESSING_ERROR'; detail: string }>`.
    The default memory limit is 512 MB; the timeout comes from env.
  - Fixture builder: `buildEpub(opts: { version?: '2'|'3'; title?: string|null; language?: string|null; isbn?: string; extraEntries?: Array<{ path: string; data: Buffer; compress?: boolean }>; mimetypeFirst?: boolean; mimetype?: string; manifestExtras?: string; spineMissing?: boolean; scripted?: boolean; remote?: boolean; cover?: boolean; encryptionXml?: string }): Buffer`

- [ ] **Step 1: Write failing tests.** Each test asserts the exact
  `reasonCode`.
  - **Valid books:**
    - `'valid EPUB 3 with cover'`: `ok`, the title and language extracted,
      `isbn` equals the fixture's ISBN-13 without hyphens, `hasCover` true,
      `cover.mediaType` `image/png`, and a non-empty `tocSummary`;
    - `'valid EPUB 2 with NCX'`: `ok`, `epubVersion` `'2.0'`, with the cover
      found through `<meta name="cover">`.
  - **Rejections:**
    - `NOT_AN_EPUB` for a PNG file, a ZIP without `mimetype`, a ZIP with
      `mimetype` not first, and `mimetype` `application/zip`;
    - `UNSAFE_PATH` for `../evil.xhtml`, `/abs.xhtml`, `a\\b.xhtml` and
      `C:/x.xhtml`;
    - `DUPLICATE_ENTRY` for `OEBPS/a.xhtml` together with `oebps/A.xhtml`;
    - `TOO_MANY_ENTRIES` for 10,001 empty entries;
    - `COMPRESSION_RATIO` for a 50 MB run of zeros deflated;
    - `ARCHIVE_TOO_LARGE` when the declared uncompressed total exceeds 500 MB;
      craft the central directory sizes without allocating 500 MB, then
      assert;
    - `INVALID_CONTAINER` for a missing container.xml and for a rootfile
      pointing at a missing OPF;
    - `INVALID_PACKAGE` for a missing `dc:title`, a missing `dc:language`, an
      empty spine, a spine idref without a manifest item, and malformed XML;
    - `INVALID_PACKAGE` for a DOCTYPE with an entity (an XXE attempt), with no
      file read;
    - `UNSUPPORTED_ENCRYPTION` for encryption.xml with a non-font algorithm;
      font obfuscation (`http://www.idpf.org/2008/embedding`) is accepted;
    - `ENCRYPTED_ARCHIVE` when the ZIP general-purpose bit 0 is set;
    - `SCRIPTED_CONTENT` for `properties="scripted"`, for `<script` in an
      XHTML spine item, and for a `text/javascript` manifest item;
    - `REMOTE_RESOURCES` for `properties="remote-resources"` and for a
      manifest href `https://cdn.example/x.css`;
    - `UNSUPPORTED_MEDIA` for an `application/x-msdownload` manifest item.
  - **Thread limits:**
    - `runValidation` with `timeoutMs: 50` on a fixture that makes the thread
      busy-loop (test-only hook through an env flag read in the thread
      entry) gives `PROCESSING_TIMEOUT`, and the thread is terminated;
    - a thrown error inside the thread gives `PROCESSING_ERROR`.

- [ ] **Step 2: Run** `npx tsx --test src/drm/epub/*.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Read the ZIP with `yauzl.fromBuffer(..., { lazyEntries: true, validateEntrySizes: true })`.
  - Check entry headers and sizes before reading any data.
  - Inflate only the entries needed (container, OPF, nav or NCX, XHTML spine
    items for the script scan, cover), each with a hard per-entry byte cap.
  - Parse XML with `XMLParser({ processEntities: false, allowBooleanAttributes: true })`.
    Reject any `<!DOCTYPE` that contains `<!ENTITY`.

- [ ] **Step 4: Run** the tests again. Expected: PASS. Then lint and typecheck.

- [ ] **Step 5: Commit**, but only if authorised: `feat(drm): hardened EPUB validation and metadata extraction`.

---

### Task 4: DRM schema and P0 removal of legacy key paths

**Files:**
- Create: `backend/db/migrations/0006_book_assets_drm.sql`.
- Modify:
  - `backend/src/utils/crypto.ts`: delete the file, including
    `deriveBookKey`; move anything still needed into `drm/`, then delete
    `crypto.test.ts` accordingly;
  - `backend/src/routes/library.ts`: remove `GET /:bookId/asset` and
    `/:bookId/key`;
  - `backend/src/app.ts`: remove the `/assets` static route;
  - `backend/src/routes/publisher.ts`:
    - remove `POST /books/:id/asset` and `setAssetSchema`;
    - publish requires `current_asset_id` pointing to a `ready` asset, else
      400 `ASSET_REQUIRED`;
    - `hasAsset` in `formatPublisherBook` means "has a ready current asset";
    - `fileSizeBytes` comes from the current asset's `original_size_bytes`;
  - `backend/src/routes/books.ts`: remove the legacy column comment;
  - `backend/test/integration/harness.ts`: add `createBook({ available })`,
    which creates a ready asset through `createReadyAsset(bookId, epub?: Buffer)`
    (real encryption, local KMS and local storage under a per-run temporary
    `ASSET_STORAGE_DIR` set in `test/integration/env.ts`), and sets
    `current_asset_id`;
  - `backend/src/db/seed.ts`: covered in Task 5 (seed through the pipeline).
    Until then the seed creates drafts only; mark that with a TODO pointing
    to Task 5;
  - `mobile/src/screens/ReaderScreen.tsx`: stop calling `/library/:id/asset`
    and `/key`, keeping the placeholder content with a comment "real reader:
    next project".
- Test:
  - `backend/test/integration/drm-schema.test.ts` (new);
  - the existing library, publisher, publisher-isolation and commission tests
    must keep passing.

**Interfaces:**
- **Produces, in `0006`** (columns exactly as in the spec "Data" section):
  - `users.status` (enum `user_status`: `active`, `suspended`);
  - the enum `asset_state`;
  - the tables `book_assets`, `asset_keys`, `asset_jobs` (enum
    `asset_job_state`: `queued`, `running`, `done`, `failed`; with
    `run_after TIMESTAMPTZ` for backoff), `devices`, `device_removals`,
    `download_grants`, `licences`, `asset_access_logs`, `audit_events`;
  - `books.current_asset_id` (FK to `book_assets`), `books.withdrawn_at`,
    `books.withdrawn_reason`;
  - the old `available_needs_asset` constraint is dropped, then
    `UPDATE books SET is_available = false`, then the legacy columns are
    dropped, then `CHECK (NOT is_available OR current_asset_id IS NOT NULL)`
    is added;
  - `UNIQUE (book_id, version)` on `book_assets`;
  - a partial unique index allowing at most one non-terminal asset per book
    (`state NOT IN ('ready','rejected','failed')`);
  - a unique `(user_id, public_key_spki)` on devices;
  - a unique `token_sha256` on download grants.
- **Produces (harness):** `createReadyAsset(bookId: string, epub?: Buffer): Promise<{ assetId: string; version: number }>`.
- **Produces:** `backend/src/drm/asset-repository.ts` with
  `currentReadyAsset(bookId): Promise<AssetRow | null>` and
  `type AssetRow`, for later tasks.

- [ ] **Step 1: Write failing tests** in `drm-schema.test.ts`:
  - `'available book requires a current asset'`: inserting an available book
    without `current_asset_id` violates the CHECK.
  - `'one in-flight asset per book'`: a second `uploaded` asset for the same
    book violates the unique index; `ready` plus `uploaded` is allowed.
  - `'legacy key endpoints are gone'`:
    - `GET /library/:id/key` and `/asset` return 404 `ROUTE_NOT_FOUND`
      (after `requireAuth`, for an owner);
    - `GET /assets/books/x.epub.enc` returns 404;
    - `POST /publisher/books/:id/asset` returns 404.
  - `'publish requires a ready current asset'`: a draft without an asset gets
    400 `ASSET_REQUIRED`; after `createReadyAsset` it gets 200.
  - `grep`-style unit test (`src/drm/key-separation.test.ts`): no source file
    under `src/` contains `deriveBookKey` or `JWT_SECRET` outside
    `config/env.ts`, `auth/tokens.ts` and `auth/portal-session.ts`.

- [ ] **Step 2: Run** `npx tsx --test --test-concurrency=1 test/integration/drm-schema.test.ts` and `npx tsx --test src/drm/key-separation.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the migration, the removals, the harness helper and `asset-repository.ts`.

- [ ] **Step 4: Run** the full `npm test` and `npm run test:integration`, then `cd ../mobile && npm run typecheck`. Expected: all PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(drm): asset schema; remove JWT-derived keys and public asset paths`.

---

### Task 5: Ingestion service, worker process, upload and activation API, cover route, seed

**Files:**
- Create:
  - `backend/src/drm/asset-ingestion.service.ts`
  - `backend/src/drm/drm.audit.ts`
  - `backend/src/worker.ts`, the process entry
  - `backend/src/routes/assets-publisher.ts`
  - `backend/src/middleware/rate-limit.ts`
- Modify:
  - `backend/src/routes/publisher.ts`: mount the asset routes;
  - `backend/src/routes/admin.ts`: add `POST /assets/:assetId/retry`;
  - `backend/src/routes/books.ts`: add `GET /:bookId/cover`;
  - `backend/package.json`: `"worker": "tsx src/worker.ts"` and a built
    `start:worker`;
  - `docker-compose.yml`: a `worker` service with the same image and env as
    the backend, running `command: ["sh","-c","npm run worker"]`, depending on
    db; a `clamav` service (`clamav/clamav:stable`) under
    `profiles: ["scan"]`;
  - `backend/src/db/seed.ts`: build the 3 sample EPUBs with
    `buildSampleEpub`, ingest them synchronously with `ingestNow`, activate
    and publish them;
  - `backend/src/config/env.ts`: `ASSET_MAX_UPLOAD_BYTES` (104857600) and
    `ASSET_PROCESSING_TIMEOUT_MS` (60000);
  - `backend/src/middleware/errors.ts`: add `ASSET_PROCESSING` and
    `RATE_LIMITED`.
- Test:
  - `backend/test/integration/asset-ingestion.test.ts`
  - `backend/src/middleware/rate-limit.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1–4 (`keyManagement`, `encryptAsset`, `assetAad`,
  `objectStorage`, `malwareScanner`, `runValidation`, `asset-repository`,
  the schema).
- **Produces:**
  - **Ingestion functions:**
    - `enqueueUpload(bookId, uploadedBy, data: Buffer): Promise<AssetRow>`
      creates version n+1 in state `uploaded`, puts the original at
      `quarantine/{assetId}` and inserts the job.
    - `processNextJob(): Promise<'processed' | 'idle'>`. It claims a job with
      `FOR UPDATE SKIP LOCKED` where `state='queued'` and `run_after <= now()`,
      or where the job is `running` with `locked_at < now() - 3 × timeout`
      (stale reclaim). It runs the stages and updates the asset state at each
      one.
    - `ingestNow(bookId, uploadedBy, data): Promise<AssetRow>` runs enqueue
      and process in one go, for the seed and tests.
    - `activateAsset(bookId, assetId, actorId): Promise<void>`
  - **Rate limiting:**
    `rateLimit(opts: { name: string; limit: number; windowMs: number; key: (req) => string }): RequestHandler`
    returns 429 `RATE_LIMITED` with a `Retry-After` header.
    `resetRateLimits()` is for tests.
  - **Audit:** `audit(event: { actorId: string | null; action: string; resourceType: string; resourceId: string; metadata?: Record<string, unknown> }): Promise<void>`
    and `logAssetAccess(...)`, used in Task 7. Metadata goes through a
    redaction function that drops keys matching
    `/token|key|dek|secret|signature|wrapped/i`.
  - **Routes**, under `/api/v1/publisher/books/:bookId/assets`:
    - `POST /`: a raw body, `express.raw({ type: ['application/epub+zip','application/octet-stream'], limit: env.ASSET_MAX_UPLOAD_BYTES })`
      gives 413 `PAYLOAD_TOO_LARGE` when exceeded. Returns 202 `{ asset }`, or
      409 `ASSET_PROCESSING` if an in-flight asset exists.
    - `GET /` lists versions, newest first.
    - `GET /:assetId` returns one asset with `extractedMetadata`.
    - `POST /:assetId/activate` returns 200, or 409 `ASSET_PROCESSING` if the
      asset is not ready.
    - The publisher scope uses `resolvePublisherScope` and `bookWriteScope`.
    - The asset JSON shape is
      `{ id, version, state, reasonCode, reasonDetail, originalSizeBytes, isCurrent, createdAt, readyAt, activatedAt, extractedMetadata? }`.
      It never includes object keys, nonces, tags or key references.
  - **Cover:** `GET /api/v1/books/:bookId/cover` serves the stored cover with
    the right `Content-Type`, `Cache-Control: public, max-age=86400` and
    `X-Content-Type-Options: nosniff`. It returns 404 when there is no cover.
    The worker sets `books.cover_image_url = '/api/v1/books/:id/cover'` only
    when it is null.
  - **Worker process:** `worker.ts` loops `processNextJob()`, sleeps 1 s when
    idle, and logs JSON lines without secrets. On failure, backoff is 30 s,
    then 2 min. Quarantine originals are deleted on `ready` and `rejected`,
    and after 7 days for `failed` (a sweep in the same loop).

- [ ] **Step 1: Write failing tests** in `asset-ingestion.test.ts`. Call
  `processNextJob()` directly; don't start the poller.
  - `'upload, process, ready, first version goes live'`:
    - POST a valid EPUB 3 fixture as staff, getting 202 in state `uploaded`;
    - `processNextJob()` returns `'processed'`;
    - the asset is `ready`, `isCurrent` true, and `extractedMetadata.title`
      matches;
    - `books.current_asset_id` is set;
    - the quarantine object is deleted;
    - `assets/{id}/v1` exists, and its SHA-256 equals `ciphertext_sha256`;
    - `asset_keys.wrapped_dek` is 60 bytes and is not the DEK: unwrap gives
      32 bytes that decrypt the stored ciphertext back to the original EPUB.
  - `'a second ready version waits for activation'`: v2 is ready and
    `isCurrent` false, and the book still points to v1. After `activate`, it
    points to v2. Activating v1 again works (rollback).
  - `'a late retry never moves the pointer'`: with v2 failed and then
    re-queued by admin retry, and v3 activated, processing v2 to ready leaves
    the current asset at v3.
  - `'rejected upload never touches the live book'`: with v1 live, a scripted
    upload ends `rejected` with `SCRIPTED_CONTENT`, the book stays on v1, and
    the quarantine original is deleted.
  - `'one in-flight upload per book'`: a second POST while the first is
    `uploaded` gets 409 `ASSET_PROCESSING`.
  - `'oversized upload is refused while streaming'` (Review Focus 1): POST
    101 MB of zeros as a stream gets 413 `PAYLOAD_TOO_LARGE`, and no
    `book_assets` row exists. Lower `ASSET_MAX_UPLOAD_BYTES` for the test
    process to 1 MB through the env, then send 2 MB.
  - `'scanner error retries, then fails, and admin retry re-queues'`: inject a
    failing scanner through `setMalwareScannerForTests`. After three attempts
    (advance `run_after` by updating rows) the asset is `failed` with
    `SCAN_UNAVAILABLE` and the original is kept. Admin
    `POST /admin/assets/:id/retry` gives 202, and with a clean scanner the
    asset becomes ready.
  - `'stale running job is reclaimed'` (Review Focus 3): set a job to
    `running` with `locked_at = now() - interval '1 hour'`; `processNextJob()`
    reclaims it, and the asset ends `ready`.
  - `'publisher cannot upload to another publisher's book'`: 404. A
    publisher's spoofed `publisherId` is ignored.
  - `'cover is served and fills an empty cover url'`.
  - `'audit events for rejection and failure contain no secrets'`.
  - **Unit (`rate-limit.test.ts`):** 3 requests per window allowed, the 4th
    gets 429 with `Retry-After`; the window slides; keys are independent.

- [ ] **Step 2: Run** `npx tsx --test --test-concurrency=1 test/integration/asset-ingestion.test.ts` and `npx tsx --test src/middleware/rate-limit.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Also run `npm run seed` against the dev database (`docker compose up -d db`): it should print three ingested books.

- [ ] **Step 4: Run** the tests, the full `npm run test:integration`, lint and typecheck. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(drm): ingestion worker, upload and activation API, cover delivery`.

---

### Task 6: Devices, account suspension and admin controls

**Files:**
- Create:
  - `backend/src/drm/device.service.ts`
  - `backend/src/routes/devices.ts`
  - `backend/src/auth/account-status.ts`, the status cache
- Modify:
  - `backend/src/middleware/auth.ts`: `requireAuth` checks the status
    through the cache;
  - `backend/src/routes/auth.ts`: both logins refuse suspended accounts;
  - `backend/src/routes/admin.ts`: `PATCH /users/:id/status`,
    `GET /users/:id/devices`, `DELETE /devices/:deviceId`,
    `POST /users/:id/device-removals/reset`;
  - `backend/src/app.ts`: mount `/devices`;
  - `backend/src/middleware/errors.ts`: add `ACCOUNT_SUSPENDED`,
    `DEVICE_LIMIT_REACHED`, `DEVICE_REMOVAL_LIMIT`.
- Test: `backend/test/integration/devices.test.ts`

**Interfaces:**
- **Produces (`account-status.ts`):**
  - `accountStatus(userId): Promise<'active' | 'suspended' | null>` with a
    30-second TTL cache;
  - `invalidateAccountStatus(userId)`;
  - `clearAccountStatusCache()` for tests.
  - `requireAuth` returns 403 `ACCOUNT_SUSPENDED` for suspended users and 401
    `UNAUTHENTICATED` for deleted users.
- **Produces (`device.service.ts`):**
  - `registerDevice(userId, { platform: 'ios'|'android'|'desktop'; displayName: string; publicKey: string }): Promise<{ device: DeviceDto; created: boolean }>`.
    It locks the user row (`SELECT … FROM users WHERE id=$1 FOR UPDATE`),
    is idempotent on the same key, and throws 409 `DEVICE_LIMIT_REACHED`
    with `details.devices`.
  - `countedDevices(userId)`
  - `touchDevice(deviceId)`, which updates `last_seen_at` and counts the
    device again subject to the limit. If the limit is reached, it throws
    `DEVICE_LIMIT_REACHED`.
  - `removeDevice(userId, deviceId, actor: 'self' | 'admin')`. Self removal
    is counted only if `licence_issued`; with 3 or more counted in 365 days
    it throws 409 `DEVICE_REMOVAL_LIMIT`. Admin removal is never counted.
  - `resetRemovals(userId, adminId)`
  - `DeviceDto = { id, platform, displayName, registeredAt, lastSeenAt, revokedAt, counted: boolean }`
- **Produces (routes):** `POST /api/v1/devices` (201, or 200 when idempotent),
  `GET /api/v1/devices`, and `DELETE /api/v1/devices/:deviceId` (204).
  `displayName` is trimmed, 1–60 characters.

- [ ] **Step 1: Write failing tests:**
  - registering 5 devices works and the 6th gets 409 `DEVICE_LIMIT_REACHED`
    with 5 devices in `details`;
  - re-registering the same key returns 200 with the same id;
  - a device whose `last_seen_at` is 91 days ago is not counted, so a new
    6th registration is allowed; touching the old device then gets
    `DEVICE_LIMIT_REACHED`;
  - **Review Focus 2:** two concurrent registrations of a 6th device
    (`Promise.all`) give exactly one 201 and one 409, with 5 counted;
  - **Review Focus 4:** a `publicKey` that is garbage, an Ed25519 SPKI, a
    P-384 SPKI or 10 KB of base64 gets 400 `VALIDATION_FAILED`;
  - removals: removing 3 devices with `licence_issued = true` works, the 4th
    gets 409 `DEVICE_REMOVAL_LIMIT`, and removing a never-licensed device
    still works;
  - an admin reset lets the reader remove again; an admin device removal
    works beyond the limit; each writes an audit event;
  - suspension:
    - an admin PATCH to `suspended` makes the reader's next `GET /library`
      return 403 `ACCOUNT_SUSPENDED` (the admin route invalidates the cache);
    - both logins are refused with 403 `ACCOUNT_SUSPENDED`;
    - reactivating restores access;
  - a reader cannot list or remove another user's device: 404.

- [ ] **Step 2: Run** `npx tsx --test --test-concurrency=1 test/integration/devices.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** the tests, the full integration suite (all existing auth tests must still pass, given the status check), lint and typecheck. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(drm): device registration and limits, account suspension`.

---

### Task 7: Authorization policy, download grants and the ciphertext proxy

**Files:**
- Create:
  - `backend/src/drm/authorization.service.ts`
  - `backend/src/drm/asset-delivery.service.ts`
  - `backend/src/routes/assets.ts`
- Modify:
  - `backend/src/app.ts`: mount `/assets` (API) and `/asset-downloads`;
  - `backend/src/routes/admin.ts`: `POST /books/:bookId/withdraw` with
    `{ reason }` (1–500 characters), and `POST /books/:bookId/reinstate`;
  - `backend/src/routes/library.ts`: `GET /` and `GET /:bookId` items gain
    `asset: { assetId, version, sizeBytes, sha256 } | null`, the current
    ready asset, or null if withdrawn;
  - `backend/src/middleware/errors.ts`: add `ASSET_ACCESS_DENIED` and
    `ASSET_SUPERSEDED`.
- Test: `backend/test/integration/asset-delivery.test.ts`

**Interfaces:**
- **Consumes:**
  - `rateLimit` and `logAssetAccess` (Task 5);
  - `touchDevice` (Task 6);
  - `currentReadyAsset` (Task 4);
  - `hasActiveEntitlement` (existing, `backend/src/commerce/entitlements.ts`).
- **Produces (`authorization.service.ts`):**
  - `authorizeAssetAccess(req: { userId; assetId; deviceId; action: 'download_authorization' | 'decryption_authorization' }): Promise<{ ok: true; asset: AssetRow; device: DeviceRow } | { ok: false; status: 403; reasonCode: AuthReasonCode } | { ok: false; status: 409; current: { assetId; version; sizeBytes; sha256 } }>`
  - Checks run in this order: account active, asset exists and is `ready`
    (else `ASSET_UNAVAILABLE`), book not withdrawn, active entitlement for
    the asset's book, device owned and not revoked, then not current (409).
  - Every outcome calls `logAssetAccess` with the reason code.
- **Produces (routes):**
  - `POST /api/v1/assets/:assetId/download-authorizations` with
    `{ deviceId: uuid }` returns 200
    `{ downloadUrl, expiresAt, sizeBytes, sha256 }`, or 403
    `ASSET_ACCESS_DENIED`, 409 `ASSET_SUPERSEDED` with `details`, or 429.
  - `GET /api/v1/asset-downloads/:token` checks only the token hash, its
    expiry and that the asset is still `ready` and not withdrawn. It
    supports `Range: bytes=a-b` (206), returns 416 for unsatisfiable ranges,
    ignores malformed Range headers (200 with the full body), and sets
    `Cache-Control: no-store`, `Content-Type: application/octet-stream`,
    `Accept-Ranges: bytes` and `ETag: "<sha256>"`. An unknown or expired
    token gets 404 `NOT_FOUND`.
- **Produces (rate limits):**
  - download authorizations: 10 per hour keyed on `user:device:asset`;
  - a per-user backstop of 300 per hour shared with Task 8, through the same
    limiter name `drm-grants-user`.

- [ ] **Step 1: Write failing tests.** Setup: a buyer who bought through
  `buy()`, a book with a ready asset and a registered device using a test
  P-256 key.
  - The happy path: download authorization returns 200; downloading the
    `downloadUrl` returns bytes whose SHA-256 equals `sha256`; Range
    `bytes=0-15` returns 206 with 16 bytes.
  - **Review Focus 5:**
    - `bytes=999999999-` returns 416;
    - `bytes=abc` returns 200 with the full body;
    - `bytes=10-5` returns 416.
  - The token expires: after setting `expires_at` to the past, the download
    returns 404.
  - Denials all return the same 403 body, and the correct reason code is in
    `asset_access_logs`:
    - no entitlement gives `NO_ENTITLEMENT`;
    - a refunded purchase (sandbox `{kind:'refund'}`) gives `NO_ENTITLEMENT`;
    - a suspended account gives `ACCOUNT_SUSPENDED` (403
      `ACCOUNT_SUSPENDED` from `requireAuth` first; assert that the API
      response is 403);
    - another user's device gives `DEVICE_UNKNOWN`;
    - a revoked device gives `DEVICE_REVOKED`;
    - a withdrawn book gives `BOOK_WITHDRAWN`.
  - Superseded: after activating v2, a request for v1 by the owner returns
    409 `ASSET_SUPERSEDED` with `details.currentAssetId` equal to v2; the
    same request by a non-owner returns 403.
  - An unpublished book stays downloadable by its owner.
  - Library items carry `asset` equal to the current ready asset, and `null`
    after withdrawal.
  - The rate limit: the 11th download authorization for the same
    device and asset within an hour returns 429 `RATE_LIMITED`.
  - Log redaction: capture the logger output during the suite; neither the
    download token nor the `downloadUrl` path segment appears.

- [ ] **Step 2: Run** `npx tsx --test --test-concurrency=1 test/integration/asset-delivery.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Stream ranges through `objectStorage().getRange`.

- [ ] **Step 4: Run** the tests, the full integration suite, lint and typecheck. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(drm): authorization policy, download grants, ciphertext proxy, takedown`.

---

### Task 8: Device licences, licence status check-in, device-access revocation

**Files:**
- Create: `backend/src/drm/licence.service.ts`.
- Modify:
  - `backend/src/routes/assets.ts`: `POST /:assetId/decryption-authorizations`;
  - `backend/src/routes/library.ts`: `DELETE /:bookId/device-access` with
    `{ deviceId }`;
  - `backend/src/app.ts`: mount `POST /api/v1/licences/status` and
    `GET /api/v1/drm/licence-signing-key`.
- Test: `backend/test/integration/licences.test.ts`

**Interfaces:**
- **Consumes:**
  - `authorizeAssetAccess` (Task 7);
  - `keyManagement`, `wrapDekForDevice`, `signLicence`, `canonicalJson` and
    `licenceSigningPublicKeyPem` (Task 1);
  - `touchDevice` (Task 6).
- **Produces:**
  - `issueLicence(userId, assetId, deviceId): Promise<Licence>`. It
    - marks the previous licences for the same user, device and book as
      superseded;
    - sets `devices.licence_issued = true`;
    - inserts a `licences` row;
    - unwraps the DEK and wraps it for the device (zeroing buffers);
    - signs the licence.
  - `type Licence = { v: 1; licenceId; assetId; assetVersion; bookId; deviceId; issuedAt; expiresAt; content: { algorithm: 'AES-256-GCM'; nonce; authTag; aad: { assetId; version; algorithm; kmsKeyId } }; wrappedKey: {...}; signature }`.
    Binary fields are base64url and times are ISO UTC.
  - `licenceStatuses(userId, deviceId, licenceIds: string[]): Promise<Array<{ licenceId; status: 'valid'|'expired'|'revoked'|'superseded'|'replaced'|'unknown'; currentAsset?: { assetId; version; sizeBytes; sha256 } }>>`
    applies the precedence: unknown, then revoked, then replaced, then
    superseded, then expired, then valid. "Revoked" covers no entitlement, a
    suspended account, a revoked device, a withdrawn book, and a licence
    whose user, device and book access was removed through device-access.
  - **Routes:**
    - `POST /api/v1/assets/:assetId/decryption-authorizations` with
      `{ deviceId }` returns 200 `{ licence }`. The rate limit is 10 per hour
      per user, device and asset, plus the `drm-grants-user` backstop.
    - `POST /api/v1/licences/status` with
      `{ deviceId: uuid, licenceIds: uuid[] (1..500) }` returns 200
      `{ licences }`. The rate limit is 60 per hour per device.
    - `DELETE /api/v1/library/:bookId/device-access` with `{ deviceId }`
      returns 204. It marks that device's licences for the book superseded
      and records a revocation marker in `licences.superseded_at`, so their
      status is `revoked`. It does not count as a device removal.
    - `GET /api/v1/drm/licence-signing-key` returns
      `{ algorithm: 'Ed25519', publicKeyPem }`, publicly.

- [ ] **Step 1: Write failing tests:**
  - `'end to end: upload, buy, register, download, licence, decrypt'`
    (spec §13.1 #6):
    - staff upload a fixture EPUB, `processNextJob()` runs, and staff
      publish;
    - the reader buys, registers a device with a generated P-256 key,
      authorizes the download and downloads the ciphertext;
    - the reader requests a licence;
    - `verifyLicence(licence, signing key from the endpoint)` is true;
    - `unwrapDekForDevice` with the device private key gives the DEK;
    - `decryptAsset` with the licence's content parameters and the rebuilt
      AAD equals the original EPUB bytes byte-for-byte;
    - `expiresAt - issuedAt` is 30 days.
  - `'licence is useless on another device'`: unwrapping with a second
    device's private key throws.
  - `'renewal supersedes the old licence'`: the status of the old licence is
    `superseded` and the new one is `valid`.
  - `'refund revokes at next check-in'`: refunding through the sandbox makes
    the status `revoked`, and a new decryption authorization gets 403.
  - `'new version shows as replaced'`: activating v2 makes the v1 licence
    status `replaced` with `currentAsset` v2.
  - `'device-access removal'`: after DELETE, the status is `revoked`, the
    device is still active, and no removal is counted.
  - `'status only for own device'`: another user's licence ids give
    `unknown`, and another user's `deviceId` gives 403
    `ASSET_ACCESS_DENIED`.
  - `'licence never logged'`: captured logs contain neither the `wrappedKey`
    ciphertext nor the signature.
  - `'expired'`: with `expires_at` in the past, the status is `expired`.

- [ ] **Step 2: Run** `npx tsx --test --test-concurrency=1 test/integration/licences.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** the tests, the full integration suite, lint and typecheck. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(drm): device-bound 30-day licences and status check-in`.

---

### Task 9: Portal upload panel, README and full verification

**Files:**
- Create:
  - `portal/src/api/assets.ts`
  - `portal/src/components/AssetPanel.tsx`
- Modify:
  - `portal/src/pages/BookFormPage.tsx`: render `AssetPanel` on the edit page
    only;
  - `portal/src/api/types.ts`;
  - `portal/src/i18n/en.json` and `sq.json`;
  - `portal/src/api/client.ts`, if needed, to send a raw `File` body with
    `Content-Type: application/epub+zip`;
  - `README.md`: a new "Books and DRM" section;
  - `.env.example`;
  - `docs/superpowers/specs/Libraria_Technical_Architecture_Specification_v2.1.pdf`:
    already present; it is included in the change set.
- Test: `portal/src/components/AssetPanel.test.tsx`

**Interfaces:**
- **Consumes:** the Task 5 routes and asset JSON.
- **Produces (`assets.ts`):**
  - `useBookAssets(bookId)`, which polls every 3 s while any asset state is
    not terminal;
  - `uploadEpub(bookId, file, publisherId?)`;
  - `activateAsset(bookId, assetId, publisherId?)`.

  Admins pass `publisherId` in the query, matching the book-write ruling.
- **UI:** an "Upload EPUB" file input that accepts `.epub`. Each version row
  shows:
  - a state badge, with all 8 states translated;
  - the reason, translated by `reasonCode`, with a generic fallback; never
    the backend's English `reasonDetail`;
  - "Live" for the current version;
  - a "Make this version live" button for ready versions that aren't live,
    behind a confirm dialog that says readers will receive it.

  Upload errors `PAYLOAD_TOO_LARGE`, `ASSET_PROCESSING` and `RATE_LIMITED`
  are translated.

- [ ] **Step 1: Write failing tests** (fetch stubbed):
  - an upload sends a POST with `Content-Type: application/epub+zip` and
    the file bytes;
  - a `rejected` row shows the translated `SCRIPTED_CONTENT` reason in
    Albanian when the language is `sq`;
  - a ready version that isn't live shows the button, and confirming sends
    the activate POST;
  - polling stops when all states are terminal;
  - an admin's upload includes `publisherId`.

- [ ] **Step 2: Run** `cd portal && npx vitest run src/components/AssetPanel.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.** Write the README section, covering:
  - the pipeline and states;
  - the policy numbers;
  - every new endpoint;
  - the worker service, and that the worker must run without outbound
    network access in production;
  - `docker compose --profile scan up` for ClamAV;
  - the §17.10 accepted residual risk, verbatim in substance: "an authorized
    but compromised client can extract the DEK or plaintext";
  - "Local KMS and local storage are development substitutes; production
    refuses them";
  - "DRM is not production-ready until a managed KMS is configured and the
    §17.11 release gate is met".

- [ ] **Step 4: Full verification:**
  - `backend/`: lint, typecheck, `npm test`, `npm run test:integration`,
    build;
  - `portal/`: lint, typecheck, test, build;
  - `mobile/`: typecheck;
  - then `docker compose up -d` followed by `docker compose exec backend npm run seed`.
    The seed should report 3 ingested books. Keep this quick.

  Expected: all exit 0. Report the counts.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): EPUB upload and version activation; docs`.
