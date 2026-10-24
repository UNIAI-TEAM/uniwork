import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());
const apple = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(),
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
vi.mock("expo-apple-authentication", () => apple);

import { appleNonce, appleSignInAvailable, signInWithApple } from "./apple";

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  apple.isAvailableAsync.mockReset();
  apple.signInAsync.mockReset();
});

describe("Sign in with Apple, native side", () => {
  it("makes a fresh 43-character nonce and hashes it as lowercase hex", async () => {
    const a = await appleNonce();
    const b = await appleNonce();
    expect(a.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hashed).toBe(sha256Hex(a.raw));
    expect(a.raw).not.toBe(b.raw);
  });

  it("is offered only on iOS, and only when the system has it", async () => {
    expect(await appleSignInAvailable("android")).toBe(false);
    expect(apple.isAvailableAsync).not.toHaveBeenCalled();
    apple.isAvailableAsync.mockResolvedValueOnce(true);
    expect(await appleSignInAvailable("ios")).toBe(true);
    apple.isAvailableAsync.mockResolvedValueOnce(false);
    expect(await appleSignInAvailable("ios")).toBe(false);
    apple.isAvailableAsync.mockRejectedValueOnce(new Error("module missing"));
    expect(await appleSignInAvailable("ios")).toBe(false);
  });

  it("asks for name and email with the hashed nonce, and hands back the raw one", async () => {
    apple.signInAsync.mockResolvedValueOnce({
      identityToken: "id.token.sig",
      authorizationCode: "code-1",
      fullName: { givenName: "Ngọc", familyName: "Trần" },
      user: "001.abc",
    });
    const got = await signInWithApple();
    const [options] = apple.signInAsync.mock.calls[0] as [{ requestedScopes: number[]; nonce: string }];
    expect(options.requestedScopes).toEqual([0, 1]);
    expect(got).toEqual({ identityToken: "id.token.sig", rawNonce: expect.any(String), authorizationCode: "code-1", givenName: "Ngọc", familyName: "Trần" });
    expect(options.nonce).toBe(sha256Hex(got?.rawNonce ?? ""));
  });

  it("carries no name on later sign-ins", async () => {
    apple.signInAsync.mockResolvedValueOnce({ identityToken: "t", authorizationCode: null, fullName: null, user: "u" });
    expect(await signInWithApple()).toMatchObject({ authorizationCode: null, givenName: null, familyName: null });
    apple.signInAsync.mockResolvedValueOnce({ identityToken: "t", authorizationCode: "c", fullName: { givenName: null, familyName: null }, user: "u" });
    expect(await signInWithApple()).toMatchObject({ givenName: null, familyName: null });
  });

  it("answers null when the person closes the sheet, and throws on anything else", async () => {
    apple.signInAsync.mockRejectedValueOnce(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" }));
    expect(await signInWithApple()).toBeNull();
    apple.signInAsync.mockRejectedValueOnce(Object.assign(new Error("failed"), { code: "ERR_REQUEST_FAILED" }));
    await expect(signInWithApple()).rejects.toThrow("failed");
    apple.signInAsync.mockRejectedValueOnce("not an error");
    await expect(signInWithApple()).rejects.toBe("not an error");
    apple.signInAsync.mockResolvedValueOnce({ identityToken: null, authorizationCode: "c", fullName: null, user: "u" });
    await expect(signInWithApple()).rejects.toThrow("no identity token");
  });

  it("refuses a short random source", async () => {
    const crypto = await import("expo-crypto");
    const spy = vi.spyOn(crypto, "getRandomBytesAsync").mockResolvedValueOnce(new Uint8Array(4));
    await expect(appleNonce()).rejects.toThrow("too few bytes");
    spy.mockRestore();
  });
});
