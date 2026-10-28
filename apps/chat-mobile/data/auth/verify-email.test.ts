import { beforeEach, describe, expect, it, vi } from "vitest";

const accountApi = vi.hoisted(() => ({ verifyEmail: vi.fn() }));
vi.mock("../account-api", () => ({ accountApi }));
const auth = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, setUser: vi.fn((user: Record<string, unknown>) => (auth.user = user)) }));
vi.mock("./store", () => ({ useAuthStore: { getState: () => auth } }));

import { verifyAccountEmail } from "./verify-email";

const user = { id: "u1", email: "an@example.com", display_name: "An", email_verified_at: null };
const at = () => new Date("2026-10-28T09:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { ...user };
});

describe("verifyAccountEmail", () => {
  it("adopts the verified user the server answers with", async () => {
    accountApi.verifyEmail.mockResolvedValueOnce({ ...user, email_verified_at: "2026-10-28T08:59:00Z" });
    await verifyAccountEmail("123456", at);
    expect(accountApi.verifyEmail).toHaveBeenCalledWith("123456");
    expect(auth.user).toMatchObject({ email_verified_at: "2026-10-28T08:59:00Z" });
  });

  it("marks the signed-in user verified when the answer drifted, and touches nobody when signed out", async () => {
    accountApi.verifyEmail.mockResolvedValue(null);
    await verifyAccountEmail("123456", at);
    expect(auth.user).toMatchObject({ id: "u1", email_verified_at: "2026-10-28T09:00:00.000Z" });
    auth.user = { ...user };
    await verifyAccountEmail("123456");
    expect(typeof auth.user?.email_verified_at).toBe("string");
    auth.user = null;
    auth.setUser.mockClear();
    await verifyAccountEmail("123456");
    expect(auth.setUser).not.toHaveBeenCalled();
  });

  it("lets a refusal through for the screen to say", async () => {
    const wrong = Object.assign(new Error("invalid_code"), { status: 400 });
    accountApi.verifyEmail.mockRejectedValueOnce(wrong);
    await expect(verifyAccountEmail("000000")).rejects.toBe(wrong);
    expect(auth.setUser).not.toHaveBeenCalled();
  });
});
