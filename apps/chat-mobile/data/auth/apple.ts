// Sign in with Apple on the iPhone (ADR 0041, 0049): Apple's native sheet, with a nonce the server checks
// (nonce.ts). The token, the code and the name reach only the app's sign-in doors (sign-in.ts), a step-up's proof and
// a link from Settings.
import * as AppleAuthentication from "expo-apple-authentication";
import { ProviderSheetError, providerSheetError } from "@/lib/provider-sheet-error";
import { providerNonce } from "./nonce";

/** What one Apple sign-in hands the server (POST /api/v1/auth/native/apple). */
export interface AppleSignIn {
  identityToken: string;
  rawNonce: string;
  authorizationCode: string | null;
  /** only on the first sign-in to the app, and only if the person shared it */
  givenName: string | null;
  familyName: string | null;
  /** the address Apple shared, only on the first sign-in to the app: what the second step's screen names */
  email: string | null;
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

/**
 * Apple's sheet; null when the person closed it. A failure throws a ProviderSheetError (lib/provider-sheet-error.ts),
 * which crash reporting hears only when this build is at fault.
 */
export async function signInWithApple(): Promise<AppleSignIn | null> {
  const nonce = await providerNonce();
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: nonce.hashed,
    });
  } catch (error) {
    if (isCancel(error)) return null;
    throw providerSheetError("apple", error);
  }
  if (!credential.identityToken) throw new ProviderSheetError("apple", "ERR_APPLE_NO_TOKEN", "Apple returned no identity token");
  return {
    identityToken: credential.identityToken,
    rawNonce: nonce.raw,
    authorizationCode: credential.authorizationCode,
    givenName: credential.fullName?.givenName ?? null,
    familyName: credential.fullName?.familyName ?? null,
    email: credential.email ?? null,
  };
}
