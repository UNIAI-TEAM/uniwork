// Sign in with Apple on the iPhone (ADR 0041): Apple's native sheet, with a nonce the server checks. The raw nonce
// goes to the server; Apple's request carries its SHA-256 (hex), which Apple copies into the identity token, so a
// token lifted from another sign-in never matches. The token, the code and the name reach only data/auth/session.ts.
import * as AppleAuthentication from "expo-apple-authentication";
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytesAsync } from "expo-crypto";
import { base64UrlEncode } from "./pkce";

/** What one Apple sign-in hands the server (POST /api/v1/auth/apple/native). */
export interface AppleSignIn {
  identityToken: string;
  rawNonce: string;
  authorizationCode: string | null;
  /** only on the first sign-in to the app, and only if the person shared it */
  givenName: string | null;
  familyName: string | null;
}

const NONCE_BYTES = 32;

/** a fresh raw nonce and the SHA-256 (lowercase hex) Apple's request carries */
export async function appleNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = base64UrlEncode(await getRandomBytesAsync(NONCE_BYTES));
  if (raw.length < 43) throw new Error("CSPRNG returned too few bytes");
  const hashed = await digestStringAsync(CryptoDigestAlgorithm.SHA256, raw, { encoding: CryptoEncoding.HEX });
  return { raw, hashed };
}

/** iOS 13+ with Sign in with Apple; false on Android and wherever the module is missing */
export async function appleSignInAvailable(os: string): Promise<boolean> {
  if (os !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

function isCancel(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ERR_REQUEST_CANCELED";
}

/** Apple's sheet; null when the person closed it, throws when it failed. */
export async function signInWithApple(): Promise<AppleSignIn | null> {
  const nonce = await appleNonce();
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: nonce.hashed,
    });
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
  if (!credential.identityToken) throw new Error("Apple returned no identity token");
  return {
    identityToken: credential.identityToken,
    rawNonce: nonce.raw,
    authorizationCode: credential.authorizationCode,
    givenName: credential.fullName?.givenName ?? null,
    familyName: credential.fullName?.familyName ?? null,
  };
}
