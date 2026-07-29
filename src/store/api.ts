// Thin fetch wrapper for the storefront's REST calls to /api/shop/* (see
// server/shop_storefront_catalog_routes.ts, shop_storefront_orders_routes.ts).
// Every response on this surface is RFC 9457 application/problem+json on
// error (server/http/errors.ts serializeProblem: { type, title, status,
// detail, instance, code, ...params }) and a bare JSON value on success (no
// { success, data, error } envelope, unlike the admin dashboard's api.ts).
//
// Session: reads/writes the SAME localStorage key (`woc_session`) the game
// client's Api class (src/net/online.ts) and the homepage account portal use,
// so a player already signed in elsewhere on the site is automatically
// recognized here, and vice versa. This module deliberately does NOT
// duplicate a login/register form: sign-in happens on the homepage account
// portal (or in-game); a storefront page that needs an account shows a
// sign-in prompt linking there when no session is present.

// Byte-identical key to src/net/online.ts's Api.SESSION_KEY (private there),
// so the two never drift: both read/write { token, username } under this key.
const SESSION_KEY = 'woc_session';

export interface StoreSession {
  token: string;
  username: string;
}

export function getSession(): StoreSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { token?: unknown; username?: unknown };
    if (typeof data.token !== 'string' || typeof data.username !== 'string') return null;
    return { token: data.token, username: data.username };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public params?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ProblemBody {
  title?: string;
  detail?: string;
  code?: string;
  [key: string]: unknown;
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: ProblemBody | null = null;
  try {
    body = await res.json();
  } catch {
    return new ApiError(res.status, `request failed (${res.status})`);
  }
  const message = body?.detail ?? body?.title ?? `request failed (${res.status})`;
  return new ApiError(res.status, message, body?.code, body ?? undefined);
}

/** True for an auth-class failure where a stored session should be discarded. */
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}
