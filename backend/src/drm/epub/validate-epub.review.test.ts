import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEpub,
  setCentralUncompressedSize,
  setLocalFileName,
  setLocalUncompressedSize,
} from './fixtures';
import { validateEpub } from './validate-epub';

// Regression tests for the Task 3 security review (I1 to I5).

async function reason(data: Buffer): Promise<string> {
  const result = await validateEpub(data);
  assert.equal(result.ok, false, 'expected a rejection');
  return result.ok ? '' : result.reasonCode;
}

function xhtml(body: string, prolog = ''): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n${prolog}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:svg="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`,
  );
}

function withExtraDoc(doc: Buffer, href = 'evil.xhtml', entryPath = `OEBPS/${href}`): Buffer {
  return buildEpub({
    manifestExtras: `<item id="evil" href="${href}" media-type="application/xhtml+xml"/>`,
    extraEntries: [{ path: entryPath, data: doc }],
  });
}

const cssItem = (data: Buffer, compress = true) =>
  buildEpub({
    manifestExtras: '<item id="css" href="s.css" media-type="text/css"/>',
    extraEntries: [{ path: 'OEBPS/s.css', data, compress }],
  });

describe('I1: content scan evasions', () => {
  it('SCRIPTED_CONTENT for a namespace-prefixed <svg:script>', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<svg:svg><svg:script>alert(1)</svg:script></svg:svg>'))),
      'SCRIPTED_CONTENT',
    ));
  it('SCRIPTED_CONTENT for <h:script>', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<h:script>alert(1)</h:script>'))),
      'SCRIPTED_CONTENT',
    ));
  it('rejects an internal DTD entity that expands to a script', async () =>
    assert.equal(
      await reason(
        withExtraDoc(
          xhtml(
            '<p>&s;</p>',
            '<!DOCTYPE html [<!ENTITY s "&#60;script&#62;alert(1)&#60;/script&#62;">]>\n',
          ),
        ),
      ),
      'INVALID_PACKAGE',
    ));
  it('rejects a literal <script> inside a DOCTYPE entity value', async () =>
    assert.equal(
      await reason(
        withExtraDoc(
          xhtml('<p>&s;</p>', '<!DOCTYPE html [<!ENTITY s "<script>alert(1)</script>">]>\n'),
        ),
      ),
      'INVALID_PACKAGE',
    ));
  it('rejects an internal DTD subset even without entities', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<p/>', '<!DOCTYPE html [<!ELEMENT p ANY>]>\n'))),
      'INVALID_PACKAGE',
    ));
  it('SCRIPTED_CONTENT for onerror after a ">" inside a quoted attribute', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<img alt=">" src="x.png" onerror="alert(1)"/>'))),
      'SCRIPTED_CONTENT',
    ));
  it('REMOTE_RESOURCES for a remote src after a ">" inside a quoted attribute', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<img alt=">" src="https://t.example/p.gif"/>'))),
      'REMOTE_RESOURCES',
    ));
  it('SCRIPTED_CONTENT for a javascript: URL hidden with an entity tab', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<a href="jav&#x09;ascript:alert(1)">x</a>'))),
      'SCRIPTED_CONTENT',
    ));
  it('SCRIPTED_CONTENT for iframe srcdoc', async () =>
    assert.equal(
      await reason(
        withExtraDoc(xhtml('<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>')),
      ),
      'SCRIPTED_CONTENT',
    ));
  it('REMOTE_RESOURCES for a remote @import in a CSS item', async () =>
    assert.equal(
      await reason(cssItem(Buffer.from('@import url(https://t.example/x.css);'))),
      'REMOTE_RESOURCES',
    ));
});

describe('I2: scanned bytes are the rendered bytes', () => {
  it('UNSAFE_PATH for a "." segment alias of a spine document', async () =>
    assert.equal(
      await reason(
        buildEpub({
          extraEntries: [{ path: 'OEBPS/./chapter1.xhtml', data: xhtml('<script>1</script>') }],
        }),
      ),
      'UNSAFE_PATH',
    ));
  it('UNSAFE_PATH for an empty-segment alias', async () =>
    assert.equal(
      await reason(
        buildEpub({
          extraEntries: [{ path: 'OEBPS//chapter1.xhtml', data: xhtml('<script>1</script>') }],
        }),
      ),
      'UNSAFE_PATH',
    ));
  it('INVALID_PACKAGE when a manifest XHTML item exists only under another case', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<script>1</script>'), 'Evil.xhtml', 'OEBPS/evil.xhtml')),
      'INVALID_PACKAGE',
    ));

  const enc = (algorithm: string, uri: string | null) =>
    `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/>${
      uri === null ? '' : `<enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData>`
    }</enc:EncryptedData></encryption>`;
  const IDPF = 'http://www.idpf.org/2008/embedding';

  it('UNSUPPORTED_ENCRYPTION when obfuscation targets a non-font item', async () =>
    assert.equal(
      await reason(
        buildEpub({
          encryptionXml: enc(IDPF, 'OEBPS/evil.xhtml'),
          manifestExtras: '<item id="evil" href="evil.xhtml" media-type="application/xhtml+xml"/>',
          extraEntries: [{ path: 'OEBPS/evil.xhtml', data: xhtml('<p>x</p>') }],
        }),
      ),
      'UNSUPPORTED_ENCRYPTION',
    ));
  it('UNSUPPORTED_ENCRYPTION when obfuscation targets nothing in the manifest', async () =>
    assert.equal(
      await reason(buildEpub({ encryptionXml: enc(IDPF, 'OEBPS/ghost.otf') })),
      'UNSUPPORTED_ENCRYPTION',
    ));
  it('UNSUPPORTED_ENCRYPTION when there is no CipherReference', async () =>
    assert.equal(
      await reason(buildEpub({ encryptionXml: enc(IDPF, null) })),
      'UNSUPPORTED_ENCRYPTION',
    ));
  it('UNSUPPORTED_ENCRYPTION when the encryption.xml root is unexpected', async () =>
    assert.equal(
      await reason(
        buildEpub({
          encryptionXml:
            '<?xml version="1.0"?><wrapper><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></wrapper>',
        }),
      ),
      'UNSUPPORTED_ENCRYPTION',
    ));
});

describe('I3: linear-time scanning', () => {
  const FIVE_MB = 5 * 1024 * 1024;
  async function timed(data: Buffer) {
    const started = Date.now();
    const result = await validateEpub(data);
    const elapsed = Date.now() - started;
    assert.equal(result.ok, true);
    assert.ok(elapsed < 1000, `took ${elapsed} ms`);
  }
  it('a 5 MB "url(" + spaces stylesheet', async () =>
    timed(cssItem(Buffer.from(`p{background:url(${' '.repeat(FIVE_MB)}`), false)));
  it('a 5 MB "@import" + spaces stylesheet', async () =>
    timed(cssItem(Buffer.from(`@import${' '.repeat(FIVE_MB)}`), false)));
  it('a 5 MB <style> block of "url(" + spaces', async () =>
    timed(withExtraDoc(xhtml(`<style>url(${' '.repeat(FIVE_MB)}</style>`))));
});

describe('I4: every entry is inflated against its declared size', () => {
  it('COMPRESSION_RATIO for an unread 30 MB entry declared as 100 KB in both headers', async () => {
    let zip = buildEpub({
      extraEntries: [
        { path: 'OEBPS/img.bin', data: Buffer.alloc(30 * 1024 * 1024), compress: true },
      ],
    });
    zip = setCentralUncompressedSize(zip, 'OEBPS/img.bin', 100_000);
    zip = setLocalUncompressedSize(zip, 'OEBPS/img.bin', 100_000);
    assert.equal(await reason(zip), 'COMPRESSION_RATIO');
  });
  it('NOT_AN_EPUB when a local header names a different file than the central directory', async () => {
    const zip = setLocalFileName(
      buildEpub({ extraEntries: [{ path: 'OEBPS/aaaa.bin', data: Buffer.from('x') }] }),
      'OEBPS/aaaa.bin',
      'OEBPS/bbbb.bin',
    );
    assert.equal(await reason(zip), 'NOT_AN_EPUB');
  });
});

describe('I5: relative references that stay inside the container', () => {
  it('accepts ../Images/... references and manifest hrefs that normalise inside the root', async () => {
    const result = await validateEpub(
      buildEpub({
        manifestExtras: [
          '<item id="c2" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>',
          '<item id="img" href="Images/cover.jpg" media-type="image/jpeg"/>',
          '<item id="css" href="../OEBPS/x.css" media-type="text/css"/>',
        ].join(''),
        spineIdrefs: ['chap1', 'c2'],
        extraEntries: [
          { path: 'OEBPS/Text/ch1.xhtml', data: xhtml('<img src="../Images/cover.jpg"/>') },
          { path: 'OEBPS/Images/cover.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          { path: 'OEBPS/x.css', data: Buffer.from('p{}') },
        ],
      }),
    );
    assert.equal(result.ok, true);
  });
});
