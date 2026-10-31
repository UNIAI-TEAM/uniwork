// The nonce of a provider sheet (Apple's, Google's): the raw value goes to the server, the provider is handed its
// SHA-256 (lowercase hex) and copies that into the identity token, so a token lifted from another sign-in never
// matches (spec §3.6). The server keeps nothing: an app ticket opens only with the raw nonce of the sheet that earned
// it (spec §3.2).
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytesAsync } from "expo-crypto";
import { base64UrlEncode } from "./pkce";

const NONCE_BYTES = 32;

/** a fresh raw nonce and the SHA-256 (lowercase hex) the provider's request carries */
export async function providerNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = base64UrlEncode(await getRandomBytesAsync(NONCE_BYTES));
  if (raw.length < 43) throw new Error("CSPRNG returned too few bytes");
  const hashed = await digestStringAsync(CryptoDigestAlgorithm.SHA256, raw, { encoding: CryptoEncoding.HEX });
  return { raw, hashed };
}
