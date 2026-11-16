import { redirect } from 'react-router';
import { env } from './env.server';
import { destroySession, getSession } from './session.server';

/** A non-2xx API response, mapped from `{ error: { code, message } }`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Structured context from `error.details`, such as the field errors of a VALIDATION_FAILED. */
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiInit = {
  method?: string;
  body?: unknown;
  /** 'none' sends no credentials and has no 401 handling (login and registration). */
  auth?: 'optional' | 'required' | 'none';
};

export type ApiResult<T> = { data: T; setCookie?: string };

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (body.error) {
      return new ApiError(
        response.status,
        body.error.code ?? 'UNKNOWN',
        body.error.message ?? response.statusText,
        body.error.details,
      );
    }
  } catch {
    // Not JSON (for example a proxy error page): fall through to the generic error.
  }
  return new ApiError(response.status, 'UNKNOWN', response.statusText || 'Request failed');
}

/** The current page as a same-site path; `request.url` is always absolute, so this starts with "/". */
function returnToOf(request: Request): string {
  const { pathname, search } = new URL(request.url);
  return `${pathname}${search}`;
}

function toLogin(request: Request, setCookie: string): never {
  const location = `/hyr?returnTo=${encodeURIComponent(returnToOf(request))}`;
  throw redirect(location, { headers: { 'Set-Cookie': setCookie } });
}

/**
 * Calls the Libraria API on behalf of the current request, forwarding the session token.
 * `auth: 'required'` sends a guest to sign-in; `'optional'` (the default) degrades to a guest.
 */
export async function apiFetch<T>(
  request: Request,
  path: string,
  init: ApiInit = {},
): Promise<ApiResult<T>> {
  const session = await getSession(request);
  const auth = init.auth ?? 'optional';
  const token = auth === 'none' ? undefined : session.get('token');

  if (auth === 'required' && !token) toLogin(request, await destroySession(session));

  const send = (bearer: string | undefined) => {
    const headers = new Headers({ Accept: 'application/json' });
    if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    return fetch(`${env.API_URL}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };

  let response = await send(token);
  let setCookie: string | undefined;

  if (response.status === 401 && token) {
    // The stored token is no longer valid: drop the session either way.
    const destroyed = await destroySession(session);
    if (auth === 'required') toLogin(request, destroyed);
    response = await send(undefined);
    setCookie = destroyed;
  }

  if (!response.ok) throw await toApiError(response);

  const data = (response.status === 204 ? undefined : await response.json()) as T;
  return setCookie ? { data, setCookie } : { data };
}
