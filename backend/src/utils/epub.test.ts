import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSampleEpub } from './epub';

describe('EPUB Generator', () => {
  it('generates a valid zip buffer with PK signature', () => {
    const epub = buildSampleEpub({
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Test Book',
      author: 'Author Name',
      chapters: [
        {
          title: 'Chapter 1',
          paragraphs: ['First paragraph of chapter one.', 'Second paragraph.'],
        },
      ],
    });

    assert.ok(epub.length > 500);
    // Standard ZIP signature PK\x03\x04
    assert.equal(epub.readUInt32LE(0), 0x04034b50);

    // First file header must be 'mimetype'
    const fileName = epub.subarray(30, 30 + 8).toString('utf8');
    assert.equal(fileName, 'mimetype');

    // Content of mimetype must be application/epub+zip
    const mimeContent = epub.subarray(38, 38 + 20).toString('ascii');
    assert.equal(mimeContent, 'application/epub+zip');
  });
});
