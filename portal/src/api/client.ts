export const UNAUTHORIZED_EVENT = 'libraria:unauthorized';

export type ApiErrorDetail = { path: string; message: string };

export class ApiError extends Error {
  status: number;
  code: string;
  /** Field-level problems of a `VALIDATION_FAILED` response. */
  details: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ApiInit = RequestInit & { query?: Record<string, string | undefined> };

const base = (): string => import.meta.env.VITE_API_BASE ?? '/api/v1';

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
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; details?: ApiErrorDetail[] };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      if (Array.isArray(body.error?.details)) details = body.error.details;
    } catch {
      // Non-JSON error body; keep the defaults.
    }
    throw new ApiError(res.status, code, message, details);
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
