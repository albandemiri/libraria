import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { ExplorePage } from '../explore/ExplorePage';
import { loadExplore } from '../explore/explore.server';
import { exploreMeta } from '../explore/meta';
import { RouteErrorBoundary } from '../layout/RouteErrorBoundary';

/** `/kerko?q=`: search results; without a query, a prompt to search (no API call). */
export function loader({ request }: LoaderFunctionArgs) {
  return loadExplore(request, {}, 'search');
}

export const meta: MetaFunction<typeof loader> = (args) => exploreMeta(args);

export const ErrorBoundary = RouteErrorBoundary;

export default function Search() {
  return <ExplorePage />;
}
