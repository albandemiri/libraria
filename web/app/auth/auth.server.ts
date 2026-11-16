import { redirect } from 'react-router';
import { safeReturnTo } from '../lib/return-to';
import type { SessionUser } from '../lib/types';
import { ApiError, apiFetch } from '../server/api.server';
import { env } from '../server/env.server';
import { commitSession, getSession } from '../server/session.server';

export type AuthMode = 'signIn' | 'register';

export type AuthActionData = {
  /** i18n key for an error about the form as a whole. */
  formError?: string;
  /** i18n key per field. */
  fieldErrors?: Partial<Record<'email' | 'password' | 'displayName', string>>;
  /** A publisher or admin tried to sign in here. */
  portal?: boolean;
  portalUrl?: string;
  /** Never includes the password. */
  values: { email: string; displayName?: string };
};

type ApiAuthResponse = {
  user: { id: string; email: string; displayName: string | null; role: string };
  token: string;
};

/** Redirects a signed-in reader away from the auth pages. Returns null for a guest. */
export async function redirectIfSignedIn(request: Request): Promise<null> {
  const session = await getSession(request);
  if (session.get('user')) {
    const returnTo = new URL(request.url).searchParams.get('returnTo');
    throw redirect(safeReturnTo(returnTo));
  }
  return null;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

const FIELD_ERRORS: Record<AuthMode, Record<string, string>> = {
  signIn: {
    email: 'auth.errors.email',
    password: 'auth.errors.passwordRequired',
  },
  register: {
    email: 'auth.errors.email',
    password: 'auth.errors.password',
    displayName: 'auth.errors.displayName',
  },
};

function fieldErrorsFrom(mode: AuthMode, details: unknown): AuthActionData['fieldErrors'] {
  if (!Array.isArray(details)) return undefined;
  const errors: NonNullable<AuthActionData['fieldErrors']> = {};
  for (const detail of details) {
    const path = (detail as { path?: unknown } | null)?.path;
    const key =
      typeof path === 'string' && Object.hasOwn(FIELD_ERRORS[mode], path)
        ? FIELD_ERRORS[mode][path]
        : undefined;
    if (typeof path === 'string' && key) errors[path as keyof typeof errors] = key;
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

function failure(
  mode: AuthMode,
  error: ApiError,
  values: AuthActionData['values'],
): AuthActionData {
  if (error.code === 'INVALID_CREDENTIALS')
    return { formError: 'auth.errors.invalidCredentials', values };
  if (error.code === 'ACCOUNT_SUSPENDED') return { formError: 'auth.errors.suspended', values };
  if (error.code === 'EMAIL_TAKEN')
    return { fieldErrors: { email: 'auth.errors.emailTaken' }, values };
  if (error.code === 'VALIDATION_FAILED') {
    const fieldErrors = fieldErrorsFrom(mode, error.details);
    if (fieldErrors) return { fieldErrors, values };
  }
  return { formError: 'auth.errors.generic', values };
}

/** Shared by sign-in and register: call the API, then store the reader in the session. */
export async function authenticate(
  request: Request,
  mode: AuthMode,
): Promise<Response | AuthActionData> {
  const form = await request.formData();
  const email = field(form, 'email').trim();
  const password = field(form, 'password');
  const displayName = field(form, 'displayName').trim();
  const values: AuthActionData['values'] = mode === 'register' ? { email, displayName } : { email };

  try {
    const { data } = await apiFetch<ApiAuthResponse>(
      request,
      mode === 'signIn' ? '/auth/login' : '/auth/register',
      {
        method: 'POST',
        auth: 'none',
        body:
          mode === 'signIn'
            ? { email, password }
            : { email, password, ...(displayName && { displayName }) },
      },
    );

    if (data.user.role !== 'reader') return { portal: true, portalUrl: env.PORTAL_URL, values };

    const user: SessionUser = {
      id: data.user.id,
      email: data.user.email,
      displayName: data.user.displayName || data.user.email.split('@')[0] || data.user.email,
    };
    const session = await getSession(request);
    session.set('token', data.token);
    session.set('user', user);
    session.unset('checkouts');
    return redirect(safeReturnTo(form.get('returnTo')), {
      headers: { 'Set-Cookie': await commitSession(session) },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return failure(mode, error, values);
    throw error;
  }
}
