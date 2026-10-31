import type { EndpointRequest } from "./endpoint-request";
import { readNativeSignIn, readSent, type NativeSignInResult } from "./sign-in-schemas";

/**
 * The doors of the app's own sign-in screen (ADR 0049 §8, spec §3.6): public
 * routes under /api/v1/auth/native that take only the native sign-in
 * clients and answer one NativeSignInSDO. Used by the phone only
 * (apps/chat-mobile binds it to its strict, cookie-less auth transport); the
 * web and the desktop apps sign in through the web pages. Pure.
 *
 * Every door opens a session, so none degrades into one: an answer that
 * cannot be acted on is null, and the caller fails closed (CLAUDE.md › API
 * Compatibility). Secrets (password, codes, provider tokens, the nonce) go
 * once in the body and are never kept here.
 */

/** The languages a door writes its mails in. */
export type NativeLocale = "vi" | "en";

/**
 * NativeClientSDI: what every door says about the app, bound when the factory
 * is made and read again at every door, so a field defined as a getter (the
 * app's language) says what it is at that moment.
 */
export interface NativeClient {
  /** One of NATIVE_SIGN_IN_CLIENTS (default uniwork-chat-mobile); any other is 400 invalid_request. */
  client_id: string;
  deployment_id: string;
  /** Shown in the device list and the owner's new-sign-in mail. */
  device_label?: string;
  platform?: string;
  build?: string;
  /**
   * The app's language: the account a door creates takes it, and the codes a door mails (the sign-up's, the one
   * to another address) are written in it. The app has no uniwork-locale cookie; without this they go out in English.
   */
  locale?: NativeLocale;
}

/** sign_up only from the register screen: an identity that matches no account creates one at once instead of a ticket. */
export type NativeSignInIntent = "sign_in" | "sign_up";

/** A ticket the app holds for its choice screen, with the raw nonce of the provider sheet that earned it. */
export interface NativeTicket {
  ticket: string;
  nonce: string;
}

export function createNativeSignInApi(request: EndpointRequest, client: NativeClient) {
  async function door(path: string, endpoint: string, body: Record<string, unknown>): Promise<NativeSignInResult | null> {
    const raw = await request(path, { method: "POST", body: { ...client, ...body } });
    return readNativeSignIn(raw, endpoint);
  }

  return {
    /** Email and password: signed_in, or mfa_required; 401 invalid_credentials either way it is wrong. */
    signInWithPassword(input: { email: string; password: string }): Promise<NativeSignInResult | null> {
      return door("/api/v1/auth/native/password", "POST /api/v1/auth/native/password", {
        email: input.email,
        password: input.password,
      });
    },

    /** The second step: the mfa_token of the first, and a TOTP or recovery code. */
    verifySecondFactor(input: { mfaToken: string; code: string }): Promise<NativeSignInResult | null> {
      return door("/api/v1/auth/native/mfa", "POST /api/v1/auth/native/mfa", {
        mfa_token: input.mfaToken,
        code: input.code,
      });
    },

    /** The Google SDK's ID token; `nonce` is the raw nonce the SDK was given (the token carries its SHA-256). */
    signInWithGoogle(input: { idToken: string; nonce: string; intent?: NativeSignInIntent }): Promise<NativeSignInResult | null> {
      return door("/api/v1/auth/native/google", "POST /api/v1/auth/native/google", {
        id_token: input.idToken,
        nonce: input.nonce,
        intent: input.intent,
      });
    },

    /** Apple's sheet: identity token, raw nonce, and on the first consent the code and the name Apple shared. */
    signInWithApple(input: {
      identityToken: string;
      nonce: string;
      authorizationCode?: string;
      givenName?: string;
      familyName?: string;
      intent?: NativeSignInIntent;
    }): Promise<NativeSignInResult | null> {
      return door("/api/v1/auth/native/apple", "POST /api/v1/auth/native/apple", {
        identity_token: input.identityToken,
        nonce: input.nonce,
        authorization_code: input.authorizationCode,
        given_name: input.givenName,
        family_name: input.familyName,
        intent: input.intent,
      });
    },

    /** Email sign-up: signed_in on an unverified account (a verification code is mailed). */
    register(input: { email: string; password: string; displayName: string }): Promise<NativeSignInResult | null> {
      return door("/api/v1/auth/native/register", "POST /api/v1/auth/native/register", {
        email: input.email,
        password: input.password,
        display_name: input.displayName,
      });
    },

    /** "Tạo tài khoản mới": only an identity_unmatched ticket; displayName when the identity has no name. */
    createFromTicket(input: NativeTicket & { displayName?: string }): Promise<NativeSignInResult | null> {
      return door("/api/v1/auth/native/sign-in-ticket/create", "POST /api/v1/auth/native/sign-in-ticket/create", {
        ticket: input.ticket,
        nonce: input.nonce,
        display_name: input.displayName,
      });
    },

    /** "Tôi được mời bằng email khác": mail a code to `email`. true when the server said sent (it always does, whoever owns it). */
    async sendTicketEmailCode(input: NativeTicket & { email: string }): Promise<boolean> {
      const raw = await request("/api/v1/auth/native/sign-in-ticket/claim-email", {
        method: "POST",
        body: { ...client, ticket: input.ticket, nonce: input.nonce, email: input.email },
      });
      return readSent(raw, "POST /api/v1/auth/native/sign-in-ticket/claim-email");
    },

    /**
     * A ticket the app drops without spending it ("Hủy", Back, "Không liên kết", the second provider's in link mode):
     * the Apple consent it carries goes back to Apple, as the browser's DELETE /auth/sign-in-ticket does. The server
     * answers the same whether the ticket opened or not, so there is nothing to read.
     */
    async discardTicket(input: NativeTicket): Promise<void> {
      await request("/api/v1/auth/native/sign-in-ticket/discard", {
        method: "POST",
        body: { ...client, ticket: input.ticket, nonce: input.nonce },
      });
    },

    /** The mailed code: links, reclaims or creates by that address; mfa_required when its account has a second factor. */
    verifyTicketEmailCode(input: NativeTicket & { email: string; code: string; displayName?: string }): Promise<NativeSignInResult | null> {
      return door("/api/v1/auth/native/sign-in-ticket/claim-email/verify", "POST /api/v1/auth/native/sign-in-ticket/claim-email/verify", {
        ticket: input.ticket,
        nonce: input.nonce,
        email: input.email,
        code: input.code,
        display_name: input.displayName,
      });
    },
  };
}

export type NativeSignInApi = ReturnType<typeof createNativeSignInApi>;
