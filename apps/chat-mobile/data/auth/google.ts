// Sign in with Google in the app (ADR 0047 §8): Google's account chooser (modules/unichat-google-sign-in), with the
// SHA-256 of a fresh raw nonce, which Google copies into the ID token; the raw nonce goes to the server with the token
// (nonce.ts). Where the module is missing or reports unavailable (Expo Go, a build without the Google client ids, an
// Android phone without Google Play services), the app signs in with Google through the browser instead
// (lib/sign-in-offer.ts). The token reaches only the app's sign-in doors, a step-up's proof and a link from Settings.
import { UniChatGoogleSignIn } from "@/modules/unichat-google-sign-in";
import { providerNonce } from "./nonce";

/** What one Google sign-in hands the server (POST /api/v1/auth/native/google). */
export interface GoogleSignIn {
  idToken: string;
  rawNonce: string;
  /** the Google account's address, for the second step's screen */
  email: string | null;
}

/** Whether this phone opens Google's sheet; false wherever the module is missing or cannot. */
export async function googleSignInAvailable(): Promise<boolean> {
  if (!UniChatGoogleSignIn) return false;
  try {
    return await UniChatGoogleSignIn.isAvailable();
  } catch {
    return false;
  }
}

/** Google's chooser; null when the person closed it (or there is no module), throws when it failed. */
export async function signInWithGoogle(): Promise<GoogleSignIn | null> {
  if (!UniChatGoogleSignIn) return null;
  const nonce = await providerNonce();
  const answer = await UniChatGoogleSignIn.signIn(nonce.hashed);
  if (!answer) return null;
  if (!answer.idToken) throw new Error("Google returned no ID token");
  return { idToken: answer.idToken, rawNonce: nonce.raw, email: answer.email || null };
}

/**
 * Google forgets the account it remembers for the app: before a link from Settings (the chooser then asks which
 * account) and on sign-out (the next person on this phone is not offered the last one's). Never fails a sign-out.
 */
export async function signOutOfGoogle(): Promise<void> {
  try {
    await UniChatGoogleSignIn?.signOut();
  } catch {
    // nothing remembered, or the module could not: the next chooser asks again either way
  }
}
