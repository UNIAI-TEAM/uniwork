import { describe, expect, it } from "vitest";
import {
  LOGIN_ATTEMPT_TTL_MS,
  LoginAttemptStore,
  createCodeChallenge,
  generateCodeVerifier,
} from "./pkce";

const REDIRECT = "uniworkchat://auth/callback";
const begin = (store: LoginAttemptStore, now: number) =>
  store.begin({ clientId: "uniwork-chat-desktop", deploymentId: "default", redirectUri: REDIRECT, now });

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B S256 vector (base64url, no padding)", () => {
    expect(createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("generates 64-char unreserved verifiers and 43-char challenges", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    expect(createCodeChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects a verifier outside RFC 7636 and a CSPRNG that returns too few bytes", () => {
    expect(() => createCodeChallenge("short")).toThrow(/code verifier/);
    expect(() => createCodeChallenge("a".repeat(129))).toThrow(/code verifier/);
    expect(() => createCodeChallenge(`${"a".repeat(42)}!`)).toThrow(/code verifier/);
    expect(() => generateCodeVerifier(() => new Uint8Array(8))).toThrow(/too few bytes/);
    // the verifier is long enough but the opaque state/attempt ids are not
    const store = new LoginAttemptStore({ randomBytes: (size) => new Uint8Array(size === 64 ? 64 : 8) });
    expect(() => begin(store, 0)).toThrow(/too few bytes/);
  });

  it("attempt store keeps one live attempt with a 10 minute TTL", () => {
    const store = new LoginAttemptStore();
    const first = begin(store, 0);
    expect(first.expiresAt).toBe(LOGIN_ATTEMPT_TTL_MS);
    expect(first.codeChallenge).toBe(createCodeChallenge(first.verifier));
    expect(store.peek()).toBe(first);
    const second = begin(store, 5);
    expect(store.peek()).toBe(second);
    expect(store.current(5)).toBe(second);
    // peek reports an expired attempt (callback validation says `expired`); current drops it
    expect(store.peek()).toBe(second);
    expect(store.current(LOGIN_ATTEMPT_TTL_MS + 5)).toBeUndefined();
    expect(store.peek()).toBeUndefined();
    expect(store.cancel()).toBe(false);
    begin(store, 10);
    expect(store.cancel()).toBe(true);
  });
});
