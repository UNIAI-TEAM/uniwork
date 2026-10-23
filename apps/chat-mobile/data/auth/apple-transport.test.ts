import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appleIssuer, createAppleTransport, type AppleTransport } from "./apple-transport";
import { TransportError, type FetchLike } from "./transport";

beforeEach(() => configureRuntime({ apiUrl: "https://uniwork.example", appUrl: "https://uniwork.example" }));
afterEach(() => resetRuntimeConfig());

const config = { deploymentId: "default" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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

const appleReq = {
  clientId: "uniwork-chat-mobile",
  identityToken: "id.token.sig",
  rawNonce: "raw-nonce",
  authorizationCode: "code-1",
  givenName: "Ngọc",
  familyName: "Trần",
  deviceLabel: "UniChat (iOS)",
  platform: "ios",
};

describe("Sign in with Apple transport (ADR 0041)", () => {
  it("posts the token, the raw nonce and the first sign-in's name, and parses the native session", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, sessionBody()));
    const apple = createAppleTransport(config, { fetch });
    expect(await apple.signIn(appleReq)).toMatchObject({ accountId: "acc_1", deviceSessionId: "dev_1", refreshToken: "rt_1" });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uniwork.example/api/v1/auth/apple/native");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: "uniwork-chat-mobile",
      identity_token: "id.token.sig",
      nonce: "raw-nonce",
      authorization_code: "code-1",
      given_name: "Ngọc",
      family_name: "Trần",
      deployment_id: "default",
      device_label: "UniChat (iOS)",
      platform: "ios",
    });
  });

  it("leaves out what Apple did not share", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, sessionBody()));
    await createAppleTransport(config, { fetch }).signIn({ ...appleReq, authorizationCode: null, givenName: null, familyName: null });
    const body = JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["client_id", "deployment_id", "device_label", "identity_token", "nonce", "platform"]);
  });

  it.each([
    [401, "apple_token_invalid"],
    [409, "apple_account_conflict"],
    [403, "mfa_required"],
    [503, "apple_auth_unavailable"],
  ] as const)("reads the server's %i %s verdict", async (status, code) => {
    const apple = createAppleTransport(config, { fetch: async () => json(status, { error: { code, message: "x" } }) });
    expect(await errorOf(apple.signIn(appleReq))).toMatchObject({ code, status, fromServer: true });
  });

  it.each([
    ["not an object", ["x"], "malformed_response"],
    ["a missing token", sessionBody({ access_token: undefined }), "malformed_response"],
    ["a zero expiry", sessionBody({ expires_in: 0 }), "malformed_response"],
    ["a session of another deployment", sessionBody({ deployment_id: "eu" }), "wrong_deployment"],
  ])("refuses %s", async (_label, body, code) => {
    const apple = createAppleTransport(config, { fetch: async () => json(200, body) });
    expect((await errorOf(apple.signIn(appleReq))).code).toBe(code);
  });

  it.each([
    ["apple on", async () => json(200, { google: true, apple: true }), true],
    ["apple off", async () => json(200, { google: true, apple: false }), false],
    ["an older server without the field", async () => json(200, { google: true }), false],
    ["apple as a string", async () => json(200, { apple: "true" }), false],
    ["not an object", async () => json(200, null), false],
    ["a 500", async () => json(500, {}), false],
    ["no network", async (): Promise<Response> => Promise.reject(new TypeError("offline")), false],
  ] as const)("reads the provider list: %s", async (_label, fetch, want) => {
    expect(await createAppleTransport(config, { fetch }).enabled()).toBe(want);
  });

  it("asks the provider list with a GET to the API origin", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { apple: true }));
    await createAppleTransport(config, { fetch }).enabled();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uniwork.example/api/v1/auth/providers");
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
  });
});

describe("appleIssuer", () => {
  const device = { clientId: "uniwork-chat-mobile", deviceLabel: "UniChat (iOS)", platform: "ios" };
  const credential = { identityToken: "t", rawNonce: "n", authorizationCode: "c", givenName: null, familyName: null };
  const transport = (): AppleTransport & { signIn: ReturnType<typeof vi.fn> } => ({
    signIn: vi.fn(async () => ({ accountId: "a" }) as never),
    enabled: vi.fn(async () => true),
  });

  it("sends Apple's credential with the device fields", async () => {
    const t = transport();
    await appleIssuer(t, async () => credential, device)(() => false);
    expect(t.signIn).toHaveBeenCalledWith({ ...credential, ...device });
  });

  it("asks the server nothing when the sheet was closed, or a sign-out moved on while it was up", async () => {
    const t = transport();
    expect(await appleIssuer(t, async () => null, device)(() => false)).toBeNull();
    expect(await appleIssuer(t, async () => credential, device)(() => true)).toBeNull();
    expect(t.signIn).not.toHaveBeenCalled();
  });
});
