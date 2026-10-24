import { createHash, randomBytes } from "node:crypto";

/**
 * expo-crypto needs the native runtime; tests swap in node:crypto behind the
 * same surface. A leaf module on purpose: a vi.mock factory that imported
 * fakes.ts would re-enter pkce.ts, which imports the module being mocked.
 */
export function expoCryptoMock() {
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { BASE64: "base64", HEX: "hex" },
    getRandomBytesAsync: async (size: number) => new Uint8Array(randomBytes(size)),
    // pkce.ts asks for base64, apple.ts for hex
    digestStringAsync: async (_algorithm: string, data: string, options?: { encoding?: string }) =>
      createHash("sha256")
        .update(data, "ascii")
        .digest(options?.encoding === "hex" ? "hex" : "base64"),
  };
}
