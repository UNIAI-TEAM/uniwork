// Composition root of the native session. Expo / React Native APIs live here
// and nowhere else in data/auth, so session.ts, transport.ts and pkce.ts stay
// node-testable: Constants for the scheme and client ids, Platform for the
// device label, WebBrowser for the modal system auth session.
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { secureSessionStorage } from "../secure-storage";
import { MobileSession, deviceLabel, type MobileSessionConfig } from "./session";
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

/** the callback URL the consent page redirected to, or null when the person dismissed the sheet */
export async function openAuthBrowser(authorizationUrl: string, redirectUri: string): Promise<string | null> {
  const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
  return result.type === "success" ? result.url : null;
}

export const authConfig = resolveAuthConfig(Constants.expoConfig, Platform.OS);

export const session = new MobileSession({
  config: authConfig,
  transport: createTransport({ deploymentId: authConfig.deploymentId }),
  storage: secureSessionStorage,
  openBrowser: openAuthBrowser,
});
