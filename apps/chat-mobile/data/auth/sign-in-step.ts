// What one door of the app's own sign-in screen answered (core's NativeSignInResult, ADR 0047 §8), as the app acts on
// it: a session for MobileSession to adopt, or a step the sign-in needs before one — the second factor, or the choice
// screen for a Google or Apple identity no account matched. The session goes through the app's own strict
// parseSession (its deployment included): core reads the envelope and never the tokens. Only a session ever reaches
// MobileSession.loginWith's adoption; the other two wait in memory (pending-sign-in.ts).
import type { NativeSignInResult, SignInIdentity, SignInProvider, SignInTicketKind } from "@uniwork/core/api/endpoints/sign-in-schemas";
import type { LoginMethod } from "./machine";
import { TransportError, parseSession, type DesktopSession } from "./transport";

/** What the second step's screen says about the first: whose sign-in it is, and the provider a pending link is for. */
export interface SecondFactorContext {
  /** the first factor */
  method: LoginMethod;
  /** the address the person typed or the provider named; null when neither said one */
  email: string | null;
  /** the Google or Apple identity the challenge may link once the code passes (spec §3.3); null for a password */
  provider: SignInProvider | null;
}

export type SignInStep =
  | { kind: "session"; session: DesktopSession; reclaimed: boolean; linkSkipped: string | null }
  | { kind: "mfa"; token: string; context: SecondFactorContext }
  | { kind: "choice"; ticket: string; nonce: string; identity: SignInIdentity; ticketKind: SignInTicketKind };

/** A step the sign-in needs before a session: never adopted, never persisted, never a route param. */
export type PendingStep = Exclude<SignInStep, { kind: "session" }>;

/** One door as MobileSession.loginWith runs it, told when a sign-out moved on meanwhile; null: a sheet was closed. */
export type Issuer = (stale: () => boolean) => Promise<SignInStep | null>;

/** A session MobileSession adopted, and what the screen says about it once. */
export interface SignedIn {
  kind: "signed_in";
  /** the sign-in took the account back from whoever registered the address first */
  reclaimed: boolean;
  /** the provider the second step was to link could not be linked; the server's reason */
  linkSkipped: string | null;
}

/**
 * The answer of a door as a step. A ticket comes only from a provider door, whose raw `nonce` is the ticket's key
 * (spec §3.2): a ticket anywhere else, or an answer core could not read (null), fails closed as malformed_response,
 * never a half sign-in.
 */
export function stepOf(
  result: NativeSignInResult | null,
  ctx: { deploymentId: string; context: SecondFactorContext; nonce?: string },
): SignInStep {
  if (!result) throw new TransportError("malformed_response");
  switch (result.status) {
    case "signed_in":
      return {
        kind: "session",
        session: parseSession(result.session, ctx.deploymentId),
        reclaimed: result.reclaimed,
        linkSkipped: result.link_skipped,
      };
    case "mfa_required":
      return { kind: "mfa", token: result.mfa_token, context: ctx.context };
    case "identity_unmatched":
    case "link_required":
      if (!ctx.nonce) throw new TransportError("malformed_response");
      return {
        kind: "choice",
        ticket: result.ticket,
        nonce: ctx.nonce,
        identity: result.identity,
        ticketKind: result.status === "identity_unmatched" ? "unmatched" : "link_required",
      };
  }
}
