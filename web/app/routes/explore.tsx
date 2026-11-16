import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { ExplorePage } from '../explore/ExplorePage';
import { loadExplore } from '../explore/explore.server';
import { exploreMeta } from '../explore/meta';
import { RouteErrorBoundary } from '../layout/RouteErrorBoundary';

/** `/eksploro` (all books) and `/eksploro/:genre`. */
export function loader({ request, params }: LoaderFunctionArgs) {
  return loadExplore(request, { genre: params.genre }, params.genre ? 'genre' : 'all');
}

export const meta: MetaFunction<typeof loader> = (args) => exploreMeta(args);

export const ErrorBoundary = RouteErrorBoundary;

export default function Explore() {
  return <ExplorePage />;
}
