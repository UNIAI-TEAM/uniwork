import type { ZodType } from "zod";
import { SessionResponseSchema, type SessionResponse } from "../types";
import { getAccessToken, setAccessToken } from "./session";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
}

interface RequestOpts<T> {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  schema?: ZodType<T>;
  skipRefresh?: boolean;
}

async function rawFetch(path: string, opts: RequestOpts<unknown>): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(baseUrl() + path, {
    method: opts.method ?? "GET",
    headers,
    credentials: "include",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

export async function request<T = unknown>(path: string, opts: RequestOpts<T> = {}): Promise<T> {
  let res = await rawFetch(path, opts);
  if (res.status === 401 && !opts.skipRefresh && !path.startsWith("/api/v1/auth/")) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await rawFetch(path, opts);
  }
  if (!res.ok) {
    let code = "internal";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      if (body.error) ({ code, message } = body.error);
    } catch {
      /* body không phải JSON */
    }
    throw new ApiError(message, code, res.status);
  }
  const data: unknown = await res.json();
  return opts.schema ? opts.schema.parse(data) : (data as T);
}

async function tryRefresh(): Promise<boolean> {
  try {
    const sess = await request<SessionResponse>("/api/v1/auth/refresh", {
      method: "POST",
      schema: SessionResponseSchema,
      skipRefresh: true,
    });
    setAccessToken(sess.access_token);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}

export async function login(email: string, password: string): Promise<SessionResponse> {
  const sess = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    schema: SessionResponseSchema,
    skipRefresh: true,
  });
  setAccessToken(sess.access_token);
  return sess;
}

export async function registerUser(
  email: string,
  password: string,
  displayName: string,
): Promise<SessionResponse> {
  const sess = await request("/api/v1/auth/register", {
    method: "POST",
    body: { email, password, display_name: displayName },
    schema: SessionResponseSchema,
    skipRefresh: true,
  });
  setAccessToken(sess.access_token);
  return sess;
}

export async function refreshSession(): Promise<SessionResponse | null> {
  try {
    const sess = await request<SessionResponse>("/api/v1/auth/refresh", {
      method: "POST",
      schema: SessionResponseSchema,
      skipRefresh: true,
    });
    setAccessToken(sess.access_token);
    return sess;
  } catch {
    setAccessToken(null);
    return null;
  }
}

export async function logout(): Promise<void> {
  await request("/api/v1/auth/logout", { method: "POST", skipRefresh: true }).catch(() => {});
  setAccessToken(null);
}
