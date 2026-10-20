import { describe, expect, it, vi } from "vitest";
import type { ShellConfig } from "../runtime-config";
import {
  TransportError,
  createTransport,
  isAllowedOrigin,
  type FetchLike,
  type TransportErrorCode,
} from "./transport";

const config: ShellConfig = {
  env: "prod",
  appUrl: "https://app.example",
  apiUrl: "https://uniwork.example",
  deploymentId: "default",
  clientId: "uniwork-chat-desktop",
  scheme: "uniworkchat",
  redirectUri: "uniworkchat://auth/callback",
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

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

describe("desktop auth transport", () => {
  it("start sends the PKCE query plus device metadata and refuses redirects / caching", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, { authorization_url: "https://uniwork.example/auth/desktop/authorize?a=1", attempt_expires_at: "x" }),
    );
    const transport = createTransport(config, { fetch });
    const result = await transport.start({
      clientId: "uniwork-chat-desktop",
      codeChallenge: "c".repeat(43),
      state: "state_1",
      redirectUri: "uniworkchat://auth/callback",
      deviceLabel: "UniChat (macOS)",
      platform: "darwin",
    });
    expect(result.authorizationUrl).toBe("https://uniwork.example/auth/desktop/authorize?a=1");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://uniwork.example/api/v1/auth/desktop/start");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      client_id: "uniwork-chat-desktop",
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
      state: "state_1",
      redirect_uri: "uniworkchat://auth/callback",
      deployment_id: "default",
      device_label: "UniChat (macOS)",
      platform: "darwin",
    });
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init.body).toBeUndefined();
  });

  it.each([
    ["an http authorization URL", { authorization_url: "http://evil.example/x" }],
    ["credentials in the URL", { authorization_url: "https://user:pw@uniwork.example/x" }],
    ["an unparsable URL", { authorization_url: "not a url" }],
    ["a missing URL", {}],
    ["a non-object body", []],
  ])("start rejects %s as malformed", async (_label, body) => {
    const transport = createTransport(config, { fetch: async () => json(200, body) });
    const start = { clientId: "uniwork-chat-desktop", codeChallenge: "c", state: "s", redirectUri: "r" };
    expect(await codeOf(transport.start(start))).toBe("malformed_response");
  });

  it("exchange posts snake_case and parses the session strictly", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, sessionBody()));
    const transport = createTransport(config, { fetch });
    const session = await transport.exchange({
      clientId: "uniwork-chat-desktop",
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
      client_id: "uniwork-chat-desktop",
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
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
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
              // headers and a first chunk arrive, then nothing until the abort
              init.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
          });
          return new Response(body, { status });
        },
      });
    expect(await codeOf(stall(200).refresh(refreshReq))).toBe("timeout");
    // an error body that stalls is a timeout too, not the status it carried
    expect(await codeOf(stall(500).refresh(refreshReq))).toBe("timeout");
  });

  it("tells a server verdict from a bare HTTP 401", async () => {
    const enveloped = createTransport(config, {
      fetch: async () => json(401, { error: { code: "unauthorized", message: "x" } }),
    });
    const bare = createTransport(config, {
      fetch: async () => new Response("<html>blocked</html>", { status: 401 }),
    });
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
    expect(JSON.parse(String(init.body))).toEqual({
      device_session_id: "dev_1",
      deployment_id: "default",
      scope: "device",
    });
  });

  it("refuses an http origin outside dev loopback", () => {
    expect(() => createTransport({ ...config, apiUrl: "http://uniwork.example" })).toThrow(/https/i);
    expect(() => createTransport({ ...config, env: "dev", apiUrl: "http://uniwork.example" })).toThrow(/https/i);
    expect(() => createTransport({ ...config, env: "dev", apiUrl: "http://localhost:8080" })).not.toThrow();
    expect(isAllowedOrigin(new URL("http://127.0.0.1:8080"), "dev")).toBe(true);
    expect(isAllowedOrigin(new URL("http://[::1]:8080"), "dev")).toBe(true);
    expect(isAllowedOrigin(new URL("http://localhost:8080"), "staging")).toBe(false);
    expect(isAllowedOrigin(new URL("https://uniwork.example"), "staging")).toBe(true);
  });
});
