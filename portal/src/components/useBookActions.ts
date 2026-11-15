import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBookLifecycle, useBookMutations } from '../api/books';
import { ApiError } from '../api/client';
import type { Book } from '../api/types';

/** The error codes the lifecycle actions can return; each has text in `lifecycle.errors`. */
const KNOWN = [
  'ASSET_REQUIRED',
  'BOOK_ARCHIVED',
  'BOOK_PUBLISHED',
  'ASSET_PROCESSING',
  'BOOK_HAS_SALES',
  'FORBIDDEN',
  'NOT_FOUND',
];

/** The translation key (under `lifecycle.errors`) for a failed action. */
export function lifecycleErrorKey(err: unknown): string {
  return err instanceof ApiError && KNOWN.includes(err.code) ? err.code : 'generic';
}

/** What an action resolves to when another one is still running: nothing was sent. */
export const IN_FLIGHT = Symbol('in-flight');

/**
 * Publish, unpublish, archive, restore and delete for one book, shared by the header buttons, the
 * More menus and the Distribution panel. One action runs at a time (a second Enter or click gets
 * `IN_FLIGHT`). A refused action refetches the books first, so a stale status or `canDelete`
 * stops offering what the server just turned down.
 */
export function useBookActions(book: Book) {
  const client = useQueryClient();
  const { setPublished } = useBookMutations(book.id);
  const { archive, restore, remove } = useBookLifecycle(book.id);
  // A synchronous lock: state would lag behind a fast second keypress.
  const running = useRef(false);

  const guard =
    <T>(run: () => Promise<T>) =>
    async (): Promise<T | typeof IN_FLIGHT> => {
      if (running.current) return IN_FLIGHT;
      running.current = true;
      try {
        return await run();
      } catch (err) {
        void client.invalidateQueries({ queryKey: ['books'] });
        throw err;
      } finally {
        running.current = false;
      }
    };

  return {
    publish: guard(() => setPublished.mutateAsync(true)),
    unpublish: guard(() => setPublished.mutateAsync(false)),
    archive: guard(() => archive.mutateAsync()),
    restore: guard(() => restore.mutateAsync()),
    remove: guard(() => remove.mutateAsync()),
    pending: setPublished.isPending || archive.isPending || restore.isPending || remove.isPending,
  };
}
