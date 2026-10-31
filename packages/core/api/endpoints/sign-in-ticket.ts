import type { MFAChallenge, SessionResponse } from "../../types/user";
import { ApiError, refreshSession, request } from "../http";
import { startSession } from "./auth";
import { readSent, readSignInMethodsChange, readSignInTicket, type SignInMethodsChange, type SignInTicket } from "./sign-in-schemas";

/**
 * The browser's pending provider sign-in (ADR 0049 §2c, spec §3.2): a
 * Google or Apple sign-in that found no account to open left a ticket in the
 * HttpOnly `uniwork_sign_in_ticket` cookie, and the choice screen
 * (/auth/continue) works it through these routes. Web only: the cookie rides
 * the same-site fetch, no script ever reads the ticket. Every POST sends a
 * JSON body, even an empty one: these routes refuse anything else
 * (mw.SameSiteJSON, 415).
 *
 * create and claim-email verify open a session, so they fail loudly like
 * login (auth.ts startSession); the rest degrade.
 */

/** The pending sign-in, or null when there is none (404 sign_in_ticket_missing: expired, spent, or never there). */
export async function getSignInTicket(signal?: AbortSignal): Promise<SignInTicket | null> {
  try {
    return readSignInTicket(await request("/api/v1/auth/sign-in-ticket", { skipRefresh: true, signal }));
  } catch (err) {
    if (err instanceof ApiError && err.code === "sign_in_ticket_missing") return null;
    throw err;
  }
}

/** "Tạo tài khoản mới": an account with the provider's address; `displayName` when the identity has no name. */
export async function createFromSignInTicket(displayName?: string): Promise<SessionResponse | MFAChallenge | null> {
  const raw = await request("/api/v1/auth/sign-in-ticket/create", {
    method: "POST",
    body: displayName ? { display_name: displayName } : {},
    skipRefresh: true,
  });
  return startSession(raw, "POST /api/v1/auth/sign-in-ticket/create");
}

/** "Tôi được mời bằng email khác": mail a code to `email`. Always "sent" whoever owns it; 429 when asked again too soon. */
export async function sendSignInEmailClaim(email: string): Promise<boolean> {
  const raw = await request("/api/v1/auth/sign-in-ticket/claim-email", {
    method: "POST",
    body: { email },
    skipRefresh: true,
  });
  return readSent(raw, "POST /api/v1/auth/sign-in-ticket/claim-email");
}

/**
 * The mailed code: links into that address's account, takes back an
 * unverified one (`reclaimed`), or creates one with it; the second factor of
 * an account that has one is still owed (the challenge, as login).
 */
export async function verifySignInEmailClaim(input: {
  email: string;
  code: string;
  displayName?: string;
}): Promise<SessionResponse | MFAChallenge | null> {
  const raw = await request("/api/v1/auth/sign-in-ticket/claim-email/verify", {
    method: "POST",
    body: { email: input.email, code: input.code, ...(input.displayName ? { display_name: input.displayName } : {}) },
    skipRefresh: true,
  });
  return startSession(raw, "POST /api/v1/auth/sign-in-ticket/claim-email/verify");
}

/** "Hủy": drop the pending sign-in (an Apple consent it carried goes back to Apple). Always 204. */
export async function discardSignInTicket(): Promise<void> {
  await request("/api/v1/auth/sign-in-ticket", { method: "DELETE", skipRefresh: true });
}

/**
 * "Tôi đã có tài khoản" once signed in: link the pending identity into this
 * account. The bearer's session must have started after the ticket, or
 * carry a step-up token (403 proof_required otherwise); `move` takes it off
 * the empty account a 409 sign_in_method_movable named.
 */
export async function linkSignInTicket(input: { move?: boolean; stepUpToken?: string | null }): Promise<SignInMethodsChange> {
  const send = () =>
    request("/api/v1/auth/sign-in-ticket/link", {
      method: "POST",
      body: {
        ...(input.move ? { move: true } : {}),
        ...(input.stepUpToken ? { step_up_token: input.stepUpToken } : {}),
      },
    });
  let raw: unknown;
  try {
    raw = await send();
  } catch (err) {
    // A bearer route under /api/v1/auth/, which the transport never
    // refreshes for: an access token that merely expired gets one refresh
    // and one retry here. A session that ended stays refused.
    if (!(err instanceof ApiError && err.status === 401) || !(await refreshSession())) throw err;
    raw = await send();
  }
  return readSignInMethodsChange(raw, "POST /api/v1/auth/sign-in-ticket/link");
}
