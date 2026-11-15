export const UNAUTHORIZED_EVENT = 'libraria:unauthorized';

export type ApiErrorDetail = { path: string; message: string };

export class ApiError extends Error {
  status: number;
  code: string;
  /** Field-level problems of a `VALIDATION_FAILED` response. */
  details: ApiErrorDetail[];
  /** The machine-readable reason of an object-shaped `details` (`INVITE_INVALID`), else null. */
  reason: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: ApiErrorDetail[] = [],
    reason: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.reason = reason;
  }
}

type ApiInit = RequestInit & { query?: Record<string, string | undefined> };

const base = (): string => import.meta.env.VITE_API_BASE ?? '/api/v1';

/**
 * Resolves an API-served path (such as a cover URL, `/api/v1/books/{id}/cover?v=n`) against
 * the API origin. With an absolute `VITE_API_BASE` the portal is served from another origin,
 * so the path must point there; otherwise it is same-origin and stays as is.
 */
export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  try {
    return new URL(path, new URL(base()).origin).toString();
  } catch {
    // A relative base such as `/api/v1` is not a URL: same origin.
    return path;
  }
}

function buildUrl(path: string, query: ApiInit['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, value);
  }
  const qs = params.toString();
  return `${base()}${path}${qs ? `?${qs}` : ''}`;
}

async function request(path: string, init: ApiInit): Promise<Response> {
  const { query, headers, ...rest } = init;
  const merged = new Headers(headers);
  merged.set('X-Libraria-Portal', '1');
  if (rest.body !== undefined && !merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: merged,
    credentials: 'include',
  });

  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    let code = 'UNKNOWN';
    let message = res.statusText;
    let details: ApiErrorDetail[] = [];
    let reason: string | null = null;
    try {
      const body = (await res.json()) as {
        error?: {
          code?: string;
          message?: string;
          details?: ApiErrorDetail[] | { reason?: unknown };
        };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      const raw = body.error?.details;
      if (Array.isArray(raw)) details = raw;
      else if (raw && typeof raw.reason === 'string') reason = raw.reason;
    } catch {
      // Non-JSON error body; keep the defaults.
    }
    throw new ApiError(res.status, code, message, details, reason);
  }
  return res;
}

/** Calls the Libraria API with the portal cookie. Branch on `ApiError.code`, never on the message. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const res = await request(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Like `api`, for a file response: resolves to the raw body. Errors are the same `ApiError`s. */
export async function apiBlob(path: string, init: ApiInit = {}): Promise<Blob> {
  return (await request(path, init)).blob();
}
