import type { ReactNode } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../ui';

type Query = { isPending: boolean; isError: boolean; refetch: () => unknown };

/** The loading, error (with retry) and empty states every data section shares. */
export default function QueryView({
  query,
  isEmpty = false,
  emptyBody,
  children,
}: {
  query: Query;
  isEmpty?: boolean;
  emptyBody?: string;
  children: ReactNode;
}) {
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  if (query.isPending) return <LoadingState />;
  if (isEmpty) return <EmptyState body={emptyBody} />;
  return <>{children}</>;
}
