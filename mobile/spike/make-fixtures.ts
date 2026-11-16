// @ts-nocheck -- Node-only script, run with the backend's tsx; not part of the app.
/**
 * Reader-engine spike: encrypts test EPUBs with the backend's real DRM code and
 * issues a signed licence for one fixed TEST device per book.
 *
 *   cd <main repo>/backend && npx tsx <spike>/mobile/spike/make-fixtures.ts <books dir...>
 *
 * Output (git-excluded): <spike>/mobile/spike-fixtures/
 *   <id>.bin            raw ciphertext (no header), exactly as /asset-downloads serves it
 *   manifest.ts         books, licences, the test device key and the signing public key
 *
 * The device private key is in the fixtures ON PURPOSE: this is a test of the
 * on-device crypto chain, not of key storage. Never reuse this pattern in the app.
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Paths are relative to this checkout: <repo>/mobile/spike/make-fixtures.ts
const REPO = path.resolve(__dirname, '../..');
const BACKEND = pathToFileURL(path.join(REPO, 'backend/src')).href;
const OUT = path.join(REPO, 'mobile/spike-fixtures');

async function main() {
  const { assetAad, encryptAsset, decryptAsset } = await import(`${BACKEND}/drm/encryption.service.ts`);
  const lc = await import(`${BACKEND}/drm/licence-crypto.ts`);
  const { createZipArchive } = await import(`${BACKEND}/utils/epub.ts`);

  const books: Array<{ id: string; title: string; file: string; note: string; sanitize: boolean }> = [];
  const inputs = process.argv.slice(2);
  const pick = (dir: string, name: string) => path.join(dir, name);
  const [sqTest = path.join(REPO, 'Books/sq-test'), sqWiki = path.join(REPO, 'Books/sq-wikisource'), en = path.join(REPO, 'Books')] = inputs;
  books.push(
    { id: 'sq-test-3', title: 'Libër prove (EPUB 3)', file: pick(sqTest, 'liber-prove-sq-epub3.epub'), note: 'Edge cases, EPUB 3', sanitize: true },
    { id: 'sq-test-2', title: 'Libër prove (EPUB 2)', file: pick(sqTest, 'liber-prove-sq-epub2.epub'), note: 'Same content, EPUB 2', sanitize: true },
    { id: 'sq-skenderbeu', title: 'Historia e Skënderbeut', file: pick(sqWiki, 'naim-frasheri-historia-e-skenderbeut.sq-fixed.epub'), note: 'Wikisource, one 84 KB chapter (poetry)', sanitize: true },
    { id: 'sq-bageti', title: 'Bagëti e Bujqësija', file: pick(sqWiki, 'naim-frasheri-bageti-e-bujqesija.sq-fixed.epub'), note: 'Wikisource, proofread pages', sanitize: true },
    { id: 'en-large', title: 'Large English EPUB (2.6 MB)', file: pick(en, 'The Coddling of the American Mind How Good Intentions and Bad Ideas Are Setting Up a Generation for Failure (Greg Lukianoff, Jonathan Haidt) (z-library.sk, 1lib.sk, z-lib.sk).epub'), note: 'Size / speed test (local only)', sanitize: true },
    { id: 'en-nietzsche', title: 'English EPUB (1.9 MB)', file: pick(en, 'The Birth of Tragedy (Friedrich Nietzsche) (z-library.sk, 1lib.sk, z-lib.sk).epub'), note: 'Real-world styling (local only)', sanitize: true },
  );

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // One fixed TEST device (P-256). The app normally generates this on the device.
  const device = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const deviceId = randomUUID();
  const devicePublicSpki = device.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const devicePkcs8 = device.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url');
  const deviceJwk = device.privateKey.export({ format: 'jwk' });

  const entries: string[] = [];
  // Books that are not on this machine are skipped (the English ones are local-only copies).
  const present = books.filter((b) => existsSync(b.file) || (console.log(`skip ${b.id}: ${b.file} not found`), false));
  const fixtures: Array<{ id: string; buf: Buffer; title: string; note: string; sanitize: boolean }> = present.map((b) => ({
    ...b,
    buf: readFileSync(b.file),
  }));
  fixtures.push({
    id: 'hostile',
    title: 'Kontroll sigurie (hostile EPUB)',
    note: 'Scripts, remote loads, navigation out, Unicode Path trick. Opened WITHOUT sanitizing: only the CSP protects.',
    sanitize: false,
    buf: buildHostileEpub(createZipArchive),
  });

  for (const f of fixtures) {
    const assetId = randomUUID();
    const version = 1;
    const kmsKeyId = 'local';
    const dek = randomBytes(32);
    const aad = assetAad({ assetId, version, kmsKeyId });
    const { ciphertext, nonce, authTag } = encryptAsset(f.buf, dek, aad);
    // Self-check with the backend's own decrypt.
    if (!decryptAsset(ciphertext, dek, nonce, authTag, aad).equals(f.buf)) throw new Error('round trip');

    const licenceId = randomUUID();
    const issuedAt = new Date();
    const unsigned = {
      v: 1,
      kid: lc.licenceSigningKeyId(),
      licenceId,
      assetId,
      assetVersion: version,
      bookId: randomUUID(),
      deviceId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 30 * 86_400_000).toISOString(),
      content: {
        algorithm: 'AES-256-GCM',
        nonce: nonce.toString('base64url'),
        authTag: authTag.toString('base64url'),
        aad: { assetId, version, algorithm: 'AES-256-GCM', kmsKeyId },
      },
      wrappedKey: lc.wrapDekForDevice(dek, devicePublicSpki, { licenceId, assetId, deviceId }),
    };
    const licence = { ...unsigned, signature: lc.signLicence(unsigned) };
    if (!lc.verifyLicence(licence, lc.licenceSigningPublicKeyPem())) throw new Error('signature self-check');
    dek.fill(0);

    writeFileSync(path.join(OUT, `${f.id}.bin`), ciphertext);
    entries.push(`  {
    id: ${JSON.stringify(f.id)},
    title: ${JSON.stringify(f.title)},
    note: ${JSON.stringify(f.note)},
    sanitize: ${f.sanitize},
    plainBytes: ${f.buf.length},
    sizeBytes: ${ciphertext.length},
    sha256: ${JSON.stringify(createHash('sha256').update(ciphertext).digest('hex'))},
    ciphertext: require('./${f.id}.bin'),
    licence: ${JSON.stringify(licence)},
  }`);
    console.log(`${f.id.padEnd(14)} ${String(f.buf.length).padStart(9)} bytes -> ${f.id}.bin`);
  }

  writeFileSync(
    path.join(OUT, 'manifest.ts'),
    `// GENERATED by spike/make-fixtures.ts. Test-only keys. Do not commit.
/* eslint-disable */
export const signingKey = ${JSON.stringify({ kid: lc.licenceSigningKeyId(), publicKeyPem: lc.licenceSigningPublicKeyPem() })};
export const testDevice = ${JSON.stringify({ deviceId, publicKeySpki: devicePublicSpki, privateKeyPkcs8: devicePkcs8, privateKeyJwk: deviceJwk })};
export const books = [
${entries.join(',\n')}
];
`,
  );
  console.log(`wrote ${OUT}/manifest.ts`);
}

/**
 * A deliberately hostile EPUB. Our upload validator would reject it; the reader
 * must still be safe if one gets through. Built with a custom ZIP writer so one
 * entry can carry an Info-ZIP Unicode Path extra field (0x7075).
 */
function buildHostileEpub(_createZip: unknown): Buffer {
  const u = (s: string) => Buffer.from(s, 'utf8');
  const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="sq" xml:lang="sq">
<head><meta charset="UTF-8"/><title>${title}</title>
<meta http-equiv="refresh" content="3;url=https://example.com/libraria-probe-refresh"/>
<link rel="stylesheet" href="https://example.com/libraria-probe.css"/>
<script>
  try { window.__pwned_inner = 'inline-script'; } catch (e) {}
  try { parent.__libraria_pwned = 'inline-script'; } catch (e) {}
  try { top.__libraria_pwned = 'inline-script'; } catch (e) {}
  try { document.documentElement.style.background = 'red'; } catch (e) {}
</script>
</head>
<body>${body}</body></html>`;

  const attack = xhtml(
    'Kontroll sigurie',
    `<h1>Kontroll sigurie</h1>
<p id="status">Nëse kjo faqe NUK është e kuqe dhe nuk shihni tekstin „SKRIPTI U EKZEKUTUA“, skriptet u bllokuan.</p>
<p><img src="data:image/png;base64,AAAA" alt="" onerror="parent.__libraria_pwned='onerror'; document.body.insertAdjacentHTML('beforeend','&lt;h1&gt;SKRIPTI U EKZEKUTUA (onerror)&lt;/h1&gt;')"/></p>
<p>Imazh nga interneti (duhet të bllokohet): <img id="remote-img" src="https://www.wikipedia.org/static/favicon/wikipedia.ico" alt="[imazhi i jashtëm]" width="32" height="32"/></p>
<p><a href="https://example.com/libraria-probe-link">Lidhje e jashtme</a>: prekja nuk duhet të hapë asgjë brenda lexuesit.</p>
<p><a href="javascript:parent.__libraria_pwned='js-url'">Lidhje javascript:</a> — prekja nuk duhet të bëjë asgjë.</p>
<iframe src="https://example.com/libraria-probe-iframe" width="200" height="60"></iframe>
<object data="https://example.com/libraria-probe-object" width="10" height="10"></object>
<form action="https://example.com/libraria-probe-form" method="post"><input name="x" value="1"/><button type="submit">Dërgo</button></form>
<script>document.body.insertAdjacentHTML('beforeend','&lt;h1&gt;SKRIPTI U EKZEKUTUA&lt;/h1&gt;');</script>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="parent.__libraria_pwned='svg-onload'"><rect width="10" height="10"/></svg>`,
  );
  const right = xhtml('Emri standard', `<h1>Emri i skedarit</h1><p>SAKTË ✅ — lexuesi përdori emrin standard të skedarit në ZIP.</p>`);
  const wrong = xhtml('Unicode Path', `<h1>Emri i skedarit</h1><p>GABIM ❌ — lexuesi përdori emrin nga fusha Unicode Path (0x7075).</p>`);

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookID">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookID">urn:uuid:0f0e0d0c-0b0a-4908-8706-050403020100</dc:identifier>
    <dc:title>Kontroll sigurie</dc:title><dc:language>sq</dc:language>
    <meta property="dcterms:modified">2026-11-16T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="a" href="sulm.xhtml" media-type="application/xhtml+xml" properties="scripted remote-resources"/>
    <item id="b" href="emri.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="a"/><itemref idref="b"/></spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head>
<body><nav epub:type="toc"><ol><li><a href="sulm.xhtml">Sulmi</a></li><li><a href="emri.xhtml">Emri i skedarit</a></li></ol></nav></body></html>`;

  const files: Array<{ name: string; data: Buffer; unicodePath?: string }> = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii') },
    {
      name: 'META-INF/container.xml',
      data: u(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    },
    { name: 'OEBPS/content.opf', data: u(opf) },
    { name: 'OEBPS/nav.xhtml', data: u(nav) },
    { name: 'OEBPS/sulm.xhtml', data: u(attack) },
    { name: 'OEBPS/emri.xhtml', data: u(right) },
    // Standard name is "maskuar.xhtml"; the Unicode Path field claims "emri.xhtml".
    { name: 'OEBPS/maskuar.xhtml', data: u(wrong), unicodePath: 'OEBPS/emri.xhtml' },
  ];

  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = u(f.name);
    let extra = Buffer.alloc(0);
    if (f.unicodePath) {
      const up = u(f.unicodePath);
      const body = Buffer.alloc(5 + up.length);
      body.writeUInt8(1, 0);
      body.writeUInt32LE(crc32(nameBuf), 1);
      up.copy(body, 5);
      extra = Buffer.alloc(4 + body.length);
      extra.writeUInt16LE(0x7075, 0);
      extra.writeUInt16LE(body.length, 2);
      body.copy(extra, 4);
    }
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(extra.length, 28);
    local.push(lh, nameBuf, extra, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(extra.length, 30);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf, extra);
    offset += 30 + nameBuf.length + extra.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, eocd]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
