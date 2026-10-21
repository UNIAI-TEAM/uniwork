import { beforeEach, describe, expect, it, vi } from "vitest";

const accountApi = vi.hoisted(() => ({ setAiConsent: vi.fn(), withdrawAiConsent: vi.fn() }));
vi.mock("./account-api", () => ({ accountApi }));
const auth = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, setUser: vi.fn((user: Record<string, unknown>) => (auth.user = user)) }));
vi.mock("./auth/store", () => ({ useAuthStore: { getState: () => auth } }));

import { AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { answerAiConsent } from "./ai-consent";

const user = { id: "u1", email: "a@b.c", display_name: "A" };
const at = () => new Date("2026-10-21T08:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { ...user };
});

describe("answerAiConsent", () => {
  it("records agreement to this build's notice and adopts the server's user", async () => {
    accountApi.setAiConsent.mockResolvedValueOnce({ ...user, ai_consent_version: AI_CONSENT_VERSION, ai_consent_at: "2026-10-21T07:00:00Z" });
    await answerAiConsent(true, at);
    expect(accountApi.setAiConsent).toHaveBeenCalledWith(AI_CONSENT_VERSION);
    expect(auth.user).toMatchObject({ ai_consent_version: AI_CONSENT_VERSION, ai_consent_at: "2026-10-21T07:00:00Z" });
  });

  it("withdraws, and a drifted answer still updates the user it was recorded for", async () => {
    accountApi.withdrawAiConsent.mockResolvedValueOnce(null);
    auth.user = { ...user, ai_consent_version: AI_CONSENT_VERSION, ai_consent_at: "x" };
    await answerAiConsent(false, at);
    expect(auth.user).toMatchObject({ ai_consent_version: null, ai_consent_at: null });

    accountApi.setAiConsent.mockResolvedValueOnce(null);
    await answerAiConsent(true, at);
    expect(auth.user).toMatchObject({ ai_consent_version: AI_CONSENT_VERSION, ai_consent_at: "2026-10-21T08:00:00.000Z" });
  });

  it("stamps a drifted agreement with the time it was given", async () => {
    accountApi.setAiConsent.mockResolvedValueOnce(null);
    const before = Date.now();
    await answerAiConsent(true);
    expect(Date.parse(String(auth.user?.ai_consent_at))).toBeGreaterThanOrEqual(before - 1000);
  });

  it("with nobody signed in, a drifted answer changes nothing; a refusal is the caller's to say", async () => {
    auth.user = null;
    accountApi.setAiConsent.mockResolvedValueOnce(null);
    await answerAiConsent(true);
    expect(auth.setUser).not.toHaveBeenCalled();
    accountApi.setAiConsent.mockRejectedValueOnce(new Error("offline"));
    await expect(answerAiConsent(true)).rejects.toThrow("offline");
  });
});
