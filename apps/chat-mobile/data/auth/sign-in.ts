// The ways into the app (ADR 0047 §8, spec §5.1), one request each: the browser (PKCE, with the provider button the
// person tapped), Apple's sheet, email and password, a new account by email, the choice screen's new account and its
// code mailed to another address, and the second factor of any of them. Every door but the browser runs as
// MobileSession.loginWith's issuer, so a sign-out under way drops what it brings; a second factor or a choice comes
// back held in memory (pending-sign-in.ts) and the screen moves on to it. A password or a code lives only in the
// request the screen hands data/auth/store.ts › login and in the closure that sends it: never in an event, an effect,
// a log or anything stored.
import type { NativeSignInIntent, NativeTicket } from "@uniwork/core/api/endpoints/sign-in-native-api";
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { signInWithApple } from "./apple";
import { authConfig, nativeSignIn, session } from "./flow";
import { clearChoice, clearSecondFactor, forgetPendingSignIn, holdStep, pendingChallenge, pendingTicket, usePendingSignIn } from "./pending-sign-in";
import { stepOf, type Issuer, type SecondFactorContext, type SignedIn } from "./sign-in-step";
import { forgetStepUp } from "./step-up-store";
import { TransportError } from "./transport";

export type SignInRequest =
  /** PKCE in the system browser; `provider` sends the web sign-in page straight to it (spec §3.5) */
  | { method: "browser"; provider?: SignInProvider }
  /** Apple's sheet; `sign_up` from the register screen opens an account at once instead of the choice screen */
  | { method: "apple"; intent?: NativeSignInIntent }
  | { method: "password"; email: string; password: string }
  | { method: "register"; email: string; password: string; displayName: string }
  /** the TOTP or recovery code of the challenge held (pendingChallenge) */
  | { method: "second_factor"; code: string }
  /** the choice screen's "Tạo tài khoản mới"; `displayName` when the identity carries no name */
  | { method: "ticket"; displayName?: string }
  /** the choice screen's "Tôi được mời bằng email khác": the code mailed by sendClaimCode */
  | { method: "email_claim"; email: string; code: string; displayName?: string };

export type SignInOutcome =
  | SignedIn
  /** the challenge is held: the second step's screen asks for the code */
  | { kind: "second_factor" }
  /** the ticket is held: the choice screen asks what to do with the identity */
  | { kind: "choice" }
  /** nothing came of it: a sheet or the browser closed, or a sign-out moved on */
  | { kind: "dismissed" };

const SIGNED_IN: SignedIn = { kind: "signed_in", reclaimed: false, linkSkipped: null };
const DISMISSED: SignInOutcome = { kind: "dismissed" };

const now = (): number => Date.now();

/** The step the app held for this request is gone: expired, or never held (the app restarted). Never the server's. */
const expired = (): TransportError => new TransportError("sign_in_expired");

function ticketOrThrow(): NativeTicket {
  const held = pendingTicket(now());
  if (!held) throw expired();
  return held;
}

/** What the second step says about a sign-in that started on the choice screen: whose account, the identity it links. */
function choiceContext(method: "ticket" | "email_claim", email: string | null): SecondFactorContext {
  const identity = usePendingSignIn.getState().choice?.identity;
  return { method, email: email ?? identity?.email ?? null, provider: identity?.provider ?? null };
}

type DoorRequest = Exclude<SignInRequest, { method: "browser" }>;

function issuerFor(request: DoorRequest): Issuer {
  const { deploymentId } = authConfig;
  switch (request.method) {
    case "apple":
      return async (stale) => {
        const apple = await signInWithApple();
        if (!apple || stale()) return null;
        const result = await nativeSignIn.signInWithApple({
          identityToken: apple.identityToken,
          nonce: apple.rawNonce,
          authorizationCode: apple.authorizationCode ?? undefined,
          givenName: apple.givenName ?? undefined,
          familyName: apple.familyName ?? undefined,
          intent: request.intent,
        });
        return stepOf(result, { deploymentId, nonce: apple.rawNonce, context: { method: "apple", email: apple.email, provider: "apple" } });
      };
    case "password":
      return async () => {
        const email = request.email.trim();
        const result = await nativeSignIn.signInWithPassword({ email, password: request.password });
        return stepOf(result, { deploymentId, context: { method: "password", email, provider: null } });
      };
    case "register":
      return async () => {
        const email = request.email.trim();
        const result = await nativeSignIn.register({ email, password: request.password, displayName: request.displayName.trim() });
        return stepOf(result, { deploymentId, context: { method: "register", email, provider: null } });
      };
    case "second_factor":
      return async () => {
        const challenge = pendingChallenge(now());
        if (!challenge) throw expired();
        const result = await nativeSignIn.verifySecondFactor({ mfaToken: challenge.token, code: request.code.trim() });
        return stepOf(result, { deploymentId, context: challenge.context });
      };
    case "ticket":
      return async () => {
        const result = await nativeSignIn.createFromTicket({ ...ticketOrThrow(), displayName: request.displayName?.trim() || undefined });
        return stepOf(result, { deploymentId, context: choiceContext("ticket", null) });
      };
    case "email_claim":
      return async () => {
        const email = request.email.trim();
        const result = await nativeSignIn.verifyTicketEmailCode({
          ...ticketOrThrow(),
          email,
          code: request.code.trim(),
          displayName: request.displayName?.trim() || undefined,
        });
        return stepOf(result, { deploymentId, context: choiceContext("email_claim", email) });
      };
  }
}

/**
 * Whether a session from this request spent the choice screen's ticket: its new account, its mailed code, or the
 * second factor of that code. Any other sign-in keeps it, for the choice screen to link the identity into the account
 * the person just signed in to ("Tôi đã có tài khoản").
 */
function spendsTicket(request: DoorRequest): boolean {
  if (request.method === "ticket" || request.method === "email_claim") return true;
  return request.method === "second_factor" && pendingChallenge(now())?.context.method === "email_claim";
}

/** One sign-in. Rejects with the door's verdict (a TransportError), or with what a sheet threw. */
export async function runSignIn(request: SignInRequest): Promise<SignInOutcome> {
  if (request.method === "browser") {
    await session.login(request.provider ? { provider: request.provider } : {});
    if (session.status() !== "signed-in") return DISMISSED;
    clearSecondFactor();
    return SIGNED_IN;
  }
  const spends = spendsTicket(request);
  const result = await session.loginWith(issuerFor(request));
  if (!result) return session.status() === "signed-in" ? SIGNED_IN : DISMISSED;
  switch (result.kind) {
    case "signed_in":
      clearSecondFactor();
      if (spends) clearChoice();
      return result;
    case "mfa":
      holdStep(result, now());
      return { kind: "second_factor" };
    case "choice":
      holdStep(result, now());
      return { kind: "choice" };
  }
}

/**
 * "Tôi được mời bằng email khác": mail a six-digit code to `email` for the ticket held. True when the server said
 * sent, which it says whoever owns the address; a code asked again too soon is 429 rate_limited with retry_after.
 */
export async function sendClaimCode(email: string): Promise<boolean> {
  return nativeSignIn.sendTicketEmailCode({ ...ticketOrThrow(), email: email.trim() });
}

/** On sign-out: nothing a sign-in left waiting, and no step-up token, outlives the session. */
export function forgetSignIn(): void {
  forgetPendingSignIn();
  forgetStepUp();
}
