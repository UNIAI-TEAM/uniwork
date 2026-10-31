import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEndpointRequest } from "./endpoint-request";
import { TransportError, type FetchLike, type TransportErrorCode } from "./transport";

beforeEach(() => configureRuntime({ apiUrl: "https://uniwork.example", appUrl: "https://uniwork.example" }));
afterEach(() => resetRuntimeConfig());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function errorOf(promise: Promise<unknown>): Promise<TransportError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TransportError);
    return error as TransportError;
  }
  throw new Error("expected a TransportError");
}
const codeOf = async (promise: Promise<unknown>): Promise<TransportErrorCode> => (await errorOf(promise)).code;

describe("the auth routes as core's EndpointRequest", () => {
  it("sends a door's body to its route and hands back the parsed answer", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { status: "mfa_required", mfa_token: "m" }));
    const request = createEndpointRequest({ fetch });
    expect(await request("/api/v1/auth/native/password", { method: "POST", body: { email: "a@b.c", password: "pw", nonce: undefined } })).toEqual({
      status: "mfa_required",
      mfa_token: "m",
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uniwork.example/api/v1/auth/native/password");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@b.c", password: "pw" });
  });

  it("reads with GET and no body when no method is named", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { google: true }));
    await createEndpointRequest({ fetch })("/api/v1/auth/providers");
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it.each([
    ["a route the transport does not serve", "/api/v1/me", "POST"],
    ["a route without the API root", "/auth/native/password", "POST"],
    ["a route with a query", "/api/v1/auth/providers?x=1", "GET"],
    ["a method the doors never use", "/api/v1/auth/native/password", "PUT"],
  ] as const)("refuses %s before anything is sent", async (_label, path, method) => {
    const fetch = vi.fn<FetchLike>();
    expect(await codeOf(createEndpointRequest({ fetch })(path, { method }))).toBe("invalid_request");
    expect(fetch).not.toHaveBeenCalled();
  });

  // The error is all a crash report, a log line or a screen ever sees of a failed door: the password, and the address
  // it was typed with, stay in the request that carried them.
  it.each([
    ["a refusal that echoes them", async () => json(401, { error: { code: "invalid_credentials", message: "hunter2-secret typed@example.com" } })],
    ["a gateway's page", async () => new Response("<html>hunter2-secret</html>", { status: 502 })],
    ["no network", async (): Promise<Response> => Promise.reject(new TypeError("Network request failed: hunter2-secret"))],
  ] as const)("keeps what a password door was sent out of its error, through %s", async (_label, answer) => {
    const sent = { email: "typed@example.com", password: "hunter2-secret" };
    const error = await errorOf(createEndpointRequest({ fetch: answer })("/api/v1/auth/native/password", { method: "POST", body: sent }));
    const seen = JSON.stringify({ ...error, message: error.message, stack: error.stack, cause: String(error.cause) });
    expect(seen).not.toContain("hunter2-secret");
    expect(seen).not.toContain("typed@example.com");
  });

  it("rejects with the transport's own error, which core's sign-in errors read by its fields", async () => {
    const request = createEndpointRequest({ fetch: async () => json(429, { error: { code: "second_factor_locked", fields: { retry_after: 60 } } }) });
    expect(await errorOf(request("/api/v1/auth/native/mfa", { method: "POST", body: {} }))).toMatchObject({
      code: "second_factor_locked",
      status: 429,
      fromServer: true,
      retryAfterMs: 60_000,
      fields: { retry_after: 60 },
    });
  });
});
