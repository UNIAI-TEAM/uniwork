import { beforeEach, describe, expect, it, vi } from "vitest";
import { desktopConsent, desktopConsentCommand, desktopStart } from "./auth";

const requestMock = vi.fn();
vi.mock("../http", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

describe("desktop consent endpoint", () => {
  beforeEach(() => requestMock.mockReset());

  it("parses consent metadata", async () => {
    requestMock.mockResolvedValue({ attempt_id: "a", account_id: "u", client_id: "uniwork-office", deployment_id: "default", redirect_uri: "uniwork-office://auth/callback", device_label: "Laptop", platform: "windows", build: "1", csrf_token: "csrf" });
    await expect(desktopConsent("a")).resolves.toMatchObject({ attempt_id: "a", csrf_token: "csrf" });
  });

  it("returns null for a malformed response", async () => {
    requestMock.mockResolvedValue({ attempt_id: "a", client_id: 4 });
    await expect(desktopConsent("a")).resolves.toBeNull();
  });

  it("accepts a terminal server state with no CSRF and an email-less account", async () => {
    requestMock.mockResolvedValue({ status: "approved", attempt_id: "a", account_id: "u", account_email: "", client_id: "uniwork-office", deployment_id: "default", redirect_uri: "uniwork-office://auth/callback", device_label: "Laptop", platform: "windows", build: "1", csrf_token: "" });
    await expect(desktopConsent("a")).resolves.toMatchObject({ status: "approved", csrf_token: "", account_email: "" });
  });

  it("posts the explicit decision and parses callback", async () => {
    requestMock.mockResolvedValue({ status: "ok", callback_url: "uniwork-office://auth/callback?code=x&state=y" });
    await expect(desktopConsentCommand({ attempt_id: "a", csrf_token: "csrf", decision: "approve" })).resolves.toMatchObject({ status: "ok" });
    expect(requestMock).toHaveBeenCalledWith("/api/v1/auth/desktop/authorize", expect.objectContaining({ method: "POST" }));
  });
});

describe("desktop start endpoint", () => {
  beforeEach(() => requestMock.mockReset());

  it("parses the opaque authorization URL", async () => {
    requestMock.mockResolvedValue({ authorization_url: "https://app.example.test/auth/desktop/authorize?attempt_id=a", attempt_expires_at: "2026-09-30T00:00:00Z" });
    await expect(desktopStart({ client_id: "uniwork-office", code_challenge: "challenge", code_challenge_method: "S256", state: "state", redirect_uri: "uniwork-office://auth/callback", deployment_id: "default" })).resolves.toMatchObject({ authorization_url: expect.stringContaining("attempt_id") });
  });

  it("returns null for malformed start responses", async () => {
    requestMock.mockResolvedValue({ authorization_url: 42 });
    await expect(desktopStart({ client_id: "uniwork-office", code_challenge: "challenge", code_challenge_method: "S256", state: "state", redirect_uri: "uniwork-office://auth/callback", deployment_id: "default" })).resolves.toBeNull();
  });
});
