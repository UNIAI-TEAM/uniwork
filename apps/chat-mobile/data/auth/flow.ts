// Composition root of the native session. Expo / React Native APIs live here
// and nowhere else in data/auth, so session.ts, transport.ts and pkce.ts stay
// node-testable: Constants for the scheme and client ids, Platform for the
// device label, WebBrowser for the modal system auth session, expo/fetch
// (strict-fetch.ts) for the requests. Apple's and Google's sheets (apple.ts,
// google.ts) are the other native wrappers, used by the doors of the app's
// sign-in screen (sign-in.ts).
import { createNativeSignInApi, type NativeClient } from "@uniwork/core/api/endpoints/sign-in-native-api";
import { NO_AUTH_PROVIDERS, readAuthProviders, type AuthProviders } from "@uniwork/core/api/endpoints/sign-in-schemas";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { buildLabel } from "@/lib/build-info";
import { signInOfferOf, type SignInOffer } from "@/lib/sign-in-offer";
import { buildInfo } from "../build-info";
import { secureSessionStorage } from "../secure-storage";
import { whileSystemUiOpen } from "../system-ui";
import { appleSignInAvailable } from "./apple";
import { googleSignInAvailable } from "./google";
import { MobileSession, deviceLabel, type MobileSessionConfig } from "./session";
import { strictFetch } from "./strict-fetch";
import { createEndpointRequest } from "./endpoint-request";
import { createTransport } from "./transport";

interface ExpoConfigLike {
  scheme?: string | string[];
  extra?: Record<string, unknown>;
}

/** app.config.ts › scheme + extra → the session's config; defaults are the dev build's */
export function resolveAuthConfig(expoConfig: ExpoConfigLike | null, os: string): MobileSessionConfig & { scheme: string } {
  const scheme = (Array.isArray(expoConfig?.scheme) ? expoConfig.scheme[0] : expoConfig?.scheme) ?? "uniworkchat";
  const extra = expoConfig?.extra ?? {};
  return {
    scheme,
    clientId: typeof extra.authClientId === "string" ? extra.authClientId : "uniwork-chat-mobile",
    deploymentId: typeof extra.deploymentId === "string" ? extra.deploymentId : "default",
    redirectUri: `${scheme}://auth/callback`,
    platform: os,
    deviceLabel: deviceLabel(os),
  };
}

/** the callback URL the consent page redirected to, or null when the person dismissed the sheet; while the sheet
 *  is up nothing reloads the app under it (data/system-ui.ts) */
export async function openAuthBrowser(authorizationUrl: string, redirectUri: string): Promise<string | null> {
  const result = await whileSystemUiOpen(() => WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri));
  return result.type === "success" ? result.url : null;
}

export const authConfig = resolveAuthConfig(Constants.expoConfig, Platform.OS);

export const session = new MobileSession({
  config: authConfig,
  // The sign-in routes carry the PKCE code and the refresh token: their redirect: "error" is honoured natively.
  transport: createTransport({ deploymentId: authConfig.deploymentId }, { fetch: strictFetch }),
  storage: secureSessionStorage,
  openBrowser: openAuthBrowser,
});

/** NativeClientSDI: what every door of the app's sign-in screen says about the app (spec §3.6). */
export const nativeClient: NativeClient = {
  client_id: authConfig.clientId,
  deployment_id: authConfig.deploymentId,
  device_label: authConfig.deviceLabel,
  platform: authConfig.platform,
  build: buildLabel(buildInfo()),
};

// The doors carry the password, the codes and the provider tokens: the same strict fetch as the session's routes.
const authRequest = createEndpointRequest({ fetch: strictFetch });

/** The doors of the app's own sign-in screen (ADR 0047 §8), bound to this app and deployment. */
export const nativeSignIn = createNativeSignInApi(authRequest, nativeClient);

/** Which sign-ins this server offers; every one off when it cannot be asked (an older server, no network). */
async function authProviders(): Promise<AuthProviders> {
  try {
    return readAuthProviders(await authRequest("/api/v1/auth/providers"));
  } catch {
    return NO_AUTH_PROVIDERS;
  }
}

/** The ways in the sign-in screen offers besides email: what the server takes, and the sheets this phone can open. */
export async function signInOffer(): Promise<SignInOffer> {
  const [providers, appleNative, googleNative] = await Promise.all([authProviders(), appleSignInAvailable(Platform.OS), googleSignInAvailable()]);
  return signInOfferOf({ os: Platform.OS, providers, appleNative, googleNative });
}
