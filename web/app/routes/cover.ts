import type { LoaderFunctionArgs } from 'react-router';
import { isUuid } from '../explore/params';
import { env } from '../server/env.server';
import { getSession } from '../server/session.server';

const FORWARDED = ['Content-Type', 'Content-Length', 'Cache-Control'] as const;

const noStore = { 'Cache-Control': 'no-store' };
const notFound = () => new Response('Not found', { status: 404, headers: noStore });
const badGateway = () => new Response('Bad gateway', { status: 502, headers: noStore });

/** GET /kopertina/:id: streams the cover from the API, so the browser never needs the API origin or token. */
export async function loader({ request, params }: LoaderFunctionArgs): Promise<Response> {
  const id = params.id;
  // Book ids are UUIDs; anything else would only earn an API 400, so it is a 404 here.
  if (!isUuid(id)) return notFound();

  const source = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const v = source.get('v');
  if (v) query.set('v', v);
  if (source.get('size') === 'thumb') query.set('size', 'thumb');
  const qs = query.toString();

  const token = (await getSession(request)).get('token');
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const upstream = await fetch(
    `${env.API_URL}/api/v1/books/${encodeURIComponent(id)}/cover${qs ? `?${qs}` : ''}`,
    { headers },
  ).catch((error: unknown) => {
    console.error('cover proxy: upstream request failed', error);
    return null;
  });
  if (!upstream) return badGateway();
  // A missing or hidden cover renders the typographic fallback; real upstream failures are not masked.
  if ([401, 403, 404].includes(upstream.status)) return notFound();
  if (!upstream.ok) {
    console.error(`cover proxy: upstream answered ${upstream.status}`);
    return badGateway();
  }

  const out = new Headers();
  for (const name of FORWARDED) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers: out });
}
