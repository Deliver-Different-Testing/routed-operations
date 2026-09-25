// Fetch wrapper - the same shape as the Configurator's api.ts so the
// consumer patterns and error messages stay familiar.

const BASE_URL = '/api';

/**
 * Structured HTTP error thrown by `request` when the server returns a
 * non-2xx response. Kept as a plain subclass of `Error` so existing
 * `catch (e) { toast.show((e as Error).message) }` sites keep working;
 * callers who need the status code / structured body (e.g. BulkImport
 * pass 5 wanting `{ error, hint, partialCount }`) can `instanceof`
 * check + read the extra fields.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  hint?: string;
  /** Endpoint path this error came from (e.g. "/api/jobs"). Populated by
   *  `request()` on throw so operator-facing error strips can say WHICH
   *  endpoint failed instead of just "HTTP 500". Query string is not
   *  included - too noisy for a status bar and DevTools Network already
   *  carries the full URL. */
  endpoint?: string;
  constructor(message: string, status: number, body: unknown, hint?: string, endpoint?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.hint = hint;
    this.endpoint = endpoint;
  }
}

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    credentials: 'same-origin',
    ...options,
    // Headers spread *after* the caller's options so per-call overrides can't
    // strip X-Requested-With (which the CSRF middleware requires).
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // The endpoint path (without query) - useful in operator-facing error
    // strips when the server responds with no body (unhandled 500).
    const path = `${BASE_URL}${url}`.split('?')[0];
    // Prefer a server-provided message; when the server gave us nothing
    // (bare 500) append the endpoint so the operator can report which
    // call failed instead of just "HTTP 500".
    const serverMsg = err?.messages?.[0]?.message ?? err?.error ?? err?.message;
    const message = serverMsg ?? `HTTP ${res.status} at ${path}`;
    throw new ApiError(message, res.status, err, err?.hint, path);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json();
}

export function buildQuery(params: Record<string, string | number | undefined | null | string[]>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      if (value.length > 0) q.set(key, value.join(','));
    } else {
      q.set(key, String(value));
    }
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}
