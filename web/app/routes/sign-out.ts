import { type ActionFunctionArgs, redirect } from 'react-router';
import { assertSameOrigin } from '../server/security.server';
import { destroySession, getSession } from '../server/session.server';

/** A GET (a typed URL, a prefetch) never signs out: signing out is a same-origin POST only. */
export const loader = () => redirect('/');

export async function action({ request }: ActionFunctionArgs) {
  assertSameOrigin(request);
  const session = await getSession(request);
  return redirect('/', { headers: { 'Set-Cookie': await destroySession(session) } });
}
