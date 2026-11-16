import type { LoaderFunctionArgs } from 'react-router';
import { genresLoader, isOfferedGenre } from '../explore/explore.server';
import { parseExploreParams, toFacetsQuery } from '../explore/params';
import type { Facets } from '../lib/types';
import { apiFetch } from '../server/api.server';
import { getSession } from '../server/session.server';

const json = (total: number | null) =>
  Response.json({ total }, { headers: { 'Cache-Control': 'private, no-store' } });

/**
 * GET /eksploro/numero?…: how many books match the phone filter sheet's current choices.
 * Takes the page's query parameters (scope included as `genre` / `publisherId`). Never fails:
 * `total: null` lets the sheet keep its last count.
 */
export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  const state = parseExploreParams(new URL(request.url));
  const session = await getSession(request);
  if (!session.get('token')) state.hideOwned = false;
  try {
    // The same genre check as the page, so the count agrees with what "Shfaq" will show.
    if (state.genre && !(await isOfferedGenre(state.genre, genresLoader(request)))) {
      state.genre = undefined;
    }
    const { data } = await apiFetch<Facets>(request, `/books/facets?${toFacetsQuery(state)}`, {
      auth: 'optional',
    });
    return json(data.total);
  } catch (error) {
    console.error('explore count failed', error);
    return json(null);
  }
}
