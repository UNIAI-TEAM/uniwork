// The account endpoints: the request each sends, what it reads from a good
// answer, and that a malformed answer degrades instead of throwing.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn(async () => ({ status: "ok" })) } }));

import { api } from "./api";
import { accountApi, createAccountApi } from "./account-api";

const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
const account = createAccountApi(request);
const user = { id: "u1", email: "a@b.c", display_name: "A", ai_consent_version: "v1", ai_consent_at: "2026-10-21T08:00:00Z" };

beforeEach(() => request.mockReset());

describe("account endpoints", () => {
  it("deleteAccount posts the one proof and resolves on any 2xx, a malformed one included", async () => {
    request.mockResolvedValueOnce({ status: "ok" });
    await expect(account.deleteAccount({ password: "pw" })).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("/api/v1/me/delete", { method: "POST", body: JSON.stringify({ password: "pw" }) });
    request.mockResolvedValueOnce("<html>");
    await expect(account.deleteAccount({ code: "123456" })).resolves.toBeUndefined();
  });

  it("deleteAccount lets a refusal through for the sheet to explain", async () => {
    const refusal = Object.assign(new Error("owner"), { status: 409 });
    request.mockRejectedValueOnce(refusal);
    await expect(account.deleteAccount({ email_confirmation: "a@b.c" })).rejects.toBe(refusal);
  });

  it("transferOwnership posts the new owner and the password, and resolves on any 2xx, a malformed one included", async () => {
    request.mockResolvedValueOnce({ member: { user_id: "u2", role: "owner" } });
    await expect(account.transferOwnership("mot minh", "u2", "pw")).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("/api/v1/orgs/mot%20minh/transfer-ownership", {
      method: "POST",
      body: JSON.stringify({ to_user_id: "u2", password: "pw" }),
    });
    request.mockResolvedValueOnce(["drift"]);
    await expect(account.transferOwnership("acme", "u2", "pw")).resolves.toBeUndefined();
    const refusal = Object.assign(new Error("password_incorrect"), { status: 403 });
    request.mockRejectedValueOnce(refusal);
    await expect(account.transferOwnership("acme", "u2", "bad")).rejects.toBe(refusal);
  });

  it("setAiConsent puts the version and reads the user back", async () => {
    request.mockResolvedValueOnce({ user });
    await expect(account.setAiConsent("v1")).resolves.toMatchObject({ id: "u1", ai_consent_version: "v1" });
    expect(request).toHaveBeenCalledWith("/api/v1/me/ai-consent", { method: "PUT", body: JSON.stringify({ version: "v1" }) });
  });

  it("withdrawAiConsent deletes it and reads the user back", async () => {
    request.mockResolvedValueOnce({ user: { ...user, ai_consent_version: null, ai_consent_at: null } });
    await expect(account.withdrawAiConsent()).resolves.toMatchObject({ ai_consent_version: null });
    expect(request).toHaveBeenCalledWith("/api/v1/me/ai-consent", { method: "DELETE" });
  });

  it("setLocale patches the person's language and reads the user back", async () => {
    request.mockResolvedValueOnce({ user: { ...user, locale: "vi" } });
    await expect(account.setLocale("vi")).resolves.toMatchObject({ id: "u1", locale: "vi" });
    expect(request).toHaveBeenCalledWith("/api/v1/me", { method: "PATCH", body: JSON.stringify({ locale: "vi" }) });
  });

  it("setPushPreviews puts the person's choice and reads the user back", async () => {
    request.mockResolvedValueOnce({ user: { ...user, push_previews: false } });
    await expect(account.setPushPreviews(false)).resolves.toMatchObject({ id: "u1", push_previews: false });
    expect(request).toHaveBeenCalledWith("/api/v1/me/push-previews", { method: "PUT", body: JSON.stringify({ show: false }) });
    // A drifted flag reads as absent (shown), never as a crash.
    request.mockResolvedValueOnce({ user: { ...user, push_previews: "no" } });
    expect((await account.setPushPreviews(true))?.push_previews).toBeUndefined();
  });

  it("pushPreviewPolicy reads the organization's rule, and a drifted answer reads as not hidden", async () => {
    request.mockResolvedValueOnce({ hidden: true, hidden_at: "2026-10-22T08:00:00Z", can_manage: false });
    await expect(account.pushPreviewPolicy("acme corp")).resolves.toEqual({ hidden: true, can_manage: false });
    expect(request).toHaveBeenCalledWith("/api/v1/orgs/acme%20corp/push-preview-policy", { signal: undefined });
    for (const raw of [null, "<html>", { hidden: "yes", can_manage: 1 }]) {
      request.mockResolvedValueOnce(raw);
      await expect(account.pushPreviewPolicy("acme")).resolves.toEqual({ hidden: false, can_manage: false });
    }
  });

  // Audit "Security & privacy", privacy-defaults-off: the floor under the phone's privacy choices. A drifted answer
  // is no answer (null): the phone keeps the floor it last heard rather than lifting it on a garbled reply.
  it("mobileSecurityPolicy reads the organization's requirements, and a drifted answer reads as none heard", async () => {
    request.mockResolvedValueOnce({ require_app_lock: true, block_screen_capture: false, can_manage: false });
    await expect(account.mobileSecurityPolicy("acme corp")).resolves.toEqual({ require_app_lock: true, block_screen_capture: false });
    expect(request).toHaveBeenCalledWith("/api/v1/orgs/acme%20corp/mobile-security-policy", { signal: undefined });
    for (const raw of [null, "<html>", { require_app_lock: "yes", block_screen_capture: false }, { require_app_lock: true }]) {
      request.mockResolvedValueOnce(raw);
      await expect(account.mobileSecurityPolicy("acme")).resolves.toBeNull();
    }
  });

  it.each([null, [], { user: null }, { user: { id: 7 } }])("a malformed user answer (%j) degrades to null", async (raw) => {
    request.mockResolvedValue(raw);
    await expect(account.setPushPreviews(false)).resolves.toBeNull();
    await expect(account.setAiConsent("v1")).resolves.toBeNull();
    await expect(account.withdrawAiConsent()).resolves.toBeNull();
    await expect(account.setLocale("en")).resolves.toBeNull();
  });

  it("the app's instance goes through the shared transport", async () => {
    await accountApi.deleteAccount({ password: "pw" });
    expect(api.request).toHaveBeenCalledWith("/api/v1/me/delete", expect.objectContaining({ method: "POST" }));
  });
});
