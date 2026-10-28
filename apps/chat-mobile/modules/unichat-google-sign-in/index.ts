// Sign in with Google in the app (ADR 0049 §8, spec §5.1), on Google's own APIs that carry a nonce into the ID token
// (the server refuses a token without SHA-256 of the raw nonce it is sent): GoogleSignIn ≥ 7.1 on iOS
// (signIn(withPresenting:hint:additionalScopes:nonce:)), Credential Manager's "Sign in with Google" option on Android
// (GetSignInWithGoogleOption.setNonce). The public @react-native-google-signin package passes no nonce on either
// platform, hence this module. The client ids are the binary's (plugins/with-google-sign-in.js writes them into
// Info.plist and the Android manifest): a build without them reports unavailable and the app signs in with Google
// through the browser. Null in Expo Go and in tests: data/auth/google.ts reads every call as unavailable then.
import { requireOptionalNativeModule } from "expo";

/** What one Google sign-in hands the app: the ID token (its `nonce` claim is the hash the call was given). */
interface NativeGoogleSignIn {
  idToken: string;
  /** the Google account's address, for the second step's screen; null when Google said none */
  email: string | null;
}

export interface UniChatGoogleSignInModule {
  /** The binary carries a client id (iOS: and registers its URL scheme; Android: and Google Play services runs). */
  isAvailable(): Promise<boolean>;
  /** Google's account chooser with `nonce` (lowercase hex SHA-256 of the raw nonce); null when the person closed it. */
  signIn(nonce: string): Promise<NativeGoogleSignIn | null>;
  /** Forgets the account Google remembers for the app, so the next sign-in shows the chooser again. */
  signOut(): Promise<void>;
}

export const UniChatGoogleSignIn = requireOptionalNativeModule<UniChatGoogleSignInModule>("UniChatGoogleSignIn");
