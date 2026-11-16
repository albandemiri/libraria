import type { LoaderFunctionArgs } from 'react-router';
import type { Suggestions } from '../lib/types';
import { apiFetch } from '../server/api.server';

const MIN = 2;
const MAX = 100;

const empty = (): Suggestions => ({ titles: [], authors: [], publishers: [] });
const json = (body: Suggestions) =>
  Response.json(body, { headers: { 'Cache-Control': 'private, no-store' } });

/** GET /kerko/sugjerime?q=: the header search suggestions. Never fails, so search cannot break the header. */
export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, MAX).trim();
  if (q.length < MIN) return json(empty());
  try {
    const { data } = await apiFetch<Suggestions>(
      request,
      `/search/suggest?q=${encodeURIComponent(q)}`,
      { auth: 'optional' },
    );
    return json(data);
  } catch (error) {
    console.error('search suggestions failed', error);
    return json(empty());
  }
}
