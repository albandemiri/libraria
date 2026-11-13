import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createBookSchema,
  listPublisherBooksQuerySchema,
  setAssetSchema,
  updateBookSchema,
} from './publisher';

describe('Publisher Validation Schemas', () => {
  describe('listPublisherBooksQuerySchema', () => {
    it('applies defaults correctly', () => {
      const parsed = listPublisherBooksQuerySchema.parse({});
      assert.equal(parsed.status, 'all');
      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 20);
    });

    it('accepts valid statuses and search', () => {
      const parsed = listPublisherBooksQuerySchema.parse({
        status: 'published',
        search: 'Tolkien',
        page: 2,
        limit: 10,
      });
      assert.equal(parsed.status, 'published');
      assert.equal(parsed.search, 'Tolkien');
    });

    it('rejects invalid status', () => {
      assert.throws(() => listPublisherBooksQuerySchema.parse({ status: 'archived' }));
    });
  });

  describe('createBookSchema', () => {
    const validEbook = {
      title: 'Moby Dick',
      author: 'Herman Melville',
      isbn13: '9780142437247',
      description: 'The narrative of Captain Ahab.',
      genre: 'Classic Fiction',
      language: 'en',
      priceCents: 999,
      currency: 'USD',
      mediaType: 'ebook' as const,
    };

    it('validates a complete ebook creation payload', () => {
      const parsed = createBookSchema.parse(validEbook);
      assert.equal(parsed.title, 'Moby Dick');
      assert.equal(parsed.priceCents, 999);
      assert.equal(parsed.mediaType, 'ebook');
      assert.equal(parsed.durationSeconds, undefined);
    });

    it('validates audiobook with durationSeconds', () => {
      const parsed = createBookSchema.parse({
        ...validEbook,
        mediaType: 'audiobook',
        durationSeconds: 36000,
      });
      assert.equal(parsed.mediaType, 'audiobook');
      assert.equal(parsed.durationSeconds, 36000);
    });

    it('rejects durationSeconds on ebook', () => {
      assert.throws(() =>
        createBookSchema.parse({
          ...validEbook,
          mediaType: 'ebook',
          durationSeconds: 1200,
        }),
      );
    });

    it('rejects negative price', () => {
      assert.throws(() =>
        createBookSchema.parse({
          ...validEbook,
          priceCents: -50,
        }),
      );
    });

    it('rejects invalid ISBN-13 format', () => {
      assert.throws(() =>
        createBookSchema.parse({
          ...validEbook,
          isbn13: '978-0142437247', // Hyphens not allowed by schema
        }),
      );
      assert.throws(() =>
        createBookSchema.parse({
          ...validEbook,
          isbn13: '12345', // Too short
        }),
      );
    });
  });

  describe('updateBookSchema', () => {
    it('accepts partial updates', () => {
      const parsed = updateBookSchema.parse({
        priceCents: 1499,
        description: 'New expanded edition.',
      });
      assert.equal(parsed.priceCents, 1499);
      assert.equal(parsed.description, 'New expanded edition.');
      assert.equal(parsed.title, undefined);
    });
  });

  describe('setAssetSchema', () => {
    it('accepts valid base64 IV and AuthTag', () => {
      const ivBase64 = Buffer.alloc(12).toString('base64');
      const authTagBase64 = Buffer.alloc(16).toString('base64');

      const parsed = setAssetSchema.parse({
        encryptedFileUrl: 'https://cdn.libraria.com/assets/book-1.enc',
        encryptionIv: ivBase64,
        encryptionAuthTag: authTagBase64,
        fileSizeBytes: 2048576,
      });

      assert.equal(parsed.encryptedFileUrl, 'https://cdn.libraria.com/assets/book-1.enc');
      assert.equal(parsed.fileSizeBytes, 2048576);
    });

    it('rejects non-base64 encryption keys', () => {
      assert.throws(() =>
        setAssetSchema.parse({
          encryptedFileUrl: 'https://cdn.libraria.com/asset.enc',
          encryptionIv: '!!!not-base64!!!',
          encryptionAuthTag: '!!!not-base64!!!',
          fileSizeBytes: 100,
        }),
      );
    });
  });
});
