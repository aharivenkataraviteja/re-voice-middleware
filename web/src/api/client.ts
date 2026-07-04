// Access token lives in memory only — never localStorage — per the
// frontend readiness review's security recommendation. It's lost on a full
// page reload, which is why AuthContext does a silent refresh (via the
// httpOnly refresh cookie) on app start.
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, isRetry = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(path, {
    method,
    headers,
    credentials: "include", // send the httpOnly refresh cookie on /auth/refresh
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !isRetry && path !== "/api/v1/auth/refresh") {
    // Access token likely expired — try one silent refresh, then retry the
    // original request exactly once. If that also fails, give up and let
    // the caller (or the 401 handler) redirect to login.
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(method, path, body, true);
    }
    onUnauthorized?.();
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    let payload: { error?: string; code?: string } = {};
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error body, fall through with defaults */
    }
    throw new ApiError(res.status, payload.error ?? res.statusText, payload.code);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  tryRefresh,
};
