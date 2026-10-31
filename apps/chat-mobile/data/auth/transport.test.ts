import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransportError, createAuthRequest, createTransport, type FetchLike, type TransportErrorCode } from "./transport";

beforeEach(() => configureRuntime({ apiUrl: "https://uniwork.example", appUrl: "https://uniwork.example" }));
afterEach(() => resetRuntimeConfig());

const config = { deploymentId: "default" };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const sessionBody = (overrides: Record<string, unknown> = {}) => ({
  account_id: "acc_1",
  device_session_id: "dev_1",
  session_id: "sess_1",
  deployment_id: "default",
  access_token: "at_1",
  token_type: "Bearer",
  expires_in: 900,
  refresh_token: "rt_1",
  refresh_expires_in: 2592000,
  refresh_rotates: true,
  ...overrides,
});

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

const refreshReq = { deviceSessionId: "dev_1", refreshToken: "rt_1" };

describe("mobile auth transport", () => {
  it("start sends the PKCE query plus device metadata to runtimeConfig().apiUrl and refuses redirects / caching", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, { authorization_url: "https://uniwork.example/auth/desktop/authorize?a=1", attempt_expires_at: "x" }),
    );
    const transport = createTransport(config, { fetch });
    const result = await transport.start({
      clientId: "uniwork-chat-mobile",
      codeChallenge: "c".repeat(43),
      state: "state_1",
      redirectUri: "uniworkchat://auth/callback",
      deviceLabel: "UniChat (iOS)",
      platform: "ios",
    });
    expect(result.authorizationUrl).toBe("https://uniwork.example/auth/desktop/authorize?a=1");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://uniwork.example/api/v1/auth/desktop/start");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      client_id: "uniwork-chat-mobile",
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
      state: "state_1",
      redirect_uri: "uniworkchat://auth/callback",
      deployment_id: "default",
      device_label: "UniChat (iOS)",
      platform: "ios",
    });
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init.body).toBeUndefined();
  });

  it("start names the provider button the person tapped, and only then", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { authorization_url: "https://uniwork.example/auth/desktop/authorize?a=1" }));
    const transport = createTransport(config, { fetch });
    const start = { clientId: "uniwork-chat-mobile", codeChallenge: "c", state: "s", redirectUri: "r" };
    await transport.start({ ...start, provider: "google" });
    await transport.start(start);
    const query = (call: number) => new URL((fetch.mock.calls[call] as [string, RequestInit])[0]).searchParams;
    expect(query(0).get("provider")).toBe("google");
    expect(query(1).has("provider")).toBe(false);
    // The register screen's intent rides with its provider only.
    await transport.start({ ...start, provider: "apple", intent: "sign_up" });
    await transport.start({ ...start, intent: "sign_up" });
    expect(query(2).get("intent")).toBe("sign_up");
    expect(query(3).has("intent")).toBe(false);
  });

  it("follows the app's own origin: a dev phone signs in on the LAN web server over http", async () => {
    configureRuntime({ apiUrl: "http://192.168.1.20:8080", appUrl: "http://192.168.1.20:3000" });
    const transport = createTransport(config, { fetch: async () => json(200, { authorization_url: "http://192.168.1.20:3000/auth/desktop/authorize?a=1" }) });
    const start = { clientId: "uniwork-chat-mobile", codeChallenge: "c", state: "s", redirectUri: "r" };
    expect((await transport.start(start)).authorizationUrl).toBe("http://192.168.1.20:3000/auth/desktop/authorize?a=1");
  });

  it("opens no sign-in page while the app's own origin is unknown", async () => {
    configureRuntime({ appUrl: "" });
    const transport = createTransport(config, { fetch: async () => json(200, { authorization_url: "https://uniwork.example/auth/desktop/authorize?a=1" }) });
    const start = { clientId: "uniwork-chat-mobile", codeChallenge: "c", state: "s", redirectUri: "r" };
    expect(await codeOf(transport.start(start))).toBe("malformed_response");
  });

  it("reads the API origin at call time, so a late configureRuntime() wins", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, {}));
    const transport = createTransport(config, { fetch });
    configureRuntime({ apiUrl: "http://192.168.1.20:8080" });
    await transport.logout({ deviceSessionId: "dev_1" }, "at_1");
    expect(fetch.mock.calls[0]?.[0]).toBe("http://192.168.1.20:8080/api/v1/auth/desktop/logout");
  });

  it.each([
    ["a non-http authorization URL", { authorization_url: "javascript:alert(1)" }],
    ["credentials in the URL", { authorization_url: "https://user:pw@uniwork.example/x" }],
    ["an unparsable URL", { authorization_url: "not a url" }],
    // Audit (Security & privacy, https-not-asserted): the sign-in page opens only on the app's own origin, scheme and
    // all, so a tampered or misrouted answer cannot send the person to type their password somewhere else.
    ["another host", { authorization_url: "https://evil.example/auth/desktop/authorize?a=1" }],
    ["cleartext on the app's host", { authorization_url: "http://uniwork.example/auth/desktop/authorize?a=1" }],
    ["another port", { authorization_url: "https://uniwork.example:8443/auth/desktop/authorize?a=1" }],
    ["a missing URL", {}],
    ["a non-object body", []],
  ])("start rejects %s as malformed", async (_label, body) => {
    const transport = createTransport(config, { fetch: async () => json(200, body) });
    const start = { clientId: "uniwork-chat-mobile", codeChallenge: "c", state: "s", redirectUri: "r" };
    expect(await codeOf(transport.start(start))).toBe("malformed_response");
  });

  it("exchange posts snake_case and parses the session strictly", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, sessionBody()));
    const transport = createTransport(config, { fetch });
    const session = await transport.exchange({
      clientId: "uniwork-chat-mobile",
      code: "code_1",
      codeVerifier: "v".repeat(64),
      redirectUri: "uniworkchat://auth/callback",
    });
    expect(session).toEqual({
      accountId: "acc_1",
      deviceSessionId: "dev_1",
      sessionId: "sess_1",
      deploymentId: "default",
      accessToken: "at_1",
      refreshToken: "rt_1",
      expiresIn: 900,
      refreshExpiresIn: 2592000,
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uniwork.example/api/v1/auth/desktop/exchange");
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: "uniwork-chat-mobile",
      code: "code_1",
      code_verifier: "v".repeat(64),
      redirect_uri: "uniworkchat://auth/callback",
      deployment_id: "default",
    });
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("refresh posts the token pair with the X-UniWork-Device header", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, sessionBody({ access_token: "at_2" })));
    const transport = createTransport(config, { fetch });
    expect((await transport.refresh(refreshReq)).accessToken).toBe("at_2");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uniwork.example/api/v1/auth/desktop/refresh");
    expect(new Headers(init.headers).get("X-UniWork-Device")).toBe("dev_1");
    expect(JSON.parse(String(init.body))).toEqual({
      device_session_id: "dev_1",
      refresh_token: "rt_1",
      deployment_id: "default",
    });
  });

  it.each([
    [{ deployment_id: "other" }, "wrong_deployment"],
    [{ access_token: undefined }, "malformed_response"],
    [{ expires_in: "900" }, "malformed_response"],
    [{ refresh_expires_in: 0 }, "malformed_response"],
    [{ token_type: "MAC" }, "malformed_response"],
  ])("refresh rejects session %j as %s", async (override, code) => {
    const transport = createTransport(config, { fetch: async () => json(200, sessionBody(override)) });
    expect(await codeOf(transport.refresh(refreshReq))).toBe(code);
  });

  it("refresh rejects a session body that is not an object", async () => {
    const transport = createTransport(config, { fetch: async () => json(200, [sessionBody()]) });
    expect(await codeOf(transport.refresh(refreshReq))).toBe("malformed_response");
  });

  it.each([
    [401, { error: { code: "auth_code_invalid" } }, "auth_code_invalid"],
    [401, { error: { code: "device_revoked" } }, "device_revoked"],
    [401, { error: { code: "refresh_reused" } }, "refresh_reused"],
    [401, { error: { code: "unauthorized" } }, "unauthorized"],
    [401, null, "unauthorized"],
    [429, { error: { code: "rate_limited" } }, "rate_limited"],
    [429, null, "rate_limited"],
    [503, { error: { code: "desktop_auth_unavailable" } }, "desktop_auth_unavailable"],
    [502, null, "server_error"],
    [400, { error: { code: "invalid_request" } }, "invalid_request"],
    [400, { error: { code: "something_new" } }, "invalid_request"],
    [403, null, "forbidden"],
  ])("maps HTTP %i %j to %s", async (status, body, code) => {
    const transport = createTransport(config, {
      fetch: async () => (body ? json(status, body) : new Response("", { status })),
    });
    const error = await errorOf(transport.refresh(refreshReq));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message).not.toContain("rt_1");
  });

  it("reads Retry-After seconds on 429 and leaves it unset otherwise", async () => {
    const limited = createTransport(config, {
      fetch: async () => json(429, { error: { code: "rate_limited" } }, { "Retry-After": "7" }),
    });
    expect(await errorOf(limited.refresh(refreshReq))).toMatchObject({
      code: "rate_limited",
      fromServer: true,
      retryAfterMs: 7_000,
    });
    const dated = createTransport(config, {
      fetch: async () => new Response("", { status: 429, headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" } }),
    });
    expect((await errorOf(dated.refresh(refreshReq))).retryAfterMs).toBeUndefined();
    const bare = createTransport(config, { fetch: async () => new Response("", { status: 429 }) });
    expect((await errorOf(bare.refresh(refreshReq))).retryAfterMs).toBeUndefined();
  });

  it("maps network failure, timeout and bad JSON", async () => {
    const offline = createTransport(config, {
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await codeOf(offline.refresh(refreshReq))).toBe("network");

    const hanging = createTransport(config, {
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    expect(await codeOf(hanging.refresh(refreshReq))).toBe("timeout");

    const garbled = createTransport(config, { fetch: async () => new Response("<html>", { status: 200 }) });
    expect(await codeOf(garbled.refresh(refreshReq))).toBe("malformed_response");
  });

  it("times out a response whose body stalls after the headers", async () => {
    const stall = (status: number) =>
      createTransport(config, {
        timeoutMs: 10,
        fetch: async (_url, init) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"account_id":'));
              init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
            },
          });
          return new Response(body, { status });
        },
      });
    expect(await codeOf(stall(200).refresh(refreshReq))).toBe("timeout");
    expect(await codeOf(stall(500).refresh(refreshReq))).toBe("timeout");
  });

  it("tells a server verdict from a bare HTTP 401", async () => {
    const enveloped = createTransport(config, {
      fetch: async () => json(401, { error: { code: "unauthorized", message: "x" } }),
    });
    const bare = createTransport(config, { fetch: async () => new Response("<html>blocked</html>", { status: 401 }) });
    expect(await errorOf(enveloped.refresh(refreshReq))).toMatchObject({ code: "unauthorized", fromServer: true });
    expect(await errorOf(bare.refresh(refreshReq))).toMatchObject({ code: "unauthorized", fromServer: false });
  });

  it("logout posts the device scope with the bearer token", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, {}));
    const transport = createTransport(config, { fetch });
    await transport.logout({ deviceSessionId: "dev_1" }, "at_1");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uniwork.example/api/v1/auth/desktop/logout");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer at_1");
    expect(JSON.parse(String(init.body))).toEqual({ device_session_id: "dev_1", deployment_id: "default", scope: "device" });
  });
});

// The app's sign-in doors (ADR 0049 §8) answer refusals the screen reads by code and a few fields
// (core's auth/sign-in-errors.ts): a masked holder, the proofs, the seconds to wait.
describe("refusals of the sign-in doors", () => {
  const door = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    createAuthRequest({ fetch: async () => json(status, body, headers) })("POST", "/auth/native/password", { body: {} });

  it.each([
    [401, "invalid_credentials"],
    [429, "second_factor_locked"],
    [401, "provider_token_invalid"],
    [503, "native_sign_in_unavailable"],
    [503, "google_not_configured"],
    [503, "apple_auth_unavailable"],
    [409, "conflict"],
    [400, "invalid_code"],
    [404, "sign_in_ticket_missing"],
    [400, "sign_in_ticket_channel"],
    [409, "sign_in_account_conflict"],
    [401, "sign_in_email_unverified"],
    [401, "sign_in_account_unverified"],
    [409, "sign_in_method_taken"],
    [409, "sign_in_method_already_linked"],
    [403, "cross_site_request"],
    [415, "unsupported_media_type"],
  ] as const)("keeps the server's %i %s as its own verdict", async (status, code) => {
    expect(await errorOf(door(status, { error: { code, message: "x" } }))).toMatchObject({ code, status, fromServer: true, fields: {} });
  });

  it("keeps the fields a screen reads, each of its own type, and nothing else of the body", async () => {
    const error = await errorOf(
      door(409, {
        error: {
          code: "sign_in_method_taken",
          message: "taken by a•••@icloud.com",
          fields: { masked_email: "a•••@icloud.com", proofs: ["password", 7, "email_code"], retry_after: 30, token: "secret" },
        },
      }),
    );
    expect(error.fields).toEqual({ masked_email: "a•••@icloud.com", proofs: ["password", "email_code"], retry_after: 30 });
    expect(error.message).not.toContain("icloud");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it.each([
    ["not an object", "x"],
    ["mistyped values", { masked_email: "", proofs: "password", retry_after: -1 }],
    ["a fractional wait", { retry_after: 1.5 }],
  ])("drops fields that are %s", async (_label, fields) => {
    expect((await errorOf(door(400, { error: { code: "invalid_request", fields } }))).fields).toEqual({});
  });

  it("waits the body's retry_after when the header says nothing, and the header's when it does", async () => {
    const locked = { error: { code: "second_factor_locked", fields: { retry_after: 840 } } };
    expect(await errorOf(door(429, locked))).toMatchObject({ code: "second_factor_locked", retryAfterMs: 840_000 });
    expect(await errorOf(door(429, locked, { "Retry-After": "600" }))).toMatchObject({ retryAfterMs: 600_000 });
  });

  it("reads an envelope without an error object as no verdict", async () => {
    expect(await errorOf(door(401, { error: "unauthorized" }))).toMatchObject({ code: "unauthorized", fromServer: false });
  });
});
