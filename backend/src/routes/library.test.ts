import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bookIdParamSchema,
  bookmarkIdParamSchema,
  createBookmarkSchema,
  createHighlightSchema,
  highlightIdParamSchema,
  listQuerySchema,
  updateHighlightSchema,
  updateProgressSchema,
} from './library';

describe('Library Validation Schemas', () => {
  describe('listQuerySchema', () => {
    it('applies standard defaults', () => {
      const parsed = listQuerySchema.parse({});
      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 20);
      assert.equal(parsed.sort, 'recent');
    });

    it('accepts valid custom sorting and pagination', () => {
      const parsed = listQuerySchema.parse({
        sort: 'title',
        page: '3',
        limit: '50',
      });
      assert.equal(parsed.sort, 'title');
      assert.equal(parsed.page, 3);
      assert.equal(parsed.limit, 50);
    });

    it('rejects invalid sort keys and negative pages', () => {
      assert.throws(() => listQuerySchema.parse({ sort: 'unsupported_sort' }));
      assert.throws(() => listQuerySchema.parse({ page: 0 }));
      assert.throws(() => listQuerySchema.parse({ limit: 150 }));
    });
  });

  describe('ID Param Schemas', () => {
    const validUuid1 = '123e4567-e89b-12d3-a456-426614174000';
    const validUuid2 = '123e4567-e89b-12d3-a456-426614174001';

    it('validates UUID for bookId', () => {
      assert.equal(bookIdParamSchema.parse({ bookId: validUuid1 }).bookId, validUuid1);
      assert.throws(() => bookIdParamSchema.parse({ bookId: 'not-a-uuid' }));
    });

    it('validates UUIDs for bookmarkId', () => {
      const parsed = bookmarkIdParamSchema.parse({
        bookId: validUuid1,
        bookmarkId: validUuid2,
      });
      assert.equal(parsed.bookmarkId, validUuid2);
      assert.throws(() =>
        bookmarkIdParamSchema.parse({ bookId: validUuid1, bookmarkId: 'bad-id' }),
      );
    });

    it('validates UUIDs for highlightId', () => {
      const parsed = highlightIdParamSchema.parse({
        bookId: validUuid1,
        highlightId: validUuid2,
      });
      assert.equal(parsed.highlightId, validUuid2);
      assert.throws(() =>
        highlightIdParamSchema.parse({ bookId: validUuid1, highlightId: 'bad-id' }),
      );
    });
  });

  describe('updateProgressSchema', () => {
    it('accepts structured progress JSON and optional lastReadAt', () => {
      const payload = {
        progress: { cfi: 'epubcfi(/6/4[chap01]!/4/2/10)', percent: 34.5 },
        lastReadAt: '2026-11-12T18:00:00.000Z',
      };
      const parsed = updateProgressSchema.parse(payload);
      assert.deepEqual(parsed.progress, payload.progress);
      assert.ok(parsed.lastReadAt instanceof Date);
    });

    it('rejects overly large payloads (>16KB)', () => {
      const hugeString = 'a'.repeat(20000);
      assert.throws(() =>
        updateProgressSchema.parse({
          progress: { large: hugeString },
        }),
      );
    });
  });

  describe('createBookmarkSchema', () => {
    it('accepts valid location and label', () => {
      const parsed = createBookmarkSchema.parse({
        location: 'epubcfi(/6/6[chap02]!/4/2/2)',
        label: 'Important formula',
      });
      assert.equal(parsed.location, 'epubcfi(/6/6[chap02]!/4/2/2)');
      assert.equal(parsed.label, 'Important formula');
    });

    it('rejects empty location', () => {
      assert.throws(() => createBookmarkSchema.parse({ location: '   ' }));
    });
  });

  describe('Highlights Schemas', () => {
    it('accepts valid highlight with default yellow color', () => {
      const parsed = createHighlightSchema.parse({
        startLocation: 'epubcfi(/6/4!/4/2/1)',
        endLocation: 'epubcfi(/6/4!/4/2/10)',
        highlightedText: 'All human knowledge begins with curiosity.',
      });
      assert.equal(parsed.color, 'yellow');
      assert.equal(parsed.highlightedText, 'All human knowledge begins with curiosity.');
    });

    it('accepts allowed highlight colors and custom note', () => {
      const parsed = createHighlightSchema.parse({
        startLocation: 'epubcfi(/6/4!/4/2/1)',
        endLocation: 'epubcfi(/6/4!/4/2/10)',
        highlightedText: 'Quote text',
        note: 'Review in chapter 3',
        color: 'purple',
      });
      assert.equal(parsed.color, 'purple');
      assert.equal(parsed.note, 'Review in chapter 3');
    });

    it('rejects disallowed highlight colors', () => {
      assert.throws(() =>
        createHighlightSchema.parse({
          startLocation: 'loc1',
          endLocation: 'loc2',
          highlightedText: 'sample',
          color: 'crimson',
        }),
      );
    });

    it('allows updating note and color', () => {
      const parsed = updateHighlightSchema.parse({
        note: 'Updated note',
        color: 'blue',
      });
      assert.equal(parsed.note, 'Updated note');
      assert.equal(parsed.color, 'blue');
    });
  });
});
