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

  it.each([null, [], { user: null }, { user: { id: 7 } }])("a malformed consent answer (%j) degrades to null", async (raw) => {
    request.mockResolvedValue(raw);
    await expect(account.setAiConsent("v1")).resolves.toBeNull();
    await expect(account.withdrawAiConsent()).resolves.toBeNull();
  });

  it("the app's instance goes through the shared transport", async () => {
    await accountApi.deleteAccount({ password: "pw" });
    expect(api.request).toHaveBeenCalledWith("/api/v1/me/delete", expect.objectContaining({ method: "POST" }));
  });
});
