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
    const code = data?.error ?? `http_${res.status}`;
    const message = data?.message ?? res.statusText;
    throw new ApiError(res.status, code, message);
  }
  return data;
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
