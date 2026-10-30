import {
  CSRF_COOKIE,
  CSRF_HEADER,
  type ApiErrorBody,
  type ErrorCode,
  type ValidationIssue,
} from '@taskmanager/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly details: ValidationIssue[] = [],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Only transient failures are worth retrying; 4xx responses will not change on retry. */
  get isRetryable(): boolean {
    return this.code === 'NETWORK_ERROR' || this.status >= 500;
  }
}

const BASE = '/api/v1';
const UNSAFE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/** Endpoints that must never trigger a refresh-and-retry loop. */
const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/csrf'];

function readCookie(name: string): string | undefined {
  const entry = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

let csrfInFlight: Promise<string> | null = null;

async function csrfToken(forceFetch = false): Promise<string> {
  if (!forceFetch) {
    const fromCookie = readCookie(CSRF_COOKIE);
    if (fromCookie) return fromCookie;
  }
  csrfInFlight ??= fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
    .then((r) => r.json() as Promise<{ data: { csrfToken: string } }>)
    .then((j) => j.data.csrfToken)
    .finally(() => {
      csrfInFlight = null;
    });
  return csrfInFlight;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Single-flight: concurrent 401s share one refresh request instead of racing rotations. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { [CSRF_HEADER]: await csrfToken() },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

const expiryListeners = new Set<() => void>();

export function onSessionExpired(listener: () => void): () => void {
  expiryListeners.add(listener);
  return () => expiryListeners.delete(listener);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

interface Attempt {
  refreshed: boolean;
  csrfRetried: boolean;
}

export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
  attempt: Attempt = { refreshed: false, csrfRetried: false },
): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (UNSAFE.has(method)) headers[CSRF_HEADER] = await csrfToken(attempt.csrfRetried);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Unable to reach the server. Check your connection and try again.',
    );
  }

  if (res.status === 401 && !attempt.refreshed && !NO_REFRESH.some((p) => path.startsWith(p))) {
    if (await refreshSession()) return apiRequest<T>(path, opts, { ...attempt, refreshed: true });
    expiryListeners.forEach((l) => l());
  }

  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    if (res.status === 403 && err?.code === 'CSRF_INVALID' && !attempt.csrfRetried) {
      // The CSRF cookie may have expired or been cleared; fetch a fresh one once.
      return apiRequest<T>(path, opts, { ...attempt, csrfRetried: true });
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err?.details ?? [],
      err?.requestId,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T = void>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
