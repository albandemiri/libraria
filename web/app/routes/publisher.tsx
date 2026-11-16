import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { ExplorePage } from '../explore/ExplorePage';
import { loadExplore } from '../explore/explore.server';
import { exploreMeta } from '../explore/meta';
import { RouteErrorBoundary } from '../layout/RouteErrorBoundary';

/** `/botues/:publisherId`: one publisher's catalogue; an unknown publisher is a 404. */
export function loader({ request, params }: LoaderFunctionArgs) {
  return loadExplore(request, { publisherId: params.publisherId }, 'publisher');
}

export const meta: MetaFunction<typeof loader> = (args) => exploreMeta(args);

export const ErrorBoundary = RouteErrorBoundary;

export default function Publisher() {
  return <ExplorePage />;
}
