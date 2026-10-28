import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());
const native = vi.hoisted(() => ({
  module: {
    isAvailable: vi.fn<() => Promise<boolean>>(async () => true),
    signIn: vi.fn<(nonce: string) => Promise<{ idToken: string; email: string | null } | null>>(),
    signOut: vi.fn<() => Promise<void>>(async () => undefined),
  } as Record<string, unknown> | null,
}));
vi.mock("@/modules/unichat-google-sign-in", () => ({
  get UniChatGoogleSignIn() {
    return native.module;
  },
}));

import { googleSignInAvailable, signInWithGoogle, signOutOfGoogle } from "./google";

type Module = { isAvailable: ReturnType<typeof vi.fn>; signIn: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> };
const mod = native.module as unknown as Module;
const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  native.module = mod as unknown as Record<string, unknown>;
  vi.clearAllMocks();
});

describe("Google's sheet", () => {
  it("hands Google the hash of a fresh nonce, and the server the raw one with the token", async () => {
    mod.signIn.mockResolvedValueOnce({ idToken: "google.id.token", email: "an@gmail.com" });
    const got = await signInWithGoogle();
    expect(got).toEqual({ idToken: "google.id.token", rawNonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), email: "an@gmail.com" });
    expect(mod.signIn).toHaveBeenCalledExactlyOnceWith(sha256Hex(got?.rawNonce ?? ""));
  });

  it("answers null when the person closes the chooser, and throws on a token-less answer or a failure", async () => {
    mod.signIn.mockResolvedValueOnce(null);
    expect(await signInWithGoogle()).toBeNull();
    mod.signIn.mockResolvedValueOnce({ idToken: "", email: null });
    await expect(signInWithGoogle()).rejects.toMatchObject({ name: "ProviderSheetError", code: "ERR_GOOGLE_NO_TOKEN" });
    mod.signIn.mockRejectedValueOnce(Object.assign(new Error("failed"), { code: "ERR_GOOGLE_SIGN_IN" }));
    await expect(signInWithGoogle()).rejects.toMatchObject({ name: "ProviderSheetError", provider: "google", code: "ERR_GOOGLE_SIGN_IN", message: "failed" });
  });

  it("reads an empty address as none", async () => {
    mod.signIn.mockResolvedValueOnce({ idToken: "t", email: "" });
    expect(await signInWithGoogle()).toMatchObject({ email: null });
  });

  it("is offered only where the module says it can, a failing check reading as no", async () => {
    expect(await googleSignInAvailable()).toBe(true);
    mod.isAvailable.mockResolvedValueOnce(false);
    expect(await googleSignInAvailable()).toBe(false);
    mod.isAvailable.mockRejectedValueOnce(new Error("no activity"));
    expect(await googleSignInAvailable()).toBe(false);
  });

  it("forgets the account Google remembers, and never fails a sign-out doing it", async () => {
    await signOutOfGoogle();
    expect(mod.signOut).toHaveBeenCalledOnce();
    mod.signOut.mockRejectedValueOnce(new Error("nothing to clear"));
    await expect(signOutOfGoogle()).resolves.toBeUndefined();
  });

  it("does nothing, and offers nothing, without the module (Expo Go, tests)", async () => {
    native.module = null;
    expect(await googleSignInAvailable()).toBe(false);
    expect(await signInWithGoogle()).toBeNull();
    await expect(signOutOfGoogle()).resolves.toBeUndefined();
  });
});
