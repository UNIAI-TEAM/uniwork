import { describe, expect, it, vi } from "vitest";
import type { EndpointRequest } from "./endpoint-request";
import { createSignInMethodsApi, stepUpBody } from "./sign-in-methods-api";

const user = { id: "u1", email: "an@acme.vn", display_name: "An" };
const methods = {
  password: { set: true, changed_at: null },
  google: { linked: false, email: null, linked_at: null },
  apple: { linked: true, email: "q7x2@privaterelay.appleid.com", linked_at: null, private_relay: true },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};
const client = { client_id: "uniwork-chat-mobile", deployment_id: "default" };

function harness(answer: unknown) {
  const request = vi.fn<EndpointRequest>().mockResolvedValue(answer);
  const sent = () => {
    const [path, opts] = request.mock.calls.at(-1)!;
    return { path, method: opts?.method, body: JSON.parse(JSON.stringify(opts?.body ?? null)) as unknown };
  };
  return { request, api: createSignInMethodsApi(request), sent };
}

describe("stepUpBody", () => {
  it("builds one proof per kind; only a mailed code names its action", () => {
    expect(stepUpBody({ kind: "password", password: "pw" }, "delete_account")).toEqual({ password: "pw" });
    expect(stepUpBody({ kind: "totp", code: "123456" }, "delete_account")).toEqual({ code: "123456" });
    expect(stepUpBody({ kind: "email_code", code: "482913" }, "delete_account")).toEqual({ code: "482913", action: "delete_account" });
    expect(stepUpBody({ kind: "provider", provider: "apple", token: "jwt", nonce: "raw" }, "unlink_google")).toEqual({
      provider_token: { provider: "apple", token: "jwt", nonce: "raw" },
    });
  });
});

describe("createSignInMethodsApi", () => {
  it("reads the methods, passing the abort signal when there is one", async () => {
    const { request, api } = harness(methods);
    await expect(api.getSignInMethods()).resolves.toEqual(methods);
    expect(request).toHaveBeenLastCalledWith("/api/v1/me/sign-in-methods", undefined);
    const signal = new AbortController().signal;
    await api.getSignInMethods(signal);
    expect(request).toHaveBeenLastCalledWith("/api/v1/me/sign-in-methods", { signal });
    request.mockResolvedValueOnce({ password: "x" });
    await expect(api.getSignInMethods()).resolves.toBeNull();
  });

  it("steps up with one proof and reads the grant, null when none came back", async () => {
    const grant = { step_up_token: "su", expires_at: "2026-10-27T08:10:00Z", method: "email_code" };
    const { request, api, sent } = harness(grant);
    await expect(api.stepUp({ kind: "email_code", code: "482913" }, "set_password")).resolves.toEqual(grant);
    expect(sent()).toEqual({ path: "/api/v1/me/step-up", method: "POST", body: { code: "482913", action: "set_password" } });
    request.mockResolvedValueOnce({ token: "su" });
    await expect(api.stepUp({ kind: "password", password: "pw" }, "set_password")).resolves.toBeNull();
  });

  it("mails a step-up code for one action", async () => {
    const { request, api, sent } = harness({ status: "sent" });
    await expect(api.sendStepUpEmailCode("link_apple")).resolves.toBe(true);
    expect(sent()).toEqual({ path: "/api/v1/me/step-up/email-code", method: "POST", body: { action: "link_apple" } });
    request.mockResolvedValueOnce({});
    await expect(api.sendStepUpEmailCode("link_apple")).resolves.toBe(false);
  });

  it("sets the password and reads both halves of the change", async () => {
    const { request, api, sent } = harness({ user, sign_in_methods: methods });
    const out = await api.setPassword({ new_password: "new-password-2026", step_up_token: "su" });
    expect(out.user?.id).toBe("u1");
    expect(out.methods).toEqual(methods);
    expect(sent()).toEqual({
      path: "/api/v1/me/password",
      method: "PUT",
      body: { new_password: "new-password-2026", step_up_token: "su" },
    });
    request.mockResolvedValueOnce({ user: null });
    await expect(api.setPassword({ new_password: "x".repeat(8), current_password: "pw" })).resolves.toEqual({ user: null, methods: null });
  });

  it("starts a web link on the provider's own route and reads where the browser goes", async () => {
    const { request, api, sent } = harness({ authorization_url: "https://api.test/api/v1/auth/apple/start?intent=link&link_token=x" });
    await expect(api.startLink("apple", { stepUpToken: "su", returnTo: "/settings?tab=security" })).resolves.toBe(
      "https://api.test/api/v1/auth/apple/start?intent=link&link_token=x",
    );
    expect(sent()).toEqual({
      path: "/api/v1/me/sign-in-methods/apple/link",
      method: "POST",
      body: { step_up_token: "su", return_to: "/settings?tab=security" },
    });
    request.mockResolvedValueOnce({ authorization_url: 7 });
    await expect(api.startLink("google", { stepUpToken: "su" })).resolves.toBeNull();
    expect(sent()).toEqual({ path: "/api/v1/me/sign-in-methods/google/link", method: "POST", body: { step_up_token: "su" } });
  });

  it("unlinks on the provider's own route", async () => {
    const { request, api, sent } = harness({ user, sign_in_methods: methods });
    await api.unlink("google", "su");
    expect(sent()).toEqual({ path: "/api/v1/me/sign-in-methods/google/unlink", method: "POST", body: { step_up_token: "su" } });
    request.mockResolvedValueOnce("drift");
    await expect(api.unlink("apple", "su")).resolves.toEqual({ user: null, methods: null });
    expect(sent().path).toBe("/api/v1/me/sign-in-methods/apple/unlink");
  });

  it("links from the app with the sheet's token", async () => {
    const { api, sent } = harness({ user, sign_in_methods: methods });
    await api.linkNative({ provider: "google", stepUpToken: "su", idToken: "gid", nonce: "raw" });
    expect(sent()).toEqual({
      path: "/api/v1/me/sign-in-methods/google/native",
      method: "POST",
      body: { step_up_token: "su", id_token: "gid", nonce: "raw" },
    });
    await api.linkNative({ provider: "apple", stepUpToken: "su", identityToken: "aid", nonce: "raw", authorizationCode: "c", move: true });
    expect(sent()).toEqual({
      path: "/api/v1/me/sign-in-methods/apple/native",
      method: "POST",
      body: { step_up_token: "su", identity_token: "aid", nonce: "raw", authorization_code: "c", move: true },
    });
  });

  it("links the app's ticket with its client fields", async () => {
    const { api, sent } = harness({ user, sign_in_methods: methods });
    const out = await api.linkNativeTicket(client, { ticket: "T", nonce: "raw", move: true, stepUpToken: "su" });
    expect(out.methods).toEqual(methods);
    expect(sent()).toEqual({
      path: "/api/v1/auth/native/sign-in-ticket/link",
      method: "POST",
      body: { ...client, ticket: "T", nonce: "raw", move: true, step_up_token: "su" },
    });
  });
});
