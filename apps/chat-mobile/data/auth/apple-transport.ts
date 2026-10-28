// Sign in with Apple's two routes (ADR 0041) over the auth transport's request (strict errors, timeout, no redirect,
// no cache): POST /auth/apple/native turns Apple's identity token into the native session the PKCE exchange also
// issues; GET /auth/providers says whether this server takes it.
import type { AppleSignIn } from "./apple";
import type { Issuer } from "./sign-in-step";
import { createAuthRequest, isRecord, parseSession, type DesktopSession, type FetchLike } from "./transport";

/** POST /auth/apple/native: Apple's identity token with the raw nonce, plus the device fields of a native session */
type AppleSignInRequest = AppleSignIn & { clientId: string; deviceLabel: string; platform: string };

export interface AppleTransport {
  signIn(request: AppleSignInRequest): Promise<DesktopSession>;
  /** whether this server takes Sign in with Apple; false on any failure (an older server, no network) */
  enabled(): Promise<boolean>;
}

export function createAppleTransport(config: { deploymentId: string }, options: { fetch: FetchLike; timeoutMs?: number }): AppleTransport {
  const { deploymentId } = config;
  const request = createAuthRequest(options);
  return {
    async signIn(input) {
      const raw = await request("POST", "/auth/apple/native", {
        body: {
          client_id: input.clientId,
          identity_token: input.identityToken,
          nonce: input.rawNonce,
          deployment_id: deploymentId,
          device_label: input.deviceLabel,
          platform: input.platform,
          ...(input.authorizationCode ? { authorization_code: input.authorizationCode } : {}),
          ...(input.givenName ? { given_name: input.givenName } : {}),
          ...(input.familyName ? { family_name: input.familyName } : {}),
        },
      });
      return parseSession(raw, deploymentId);
    },
    async enabled() {
      try {
        const raw = await request("GET", "/auth/providers");
        return isRecord(raw) && raw.apple === true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Sign in with Apple as MobileSession.loginWith takes it: Apple's sheet, then the server. Null when the person closed
 * the sheet, or when a sign-out moved on while it was up (the server is then never asked).
 */
export function appleIssuer(
  transport: AppleTransport,
  sheet: () => Promise<AppleSignIn | null>,
  device: { clientId: string; deviceLabel: string; platform: string },
): Issuer {
  return async (stale) => {
    const apple = await sheet();
    if (!apple || stale()) return null;
    return { kind: "session", session: await transport.signIn({ ...apple, ...device }), reclaimed: false, linkSkipped: null };
  };
}
