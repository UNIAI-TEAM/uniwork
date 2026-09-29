import { describe, expect, it } from "vitest";
import vector from "../../../../docs/office/g3g4/vectors/pkce-rfc7636.json";
import { assertCodeVerifier, createCodeChallenge, createPkcePair, generateCodeVerifier, PKCE_VERIFIER_LENGTH, PKCE_VERIFIER_MAX_LENGTH, PKCE_VERIFIER_MIN_LENGTH } from "./pkce";

describe("RFC 7636 PKCE", () => {
  it("matches Appendix B S256", () => {
    expect(createCodeChallenge(vector.code_verifier)).toBe(vector.code_challenge);
  });
  it("generates an ASCII verifier in the RFC bounds from the injected CSPRNG", () => {
    const verifier = generateCodeVerifier((size) => new Uint8Array(size).fill(7));
    expect(verifier).toHaveLength(PKCE_VERIFIER_LENGTH);
    expect(verifier.length).toBeGreaterThanOrEqual(PKCE_VERIFIER_MIN_LENGTH);
    expect(verifier.length).toBeLessThanOrEqual(PKCE_VERIFIER_MAX_LENGTH);
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(() => assertCodeVerifier("short")).toThrow();
    expect(() => assertCodeVerifier("x".repeat(PKCE_VERIFIER_MAX_LENGTH + 1))).toThrow();
    expect(() => assertCodeVerifier("x".repeat(PKCE_VERIFIER_MIN_LENGTH - 1))).toThrow();
  });
  it("creates independent verifier challenge pair and opaque values", () => {
    const pair = createPkcePair((size) => new Uint8Array(size).fill(9));
    expect(pair.verifier).not.toBe(pair.challenge);
    expect(pair.challenge).toHaveLength(43);
  });
});
