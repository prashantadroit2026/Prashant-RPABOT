const DEFAULT_BACKEND_URL = "http://127.0.0.1:8090";
const DEPLOYED_BACKEND_URL = "https://procurement-hub-backend.onrender.com";

let cachedBase: string | undefined;

export function backendBaseUrl(): string {
  if (cachedBase) return cachedBase;
  cachedBase = (
    process.env.BACKEND_URL?.trim() ||
    (process.env.VERCEL ? DEPLOYED_BACKEND_URL : DEFAULT_BACKEND_URL)
  ).replace(/\/+$/, "");
  return cachedBase;
}

export class BackendError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function extractDetail(body: unknown): string | null {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((x: unknown) => {
          const item = x as { loc?: unknown[]; msg?: string } | null;
          if (!item) return "";
          const loc = Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
          return loc ? `${loc}: ${item.msg ?? ""}` : (item.msg ?? "");
        })
        .filter(Boolean)
        .join("; ");
    }
  }
  return null;
}

export async function backendFetch<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 60_000,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${backendBaseUrl()}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e) {
    clearTimeout(timer);
    const reason = e instanceof Error ? e.message : String(e);
    throw new BackendError(
      0,
      `Backend is unreachable at ${backendBaseUrl()} (${reason}). The live backend (Google Sheet) is not running.`,
    );
  }
  clearTimeout(timer);

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const detail = extractDetail(body);
    if (res.status === 404 && detail === "Not Found") {
      throw new BackendError(404, `${path} is not available on the backend.`);
    }
    throw new BackendError(res.status, detail || `Backend error ${res.status}`);
  }
  return body as T;
}

export const backendGet = <T>(path: string): Promise<T> => backendFetch<T>(path);

export const backendPost = <T>(path: string, body: unknown): Promise<T> =>
  backendFetch<T>(path, { method: "POST", body: JSON.stringify(body) });

export const backendPut = <T>(path: string, body: unknown): Promise<T> =>
  backendFetch<T>(path, { method: "PUT", body: JSON.stringify(body) });

export const backendDelete = <T>(path: string): Promise<T> =>
  backendFetch<T>(path, { method: "DELETE" });