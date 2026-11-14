import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublisherScope } from '../layout/PublisherScope';
import { api } from './client';
import type { AssetState, BookAsset } from './types';

export const ASSET_POLL_MS = 3000;
const TERMINAL: readonly AssetState[] = ['ready', 'rejected', 'failed'];

export const isTerminal = (state: AssetState): boolean => TERMINAL.includes(state);

export function useBookAssets(bookId: string) {
  const { publisherId, isAdmin } = usePublisherScope();
  return useQuery({
    queryKey: ['assets', publisherId, bookId],
    queryFn: () =>
      api<{ assets: BookAsset[] }>(`/publisher/books/${bookId}/assets`, {
        query: { publisherId },
      }).then((r) => r.assets),
    enabled: !isAdmin || publisherId !== undefined,
    refetchInterval: (query) =>
      query.state.data?.some((a) => !isTerminal(a.state)) ? ASSET_POLL_MS : false,
  });
}

/** Sends the file as the raw body; admins carry the picked publisher in the query. */
export function uploadEpub(bookId: string, file: File, publisherId?: string): Promise<BookAsset> {
  return api<{ asset: BookAsset }>(`/publisher/books/${bookId}/assets`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/epub+zip' },
    query: { publisherId },
  }).then((r) => r.asset);
}

export function activateAsset(
  bookId: string,
  assetId: string,
  publisherId?: string,
): Promise<BookAsset> {
  return api<{ asset: BookAsset }>(`/publisher/books/${bookId}/assets/${assetId}/activate`, {
    method: 'POST',
    query: { publisherId },
  }).then((r) => r.asset);
}

export function useAssetMutations(bookId: string) {
  const { publisherId } = usePublisherScope();
  const client = useQueryClient();
  const done = () => client.invalidateQueries({ queryKey: ['assets'] });
  const upload = useMutation({
    mutationFn: (file: File) => uploadEpub(bookId, file, publisherId),
    onSuccess: done,
  });
  const activate = useMutation({
    mutationFn: (assetId: string) => activateAsset(bookId, assetId, publisherId),
    onSuccess: () => {
      void done();
      void client.invalidateQueries({ queryKey: ['books'] });
    },
  });
  return { upload, activate };
}
