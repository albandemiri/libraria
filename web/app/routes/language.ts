import { type ActionFunctionArgs, redirect } from 'react-router';
import { isLang } from '../i18n';
import { safeReturnTo } from '../lib/return-to';
import { LANGUAGE_COOKIE } from '../server/i18n.server';
import { assertSameOrigin } from '../server/security.server';

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function action({ request }: ActionFunctionArgs) {
  assertSameOrigin(request);
  const form = await request.formData();
  const lang = form.get('lang');
  const returnTo = safeReturnTo(form.get('returnTo'));
  const headers = new Headers({ Location: returnTo });
  if (isLang(lang)) {
    headers.append(
      'Set-Cookie',
      `${LANGUAGE_COOKIE}=${lang}; Max-Age=${YEAR_SECONDS}; Path=/; SameSite=Lax`,
    );
  }
  return redirect(returnTo, { headers });
}
