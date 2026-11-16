import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createZipArchive } from '../../utils/epub';
import {
  buildEpub,
  PNG_1X1,
  setCentralUncompressedSize,
  setGeneralPurposeFlag,
  setLocalUncompressedSize,
  VALID_ISBN,
} from './fixtures';
import { runValidation } from './run-validation';
import { validateEpub } from './validate-epub';

const entry = (path: string, data = 'x') => ({ path, data: Buffer.from(data) });

async function reason(data: Buffer): Promise<string> {
  const result = await validateEpub(data);
  assert.equal(result.ok, false, 'expected a rejection');
  return result.ok ? '' : result.reasonCode;
}

describe('validateEpub: valid books', () => {
  it('counts text characters across spine documents', async () => {
    const result = await validateEpub(
      buildEpub({
        chapterBody: '<p>Një dy <em>tre</em></p><style>p { color: red }</style>\n  <p>&amp;</p>',
      }),
    );
    assert.ok(result.ok);
    assert.equal(result.metadata.textCharacters, 9); // "Njëdytre" + "&"
  });

  it('valid EPUB 3 with cover', async () => {
    const result = await validateEpub(buildEpub({ cover: true, isbn: VALID_ISBN }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.metadata.title, 'Test Book');
    assert.equal(result.metadata.language, 'en');
    assert.deepEqual(result.metadata.creators, ['Ada Author']);
    assert.equal(result.metadata.isbn, '9780306406157');
    assert.equal(result.metadata.hasCover, true);
    assert.equal(result.metadata.epubVersion, '3.0');
    assert.equal(result.metadata.description, 'A short test book.');
    assert.equal(result.cover?.mediaType, 'image/png');
    assert.deepEqual(result.cover?.data, PNG_1X1);
    assert.deepEqual(result.metadata.tocSummary, [
      { label: 'Chapter One', depth: 0 },
      { label: 'Section A', depth: 1 },
      { label: 'Chapter Two', depth: 0 },
    ]);
  });

  it('valid EPUB 2 with NCX', async () => {
    const result = await validateEpub(buildEpub({ version: '2', cover: true }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.metadata.epubVersion, '2.0');
    assert.equal(result.metadata.hasCover, true);
    assert.equal(result.cover?.mediaType, 'image/png');
    assert.deepEqual(result.metadata.tocSummary, [
      { label: 'Chapter One', depth: 0 },
      { label: 'Section A', depth: 1 },
    ]);
    assert.equal(result.metadata.isbn, null);
  });

  it('decodes predefined entities in metadata and ignores an invalid ISBN checksum', async () => {
    const result = await validateEpub(
      buildEpub({ title: 'Tom &amp; Jerry', isbn: '978-0-306-40615-8' }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.metadata.title, 'Tom & Jerry');
    assert.equal(result.metadata.isbn, null);
    assert.equal(result.metadata.hasCover, false);
    assert.equal(result.cover, null);
  });

  it('accepts font obfuscation in encryption.xml', async () => {
    const xml = `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/f.otf"/></enc:CipherData></enc:EncryptedData></encryption>`;
    const result = await validateEpub(
      buildEpub({
        encryptionXml: xml,
        manifestExtras: '<item id="f" href="f.otf" media-type="font/otf"/>',
      }),
    );
    assert.equal(result.ok, true);
  });
});

describe('validateEpub: NOT_AN_EPUB', () => {
  it('a PNG file', async () => assert.equal(await reason(PNG_1X1), 'NOT_AN_EPUB'));
  it('a ZIP without mimetype', async () =>
    assert.equal(await reason(createZipArchive([entry('a.txt')])), 'NOT_AN_EPUB'));
  it('mimetype not first', async () =>
    assert.equal(await reason(buildEpub({ mimetypeFirst: false })), 'NOT_AN_EPUB'));
  it('mimetype application/zip', async () =>
    assert.equal(await reason(buildEpub({ mimetype: 'application/zip' })), 'NOT_AN_EPUB'));
  it('a truncated archive', async () => {
    const zip = buildEpub();
    assert.equal(await reason(zip.subarray(0, zip.length - 40)), 'NOT_AN_EPUB');
  });
});

describe('validateEpub: archive limits and paths', () => {
  for (const bad of ['../evil.xhtml', '/abs.xhtml', 'a\\b.xhtml', 'C:/x.xhtml']) {
    it(`UNSAFE_PATH for ${bad}`, async () =>
      assert.equal(await reason(buildEpub({ extraEntries: [entry(bad)] })), 'UNSAFE_PATH'));
  }

  it('UNSAFE_PATH for a nested traversal segment', async () =>
    assert.equal(
      await reason(buildEpub({ extraEntries: [entry('OEBPS/../../x.xhtml')] })),
      'UNSAFE_PATH',
    ));

  it('DUPLICATE_ENTRY for case-insensitive collisions', async () =>
    assert.equal(
      await reason(buildEpub({ extraEntries: [entry('OEBPS/a.xhtml'), entry('oebps/A.xhtml')] })),
      'DUPLICATE_ENTRY',
    ));

  it('TOO_MANY_ENTRIES for 10,001 empty entries', async () => {
    const extra = Array.from({ length: 10_001 }, (_, i) => entry(`e/${i}`, ''));
    assert.equal(await reason(createZipArchive(extra)), 'TOO_MANY_ENTRIES');
  });

  it('COMPRESSION_RATIO for a 50 MB run of zeros deflated', async () => {
    const bomb = { path: 'OEBPS/zeros.bin', data: Buffer.alloc(50 * 1024 * 1024), compress: true };
    assert.equal(await reason(buildEpub({ extraEntries: [bomb] })), 'COMPRESSION_RATIO');
  });

  it('does not apply the ratio limit to entries of 1 MB or less', async () => {
    const small = { path: 'OEBPS/zeros.bin', data: Buffer.alloc(1024 * 1024), compress: true };
    const result = await validateEpub(buildEpub({ extraEntries: [small] }));
    assert.equal(result.ok, true);
  });

  it('ARCHIVE_TOO_LARGE when the declared uncompressed total exceeds 500 MB', async () => {
    const zip = setCentralUncompressedSize(
      buildEpub({ extraEntries: [{ ...entry('OEBPS/big.bin', 'tiny'), compress: true }] }),
      'OEBPS/big.bin',
      600 * 1024 * 1024,
    );
    assert.equal(await reason(zip), 'ARCHIVE_TOO_LARGE');
  });

  it('ENCRYPTED_ARCHIVE when general-purpose bit 0 is set', async () => {
    const zip = setGeneralPurposeFlag(
      buildEpub({ extraEntries: [{ ...entry('OEBPS/s.bin'), compress: true }] }),
      'OEBPS/s.bin',
      0x1,
    );
    assert.equal(await reason(zip), 'ENCRYPTED_ARCHIVE');
  });

  it('ENCRYPTED_ARCHIVE for strong encryption (bit 6)', async () => {
    const zip = setGeneralPurposeFlag(
      buildEpub({ extraEntries: [{ ...entry('OEBPS/s.bin'), compress: true }] }),
      'OEBPS/s.bin',
      0x41,
    );
    assert.equal(await reason(zip), 'ENCRYPTED_ARCHIVE');
  });

  it('rejects a deflated entry whose central size understates the real size', async () => {
    const zip = setCentralUncompressedSize(buildEpub(), 'OEBPS/chapter1.xhtml', 10);
    assert.equal(await reason(zip), 'NOT_AN_EPUB');
  });

  it('rejects a local header that disagrees with the central directory', async () => {
    const zip = setLocalUncompressedSize(buildEpub(), 'OEBPS/content.opf', 7);
    assert.equal(await reason(zip), 'NOT_AN_EPUB');
  });
});

describe('validateEpub: container and package', () => {
  it('INVALID_CONTAINER for a missing container.xml', async () =>
    assert.equal(await reason(buildEpub({ omitContainer: true })), 'INVALID_CONTAINER'));
  it('INVALID_CONTAINER for a rootfile pointing at a missing OPF', async () =>
    assert.equal(await reason(buildEpub({ rootfilePath: 'OEBPS/nope.opf' })), 'INVALID_CONTAINER'));
  it('INVALID_PACKAGE for a missing dc:title', async () =>
    assert.equal(await reason(buildEpub({ title: null })), 'INVALID_PACKAGE'));
  it('accepts a missing dc:language and reports it as null', async () => {
    const result = await validateEpub(buildEpub({ language: null }));
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.metadata.language, null);
  });
  it('treats a blank dc:language as missing', async () => {
    const result = await validateEpub(buildEpub({ language: '   ' }));
    assert.equal(result.ok && result.metadata.language, null);
  });
  it('keeps a present dc:language', async () => {
    const result = await validateEpub(buildEpub({ language: 'sq' }));
    assert.equal(result.ok && result.metadata.language, 'sq');
  });
  it('INVALID_PACKAGE for an empty spine', async () =>
    assert.equal(await reason(buildEpub({ spineMissing: true })), 'INVALID_PACKAGE'));
  it('INVALID_PACKAGE for a spine idref without a manifest item', async () =>
    assert.equal(await reason(buildEpub({ spineIdrefs: ['ghost'] })), 'INVALID_PACKAGE'));
  it('INVALID_PACKAGE for malformed XML', async () =>
    assert.equal(
      await reason(buildEpub({ rawOpf: '<package><metadata></package>' })),
      'INVALID_PACKAGE',
    ));
  it('INVALID_PACKAGE for a DOCTYPE with an entity (XXE), reading no file', async () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE package [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>&xxe;</dc:title><dc:language>en</dc:language></metadata><manifest/><spine/></package>`;
    assert.equal(await reason(buildEpub({ rawOpf: xxe })), 'INVALID_PACKAGE');
  });
  it('INVALID_PACKAGE for a billion-laughs style internal entity', async () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE package [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><package/>`;
    assert.equal(await reason(buildEpub({ rawOpf: bomb })), 'INVALID_PACKAGE');
  });
  it('INVALID_PACKAGE when the OPF exceeds its per-entry byte cap', async () => {
    const padding = '<!-- '.concat('a'.repeat(6 * 1024 * 1024), ' -->');
    const opf = `<?xml version="1.0"?><package version="3.0">${padding}</package>`;
    assert.equal(await reason(buildEpub({ rawOpf: opf })), 'INVALID_PACKAGE');
  });
  it('INVALID_PACKAGE for a pathologically nested OPF', async () => {
    const deep = `<package version="3.0">${'<a>'.repeat(200_000)}</package>`;
    assert.equal(await reason(buildEpub({ rawOpf: deep })), 'INVALID_PACKAGE');
  });
  it('UNSAFE_PATH for a manifest href that escapes the container', async () =>
    assert.equal(
      await reason(
        buildEpub({
          manifestExtras: '<item id="x" href="../../x.css" media-type="text/css"/>',
        }),
      ),
      'UNSAFE_PATH',
    ));
});

describe('validateEpub: encryption.xml', () => {
  it('UNSUPPORTED_ENCRYPTION for a non-font algorithm', async () => {
    const xml = `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></enc:EncryptedData></encryption>`;
    assert.equal(await reason(buildEpub({ encryptionXml: xml })), 'UNSUPPORTED_ENCRYPTION');
  });
});

describe('validateEpub: content policy', () => {
  it('SCRIPTED_CONTENT for properties="scripted"', async () =>
    assert.equal(await reason(buildEpub({ scripted: true })), 'SCRIPTED_CONTENT'));
  it('SCRIPTED_CONTENT for <script in an XHTML spine item', async () =>
    assert.equal(
      await reason(buildEpub({ chapterBody: '<p>x</p><SCRIPT>alert(1)</SCRIPT>' })),
      'SCRIPTED_CONTENT',
    ));
  it('SCRIPTED_CONTENT for a text/javascript manifest item', async () =>
    assert.equal(
      await reason(
        buildEpub({ manifestExtras: '<item id="js" href="a.js" media-type="text/javascript"/>' }),
      ),
      'SCRIPTED_CONTENT',
    ));
  it('REMOTE_RESOURCES for properties="remote-resources"', async () =>
    assert.equal(await reason(buildEpub({ remote: true })), 'REMOTE_RESOURCES'));
  it('REMOTE_RESOURCES for a remote manifest href', async () =>
    assert.equal(
      await reason(
        buildEpub({
          manifestExtras: '<item id="c" href="https://cdn.example/x.css" media-type="text/css"/>',
        }),
      ),
      'REMOTE_RESOURCES',
    ));
  it('REMOTE_RESOURCES for a remote <img> inside content', async () =>
    assert.equal(
      await reason(buildEpub({ chapterBody: '<img src="https://t.example/p.gif"/>' })),
      'REMOTE_RESOURCES',
    ));
  it('allows ordinary external links', async () => {
    const result = await validateEpub(
      buildEpub({ chapterBody: '<a href="https://example.com">link</a>' }),
    );
    assert.equal(result.ok, true);
  });
  it('UNSUPPORTED_MEDIA for application/x-msdownload', async () =>
    assert.equal(
      await reason(
        buildEpub({
          manifestExtras: '<item id="e" href="a.exe" media-type="application/x-msdownload"/>',
        }),
      ),
      'UNSUPPORTED_MEDIA',
    ));
});

describe('runValidation: thread limits', () => {
  const HOOK = 'LIBRARIA_EPUB_TEST_HOOKS';
  beforeEach(() => {
    process.env[HOOK] = '1';
  });
  afterEach(() => {
    delete process.env[HOOK];
  });

  it('returns the validation result from the thread', async () => {
    const result = await runValidation(buildEpub({ cover: true }));
    assert.equal(result.ok, true);
    const rejected = await runValidation(buildEpub({ title: null }));
    assert.deepEqual(rejected.ok ? null : rejected.reasonCode, 'INVALID_PACKAGE');
  });

  it('PROCESSING_TIMEOUT when the thread busy-loops, and terminates it', async () => {
    const started = Date.now();
    const result = await runValidation(Buffer.from('__EPUB_TEST_BUSY_LOOP__'), { timeoutMs: 50 });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.reasonCode, 'PROCESSING_TIMEOUT');
    assert.ok(Date.now() - started < 5_000, 'thread must be killed promptly');
  });

  it('PROCESSING_ERROR when the thread throws', async () => {
    const result = await runValidation(Buffer.from('__EPUB_TEST_THROW__'));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.reasonCode, 'PROCESSING_ERROR');
    assert.ok(!(result.ok ? '' : result.detail).includes('boom-secret'));
  });

  it('PROCESSING_ERROR when the thread runs out of memory', async () => {
    const result = await runValidation(Buffer.from('__EPUB_TEST_OOM__'), {
      maxOldGenerationSizeMb: 16,
      timeoutMs: 20_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.reasonCode, 'PROCESSING_ERROR');
  });

  it('ignores the test hooks unless the explicit env flag is set', async () => {
    delete process.env[HOOK];
    const result = await runValidation(Buffer.from('__EPUB_TEST_THROW__'));
    assert.equal(result.ok ? '' : result.reasonCode, 'NOT_AN_EPUB');
  });
});
