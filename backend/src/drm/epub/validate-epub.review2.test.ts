import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEpub } from './fixtures';
import { validateEpub } from './validate-epub';

// Regression tests for the Task 3 re-review (N1, N2).

async function reason(data: Buffer): Promise<string> {
  const result = await validateEpub(data);
  assert.equal(result.ok, false, 'expected a rejection');
  return result.ok ? '' : result.reasonCode;
}

function xhtml(body: string, prolog = ''): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n${prolog}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:x="urn:x"><head><title>x</title></head><body>${body}</body></html>`,
  );
}

function withExtraDoc(doc: Buffer): Buffer {
  return buildEpub({
    manifestExtras: '<item id="evil" href="evil.xhtml" media-type="application/xhtml+xml"/>',
    extraEntries: [{ path: 'OEBPS/evil.xhtml', data: doc }],
  });
}

describe('N1: prefixed attributes cannot shadow un-prefixed ones', () => {
  it('SCRIPTED_CONTENT for href=javascript: followed by xlink:href', async () =>
    assert.equal(
      await reason(
        withExtraDoc(
          xhtml('<svg:a href="javascript:alert(1)" xlink:href="#x"><svg:text>t</svg:text></svg:a>'),
        ),
      ),
      'SCRIPTED_CONTENT',
    ));
  it('SCRIPTED_CONTENT for href=javascript: followed by x:href', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<a href="javascript:alert(1)" x:href="#">t</a>'))),
      'SCRIPTED_CONTENT',
    ));
  it('REMOTE_RESOURCES for a remote src followed by x:src', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<img src="https://t.example/p.gif" x:src="local.png"/>'))),
      'REMOTE_RESOURCES',
    ));
  it('REMOTE_RESOURCES for a remote href followed by xlink:href on svg:image', async () =>
    assert.equal(
      await reason(
        withExtraDoc(
          xhtml(
            '<svg:svg><svg:image href="https://t.example/p.gif" xlink:href="local.png"/></svg:svg>',
          ),
        ),
      ),
      'REMOTE_RESOURCES',
    ));
  it('still accepts a plain prefixed xlink:href to a local file', async () => {
    const result = await validateEpub(
      withExtraDoc(xhtml('<svg:svg><svg:image xlink:href="local.png"/></svg:svg>')),
    );
    assert.equal(result.ok, true);
  });
});

describe('N2: DTD constructs cannot hide behind comments', () => {
  it('INVALID_PACKAGE for an ATTLIST internal subset behind a leading DOCTYPE-looking comment', async () =>
    assert.equal(
      await reason(
        withExtraDoc(
          xhtml(
            '<img src="x.png"/>',
            '<!-- <!DOCTYPE a> --><!DOCTYPE html [<!ATTLIST img onerror CDATA "alert(1)">]>\n',
          ),
        ),
      ),
      'INVALID_PACKAGE',
    ));
  it('INVALID_PACKAGE for a second DOCTYPE with an internal subset', async () =>
    assert.equal(
      await reason(withExtraDoc(xhtml('<p/>', '<!DOCTYPE a><!DOCTYPE html [ ]>\n'))),
      'INVALID_PACKAGE',
    ));
  for (const decl of ['<!ELEMENT p ANY>', '<!NOTATION n SYSTEM "x">', '<!ATTLIST p a CDATA "1">']) {
    it(`INVALID_PACKAGE for ${decl} anywhere in the document`, async () =>
      assert.equal(await reason(withExtraDoc(xhtml(`<p/><!-- c -->${decl}`))), 'INVALID_PACKAGE'));
  }
});
