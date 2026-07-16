// Fetch wrapper - the same shape as the Configurator's api.ts so the
// consumer patterns and error messages stay familiar.

const BASE_URL = '/api';

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
    throw new Error(
      err?.messages?.[0]?.message
        ?? err?.error
        ?? err?.message
        ?? `HTTP ${res.status}`
    );
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
