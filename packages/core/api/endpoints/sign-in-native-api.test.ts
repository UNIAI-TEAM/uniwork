import { describe, expect, it, vi } from "vitest";
import type { EndpointRequest } from "./endpoint-request";
import { createNativeSignInApi, type NativeClient, type NativeLocale } from "./sign-in-native-api";

const client: NativeClient = {
  client_id: "uniwork-chat-mobile",
  deployment_id: "default",
  device_label: "iPhone của An",
  platform: "ios",
  build: "0.4.0",
};

const session = { access_token: "a", refresh_token: "r", deployment_id: "default" };

function harness(answer: unknown = { status: "signed_in", session, reclaimed: false, link_skipped: "" }) {
  const request = vi.fn<EndpointRequest>().mockResolvedValue(answer);
  const api = createNativeSignInApi(request, client);
  // What the transport would serialise: undefined optional fields fall away.
  const sent = () => {
    const [path, opts] = request.mock.calls.at(-1)!;
    return { path, method: opts?.method, body: JSON.parse(JSON.stringify(opts?.body)) as Record<string, unknown> };
  };
  return { request, api, sent };
}

describe("createNativeSignInApi", () => {
  it("sends every door the app's client fields with its own, and reads the one answer", async () => {
    const { api, sent } = harness();
    await expect(api.signInWithPassword({ email: "an@acme.vn", password: "pw" })).resolves.toEqual({
      status: "signed_in",
      session,
      reclaimed: false,
      link_skipped: null,
    });
    expect(sent()).toEqual({
      path: "/api/v1/auth/native/password",
      method: "POST",
      body: { ...client, email: "an@acme.vn", password: "pw" },
    });

    await api.verifySecondFactor({ mfaToken: "chal", code: "123456" });
    expect(sent()).toMatchObject({ path: "/api/v1/auth/native/mfa", body: { ...client, mfa_token: "chal", code: "123456" } });

    await api.signInWithGoogle({ idToken: "gid", nonce: "raw" });
    expect(sent()).toEqual({
      path: "/api/v1/auth/native/google",
      method: "POST",
      body: { ...client, id_token: "gid", nonce: "raw" },
    });
    await api.signInWithGoogle({ idToken: "gid", nonce: "raw", intent: "sign_up" });
    expect(sent().body.intent).toBe("sign_up");

    await api.signInWithApple({
      identityToken: "aid",
      nonce: "raw",
      authorizationCode: "code",
      givenName: "Ngọc",
      familyName: "Trần",
      intent: "sign_in",
    });
    expect(sent()).toEqual({
      path: "/api/v1/auth/native/apple",
      method: "POST",
      body: {
        ...client,
        identity_token: "aid",
        nonce: "raw",
        authorization_code: "code",
        given_name: "Ngọc",
        family_name: "Trần",
        intent: "sign_in",
      },
    });
    await api.signInWithApple({ identityToken: "aid", nonce: "raw" });
    expect(sent().body).toEqual({ ...client, identity_token: "aid", nonce: "raw" });

    await api.register({ email: "an@acme.vn", password: "password123", displayName: "An" });
    expect(sent()).toMatchObject({
      path: "/api/v1/auth/native/register",
      body: { ...client, email: "an@acme.vn", password: "password123", display_name: "An" },
    });
  });

  it("works a ticket with the nonce that earned it", async () => {
    const { api, sent } = harness();
    await api.createFromTicket({ ticket: "T", nonce: "raw", displayName: "An" });
    expect(sent()).toEqual({
      path: "/api/v1/auth/native/sign-in-ticket/create",
      method: "POST",
      body: { ...client, ticket: "T", nonce: "raw", display_name: "An" },
    });
    await api.verifyTicketEmailCode({ ticket: "T", nonce: "raw", email: "an@acme.vn", code: "482913" });
    expect(sent()).toEqual({
      path: "/api/v1/auth/native/sign-in-ticket/claim-email/verify",
      method: "POST",
      body: { ...client, ticket: "T", nonce: "raw", email: "an@acme.vn", code: "482913" },
    });
  });

  it("mails a claim code and reports whether the server said sent", async () => {
    const { request, api, sent } = harness({ status: "sent" });
    await expect(api.sendTicketEmailCode({ ticket: "T", nonce: "raw", email: "an@acme.vn" })).resolves.toBe(true);
    expect(sent()).toEqual({
      path: "/api/v1/auth/native/sign-in-ticket/claim-email",
      method: "POST",
      body: { ...client, ticket: "T", nonce: "raw", email: "an@acme.vn" },
    });
    request.mockResolvedValueOnce({ status: 1 });
    await expect(api.sendTicketEmailCode({ ticket: "T", nonce: "raw", email: "an@acme.vn" })).resolves.toBe(false);
  });

  it("drops a ticket with its nonce, and reads nothing of the answer, malformed or not", async () => {
    const { request, api, sent } = harness({ status: "discarded" });
    await expect(api.discardTicket({ ticket: "T", nonce: "raw" })).resolves.toBeUndefined();
    expect(sent()).toEqual({
      path: "/api/v1/auth/native/sign-in-ticket/discard",
      method: "POST",
      body: { ...client, ticket: "T", nonce: "raw" },
    });
    request.mockResolvedValueOnce("not json at all");
    await expect(api.discardTicket({ ticket: "T", nonce: "raw" })).resolves.toBeUndefined();
  });

  it("says the app's language at every door, as it is when the door is called", async () => {
    let language: NativeLocale = "vi";
    const request = vi.fn<EndpointRequest>().mockResolvedValue({ status: "sent" });
    const api = createNativeSignInApi(request, {
      ...client,
      get locale() {
        return language;
      },
    });
    const sentLocale = () => (request.mock.calls.at(-1)?.[1]?.body as Record<string, unknown>).locale;
    await api.register({ email: "an@acme.vn", password: "password123", displayName: "An" });
    expect(sentLocale()).toBe("vi");
    language = "en";
    await api.sendTicketEmailCode({ ticket: "T", nonce: "raw", email: "an@acme.vn" });
    expect(sentLocale()).toBe("en");
    await api.createFromTicket({ ticket: "T", nonce: "raw" });
    expect(sentLocale()).toBe("en");
  });

  it("answers null for a malformed answer: no door ever degrades into a session", async () => {
    const { request, api } = harness({ status: "signed_in" });
    const doors = [
      () => api.signInWithPassword({ email: "a", password: "b" }),
      () => api.verifySecondFactor({ mfaToken: "c", code: "1" }),
      () => api.signInWithGoogle({ idToken: "gid", nonce: "raw" }),
      () => api.signInWithApple({ identityToken: "aid", nonce: "raw" }),
      () => api.register({ email: "a", password: "password123", displayName: "An" }),
      () => api.createFromTicket({ ticket: "T", nonce: "n" }),
      () => api.verifyTicketEmailCode({ ticket: "T", nonce: "n", email: "a", code: "1" }),
    ];
    // A branch without its field, an unknown status, no envelope at all.
    for (const answer of [{ status: "signed_in" }, { status: "welcome", session }, "signed_in", null]) {
      request.mockResolvedValue(answer);
      for (const door of doors) await expect(door()).resolves.toBeNull();
    }
  });

  it("lets the transport's refusal through untouched for the caller to read", async () => {
    const { request, api } = harness();
    const refusal = Object.assign(new Error("refused"), { code: "invalid_credentials", status: 401 });
    request.mockRejectedValueOnce(refusal);
    await expect(api.signInWithPassword({ email: "a", password: "b" })).rejects.toBe(refusal);
  });
});
