import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  LOGIN_ATTEMPT_TTL_MS,
  LoginAttemptStore,
  base64UrlEncode,
  createCodeChallenge,
  generateCodeVerifier,
} from "./pkce";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());

const REDIRECT = "uniworkchat://auth/callback";
const begin = (store: LoginAttemptStore, now: number) =>
  store.begin({ clientId: "uniwork-chat-mobile", deploymentId: "default", redirectUri: REDIRECT, now });

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B S256 vector (base64url, no padding)", async () => {
    await expect(createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("hand-rolled base64url agrees with node for every remainder length", () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32, 64]) {
      const bytes = Uint8Array.from({ length: len }, (_v, i) => (i * 37 + 251) % 256);
      expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
    // + and / of standard base64 become - and _
    const digest = createHash("sha256").update("x").digest();
    expect(base64UrlEncode(new Uint8Array(digest))).toBe(digest.toString("base64url"));
  });

  it("generates 64-char unreserved verifiers and 43-char challenges", async () => {
    const verifier = await generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    await expect(createCodeChallenge(verifier)).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects a verifier outside RFC 7636 and a CSPRNG that returns too few bytes", async () => {
    await expect(createCodeChallenge("short")).rejects.toThrow(/code verifier/);
    await expect(createCodeChallenge("a".repeat(129))).rejects.toThrow(/code verifier/);
    await expect(createCodeChallenge(`${"a".repeat(42)}!`)).rejects.toThrow(/code verifier/);
    await expect(generateCodeVerifier(async () => new Uint8Array(8))).rejects.toThrow(/too few bytes/);
    // the verifier is long enough but the opaque state is not
    const store = new LoginAttemptStore({ randomBytes: async (size) => new Uint8Array(size === 64 ? 64 : 8) });
    await expect(begin(store, 0)).rejects.toThrow(/too few bytes/);
  });

  it("attempt store keeps one live attempt with a 10 minute TTL", async () => {
    const store = new LoginAttemptStore();
    const first = await begin(store, 0);
    expect(first.expiresAt).toBe(LOGIN_ATTEMPT_TTL_MS);
    expect(first.codeChallenge).toBe(await createCodeChallenge(first.verifier));
    expect(first.state).toMatch(/^state_[A-Za-z0-9_-]{43}$/);
    expect(store.peek()).toBe(first);
    const second = await begin(store, 5);
    expect(store.peek()).toBe(second);
    expect(store.current(5)).toBe(second);
    // peek reports an expired attempt (callback validation says `expired`); current drops it
    expect(store.current(LOGIN_ATTEMPT_TTL_MS + 5)).toBeUndefined();
    expect(store.peek()).toBeUndefined();
    expect(store.cancel()).toBe(false);
    await begin(store, 10);
    expect(store.cancel()).toBe(true);
  });
});
