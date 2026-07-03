// FigureCollector — typed-ish API client.
//
// Wraps fetch with: credentials:include (sticky session cookies),
// JSON encode/decode, and an ApiError class carrying status + code so callers
// can branch on `err.code === "invalid_credentials"` etc.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(
  path,
  { method = "GET", body, headers, signal, onResponse } = {},
) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body != null ? { "Content-Type": "application/json" } : {}),
        ...(headers ?? {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    // Caller cancelled (AbortController): propagate the DOMException as-is so
    // callers can branch on `err.name === "AbortError"` rather than mistaking
    // it for a genuine network failure.
    if (e?.name === "AbortError") throw e;
    throw new ApiError(0, "network", e?.message ?? "network");
  }

  // Response headers are in — anything after this is body transfer/parse.
  onResponse?.();

  if (res.status === 204) return null;

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    // Any 401 means the session is gone (expiry, revocation, or a sign-out
    // elsewhere) — drop the SW caches holding PRIVATE per-user bytes so they
    // can't be served after auth ends (shared device / offline). Mirrors
    // useLogout's purge, but fires on ANY 401, not only the logout button.
    if (res.status === 401) purgePrivateCaches();
    const code = data?.error ?? `http_${res.status}`;
    const message = data?.message ?? res.statusText;
    throw new ApiError(res.status, code, message);
  }
  return data;
}

// Best-effort purge of the SW caches that hold private / authenticated bytes.
// Safe when anonymous (no-op) and in non-browser test envs (guarded).
function purgePrivateCaches() {
  if (typeof caches === "undefined") return;
  for (const name of ["fc-photos", "fc-figures", "fc-external"]) {
    caches.delete(name).catch(() => {});
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: (path, opts) => request(path, { ...opts }),
  post: (path, body, opts) => request(path, { method: "POST", body, ...opts }),
  put: (path, body) => request(path, { method: "PUT", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};
