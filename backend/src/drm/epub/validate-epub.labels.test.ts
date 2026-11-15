import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEpub } from './fixtures';
import { validateEpub } from './validate-epub';

// Real-world manifests: font content is judged by bytes, Adobe auxiliary XML is accepted when inert.

const TTF = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(32)]);
const PFB = Buffer.concat([
  Buffer.from([0x80, 0x01, 0x10, 0, 0, 0]),
  Buffer.from('%!PS-AdobeFont-1.0'),
]);
const PFA = Buffer.from('%!PS-AdobeFont-1.0: Foo 1.0\n/FontName /Foo def');

function withItem(mediaType: string, href: string, data: Buffer, extra = {}): Buffer {
  return buildEpub({
    manifestExtras: `<item id="x" href="${href}" media-type="${mediaType}"/>`,
    extraEntries: [{ path: `OEBPS/${href}`, data }],
    ...extra,
  });
}

async function reason(data: Buffer): Promise<string> {
  const result = await validateEpub(data);
  assert.equal(result.ok, false, 'expected a rejection');
  return result.ok ? '' : result.reasonCode;
}

const PAGE_MAP = (body = '<page name="1" href="chapter1.xhtml#p1"/>', prolog = '') =>
  Buffer.from(
    `<?xml version="1.0"?>\n${prolog}<page-map xmlns="http://www.idpf.org/2007/opf">${body}</page-map>`,
  );

describe('real-world media labels', () => {
  it('accepts the Adobe page map', async () =>
    assert.equal(
      (await validateEpub(withItem('application/oebps-page-map+xml', 'pm.xml', PAGE_MAP()))).ok,
      true,
    ));
  it('accepts the Adobe page template', async () =>
    assert.equal(
      (
        await validateEpub(
          withItem(
            'application/vnd.adobe-page-template+xml',
            't.xpgt',
            Buffer.from(
              '<?xml version="1.0"?><xpgt xmlns="http://ns.adobe.com/xpgt/1.0"><t/></xpgt>',
            ),
          ),
        )
      ).ok,
      true,
    ));
  it('accepts a TrueType font with the doubled application/ prefix', async () =>
    assert.equal(
      (await validateEpub(withItem('application/application/x-font-ttf', 'f.ttf', TTF))).ok,
      true,
    ));
  it('accepts Type 1 fonts (PFB and PFA)', async () => {
    assert.equal((await validateEpub(withItem('application/x-font-type1', 'f.pfb', PFB))).ok, true);
    assert.equal((await validateEpub(withItem('application/x-font-type1', 'f.pfa', PFA))).ok, true);
  });
  it('accepts the other font signatures', async () => {
    for (const sig of ['OTTO', 'true', 'ttcf', 'wOFF', 'wOF2']) {
      const data = Buffer.concat([Buffer.from(sig, 'latin1'), Buffer.alloc(16)]);
      assert.equal(
        (await validateEpub(withItem('application/vnd.ms-opentype', 'f.otf', data))).ok,
        true,
        sig,
      );
    }
  });
  it('UNSUPPORTED_MEDIA for a fake font containing HTML', async () =>
    assert.equal(
      await reason(
        withItem('application/x-font-ttf', 'f.ttf', Buffer.from('<html><body>hi</body></html>')),
      ),
      'UNSUPPORTED_MEDIA',
    ));
  it('UNSUPPORTED_MEDIA for SVG masquerading as a font', async () =>
    assert.equal(
      await reason(
        withItem(
          'application/x-font-ttf',
          'f.ttf',
          Buffer.from('﻿  \n<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>'),
        ),
      ),
      'UNSUPPORTED_MEDIA',
    ));
  it('UNSUPPORTED_MEDIA for a plain-text font', async () =>
    assert.equal(
      await reason(
        withItem('font/ttf', 'f.ttf', Buffer.from('just some words, nothing binary\n'.repeat(20))),
      ),
      'UNSUPPORTED_MEDIA',
    ));
  it('accepts an unrecognised binary font (undeclared scrambling)', async () => {
    const noise = Buffer.from(
      Array.from({ length: 2048 }, (_, k) => (k * 197 + 91 + (k >> 3)) % 256),
    );
    noise[0] = 0x5e;
    noise[5] = 0x00;
    assert.equal(
      (await validateEpub(withItem('application/vnd.ms-opentype', 'f.otf', noise))).ok,
      true,
    );
  });
  it('UNSUPPORTED_MEDIA for a fake doubled-prefix font', async () =>
    assert.equal(
      await reason(
        withItem('application/application/x-font-ttf', 'f.ttf', Buffer.from('plain text here')),
      ),
      'UNSUPPORTED_MEDIA',
    ));
  it('accepts an obfuscated font with the doubled label (not byte-checked)', async () => {
    const xml = `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/f.ttf"/></enc:CipherData></enc:EncryptedData></encryption>`;
    const scrambled = Buffer.from('this is xor scrambled, not a font header');
    assert.equal(
      (
        await validateEpub(
          withItem('application/application/x-font-ttf', 'f.ttf', scrambled, {
            encryptionXml: xml,
          }),
        )
      ).ok,
      true,
    );
  });
  it('still rejects unknown non-font types and doubled non-font types', async () => {
    assert.equal(
      await reason(withItem('application/x-unknown', 'u.bin', TTF)),
      'UNSUPPORTED_MEDIA',
    );
    assert.equal(
      await reason(withItem('application/application/x-dtbncx+xml', 'u.ncx', TTF)),
      'UNSUPPORTED_MEDIA',
    );
  });
  it('REMOTE_RESOURCES for a page map with a remote reference', async () =>
    assert.equal(
      await reason(
        withItem(
          'application/oebps-page-map+xml',
          'pm.xml',
          PAGE_MAP('<page name="1" href="http://evil.example/x"/>'),
        ),
      ),
      'REMOTE_RESOURCES',
    ));
  it('INVALID_PACKAGE for a page map with a DOCTYPE entity', async () =>
    assert.equal(
      await reason(
        withItem(
          'application/oebps-page-map+xml',
          'pm.xml',
          PAGE_MAP(
            '<page name="&x;"/>',
            '<!DOCTYPE page-map [<!ENTITY x SYSTEM "file:///etc/passwd">]>\n',
          ),
        ),
      ),
      'INVALID_PACKAGE',
    ));
});
