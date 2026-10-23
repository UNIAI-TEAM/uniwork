// Composition root of the native session. Expo / React Native APIs live here
// and nowhere else in data/auth, so session.ts, transport.ts and pkce.ts stay
// node-testable: Constants for the scheme and client ids, Platform for the
// device label, WebBrowser for the modal system auth session, expo/fetch (strict-fetch.ts) for the requests.
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { secureSessionStorage } from "../secure-storage";
import { whileSystemUiOpen } from "../system-ui";
import { MobileSession, deviceLabel, type MobileSessionConfig } from "./session";
import { strictFetch } from "./strict-fetch";
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
