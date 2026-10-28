import type { EndpointRequest } from "./endpoint-request";
import type { NativeClient, NativeTicket } from "./sign-in-native-api";
import {
  readAuthorizationUrl,
  readSent,
  readSignInMethods,
  readSignInMethodsChange,
  readStepUpGrant,
  type SignInMethods,
  type SignInMethodsChange,
  type SignInProvider,
  type StepUpAction,
  type StepUpGrant,
} from "./sign-in-schemas";

/**
 * "Confirm it is you" and Settings › Sign-in methods (ADR 0047 §5-6, spec
 * §3.7) over any bearer transport: sign-in-methods.ts binds it to the web's,
 * and the phone to its own, so both send the same proof and read the same
 * answer. Pure.
 *
 * Commands that changed how the account signs in answer a
 * SignInMethodsChange whose halves parse on their own; a step-up or a link
 * start that cannot be read is null, and the caller says it did not happen.
 */

/** One proof for POST /me/step-up, of a kind SignInMethods.proofs offers. */
export type StepUpProofInput =
  | { kind: "password"; password: string }
  /** The second factor: a TOTP or a recovery code (proofs is [totp]). */
  | { kind: "totp"; code: string }
  /** The code POST /me/step-up/email-code mailed for the same action. */
  | { kind: "email_code"; code: string }
  /** App only: a fresh identity token of the linked Apple or Google account, with the raw nonce the sheet was given. */
  | { kind: "provider"; provider: SignInProvider; token: string; nonce: string };

/** StepUpSDI for a proof; `action` rides only with a mailed code, which serves that action alone. */
export function stepUpBody(proof: StepUpProofInput, action: StepUpAction): Record<string, unknown> {
  switch (proof.kind) {
    case "password":
      return { password: proof.password };
    case "totp":
      return { code: proof.code };
    case "email_code":
      return { code: proof.code, action };
    case "provider":
      return { provider_token: { provider: proof.provider, token: proof.token, nonce: proof.nonce } };
  }
}

/** PUT /me/password: `current_password` changes a password of an account without a second factor; else the token. */
export interface SetPasswordBody {
  new_password: string;
  current_password?: string;
  step_up_token?: string;
}

// A literal union declared in this file, so scripts/mobile-route-catalogue.mjs
// expands each builder into every provider's route the server registers.
type Provider = "google" | "apple";
const linkPath = (provider: Provider) => `/api/v1/me/sign-in-methods/${provider}/link`;
const unlinkPath = (provider: Provider) => `/api/v1/me/sign-in-methods/${provider}/unlink`;
const nativeLinkPath = (provider: Provider) => `/api/v1/me/sign-in-methods/${provider}/native`;

/** The app's link from Settings: the provider sheet's token, behind a step-up of the same device session. */
export type NativeLinkInput =
  | { provider: "google"; stepUpToken: string; idToken: string; nonce: string; move?: boolean }
  | {
      provider: "apple";
      stepUpToken: string;
      identityToken: string;
      nonce: string;
      authorizationCode?: string;
      move?: boolean;
    };

function nativeLinkBody(input: NativeLinkInput): Record<string, unknown> {
  if (input.provider === "google") {
    return { step_up_token: input.stepUpToken, id_token: input.idToken, nonce: input.nonce, move: input.move };
  }
  return {
    step_up_token: input.stepUpToken,
    identity_token: input.identityToken,
    nonce: input.nonce,
    authorization_code: input.authorizationCode,
    move: input.move,
  };
}

export function createSignInMethodsApi(request: EndpointRequest) {
  async function change(path: string, endpoint: string, method: "POST" | "PUT", body: Record<string, unknown>): Promise<SignInMethodsChange> {
    return readSignInMethodsChange(await request(path, { method, body }), endpoint);
  }

  return {
    /** How the account signs in and the proofs it takes here; null when the answer does not parse. */
    async getSignInMethods(signal?: AbortSignal): Promise<SignInMethods | null> {
      const raw = await request("/api/v1/me/sign-in-methods", signal ? { signal } : undefined);
      return readSignInMethods(raw, "GET /api/v1/me/sign-in-methods");
    },

    /** Trade one proof for a ten-minute token bound to this session; null when no usable token came back. */
    async stepUp(proof: StepUpProofInput, action: StepUpAction): Promise<StepUpGrant | null> {
      return readStepUpGrant(await request("/api/v1/me/step-up", { method: "POST", body: stepUpBody(proof, action) }));
    },

    /** Mail a six-digit code that serves `action` only; true when the server said sent. */
    async sendStepUpEmailCode(action: StepUpAction): Promise<boolean> {
      const raw = await request("/api/v1/me/step-up/email-code", { method: "POST", body: { action } });
      return readSent(raw, "POST /api/v1/me/step-up/email-code");
    },

    /** Set the first password or change it; a change signs every other session out (the server decides). */
    setPassword(body: SetPasswordBody): Promise<SignInMethodsChange> {
      return change("/api/v1/me/password", "PUT /api/v1/me/password", "PUT", { ...body });
    },

    /**
     * Web only: where the browser goes to link `provider` (a five-minute
     * link_token bound to this browser session rides in it). `returnTo` is
     * the same-origin page the round trip comes back to with
     * `sign_in_method` and `result` (auth/sign-in-errors.ts readLinkResult).
     */
    async startLink(provider: SignInProvider, input: { stepUpToken: string; returnTo?: string }): Promise<string | null> {
      const raw = await request(linkPath(provider), {
        method: "POST",
        body: { step_up_token: input.stepUpToken, return_to: input.returnTo },
      });
      return readAuthorizationUrl(raw, `POST /api/v1/me/sign-in-methods/${provider}/link`);
    },

    /** Never the last way in, never Apple of a relay account; signs every other session out. */
    unlink(provider: SignInProvider, stepUpToken: string): Promise<SignInMethodsChange> {
      return change(unlinkPath(provider), `POST /api/v1/me/sign-in-methods/${provider}/unlink`, "POST", { step_up_token: stepUpToken });
    },

    /** App only: link the account the provider's sheet just proved. */
    linkNative(input: NativeLinkInput): Promise<SignInMethodsChange> {
      return change(nativeLinkPath(input.provider), `POST /api/v1/me/sign-in-methods/${input.provider}/native`, "POST", nativeLinkBody(input));
    },

    /**
     * App only, "Tôi đã có tài khoản" once signed in: link the identity of the
     * app's ticket into this account. The device session must have signed in
     * after the ticket was issued, or carry a step-up token of this session.
     */
    linkNativeTicket(client: NativeClient, input: NativeTicket & { move?: boolean; stepUpToken?: string }): Promise<SignInMethodsChange> {
      return change("/api/v1/auth/native/sign-in-ticket/link", "POST /api/v1/auth/native/sign-in-ticket/link", "POST", {
        ...client,
        ticket: input.ticket,
        nonce: input.nonce,
        move: input.move,
        step_up_token: input.stepUpToken,
      });
    },
  };
}

export type SignInMethodsApi = ReturnType<typeof createSignInMethodsApi>;
