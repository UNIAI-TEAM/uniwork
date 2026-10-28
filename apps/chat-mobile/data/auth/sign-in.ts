// The ways into the app (ADR 0047 §8, spec §5.1), one request each: the browser (PKCE, with the provider button the
// person tapped), Apple's and Google's sheets, email and password, a new account by email, the choice screen's new account and its
// code mailed to another address, and the second factor of any of them. Every door but the browser runs as
// MobileSession.loginWith's issuer, so a sign-out under way drops what it brings; a second factor or a choice comes
// back held in memory (pending-sign-in.ts) and the screen moves on to it. A password or a code lives only in the
// request the screen hands data/auth/store.ts › login and in the closure that sends it: never in an event, an effect,
// a log or anything stored.
import type { NativeSignInIntent, NativeTicket } from "@uniwork/core/api/endpoints/sign-in-native-api";
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { signInWithApple } from "./apple";
import { signInWithGoogle, signOutOfGoogle } from "./google";
import { authConfig, nativeSignIn, session } from "./flow";
import {
  clearChoice,
  clearSecondFactor,
  forgetChoiceMark,
  forgetPendingSignIn,
  holdStep,
  pendingChallenge,
  pendingTicket,
  usePendingSignIn,
} from "./pending-sign-in";
import { stepOf, type Issuer, type SecondFactorContext, type SignedIn } from "./sign-in-step";
import { forgetStepUp } from "./step-up-store";
import { TransportError } from "./transport";

export type SignInRequest =
  /** PKCE in the system browser; `provider` sends the web sign-in page straight to it (spec §3.5) */
  | { method: "browser"; provider?: SignInProvider }
  /** Apple's sheet; `sign_up` from the register screen opens an account at once instead of the choice screen */
  | { method: "apple"; intent?: NativeSignInIntent }
  /** Google's sheet, the same way */
  | { method: "google"; intent?: NativeSignInIntent }
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
    case "google":
      return async (stale) => {
        const google = await signInWithGoogle();
        if (!google || stale()) return null;
        const result = await nativeSignIn.signInWithGoogle({ idToken: google.idToken, nonce: google.rawNonce, intent: request.intent });
        return stepOf(result, { deploymentId, nonce: google.rawNonce, context: { method: "google", email: google.email, provider: "google" } });
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

/** The choice screen's own ways in: a session from one of them, or from its second factor, spends the ticket. */
const CHOICE_METHODS: ReadonlySet<string> = new Set(["ticket", "email_claim"]);

/**
 * Whether a session from this request spent the choice screen's ticket: its new account, its mailed code, or the
 * second factor of either (a new account's identity may open an account with one by then). Any other sign-in keeps
 * it, for the choice screen to link the identity into the account the person just signed in to ("Tôi đã có tài
 * khoản").
 */
function spendsTicket(request: DoorRequest): boolean {
  if (CHOICE_METHODS.has(request.method)) return true;
  return request.method === "second_factor" && CHOICE_METHODS.has(pendingChallenge(now())?.context.method ?? "");
}

/** One sign-in. Rejects with the door's verdict (a TransportError), or with what a sheet threw. */
export async function runSignIn(request: SignInRequest): Promise<SignInOutcome> {
  if (request.method === "browser") {
    await session.login(request.provider ? { provider: request.provider } : {});
    if (session.status() !== "signed-in") return DISMISSED;
    clearSecondFactor();
    forgetChoiceMark();
    return SIGNED_IN;
  }
  const spends = spendsTicket(request);
  const result = await session.loginWith(issuerFor(request));
  if (!result) return session.status() === "signed-in" ? SIGNED_IN : DISMISSED;
  switch (result.kind) {
    case "signed_in":
      clearSecondFactor();
      // A choice the sign-in did not spend waits for its link ("Tôi đã có tài khoản"); a kill now loses nothing to tell.
      if (spends) clearChoice();
      else forgetChoiceMark();
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

/**
 * A fresh token of `provider`'s own sheet, with the raw nonce it was given: a step-up's proof, or a link from
 * Settings. `chooseAccount` makes Google ask which account (a link) instead of offering the one it remembers. Null
 * when the sheet was closed, or this phone has none for the provider.
 */
export async function providerToken(
  provider: SignInProvider,
  options: { chooseAccount?: boolean } = {},
): Promise<{ token: string; nonce: string; authorizationCode?: string } | null> {
  if (provider === "apple") {
    const apple = await signInWithApple();
    return apple && { token: apple.identityToken, nonce: apple.rawNonce, authorizationCode: apple.authorizationCode ?? undefined };
  }
  if (options.chooseAccount) await signOutOfGoogle();
  const google = await signInWithGoogle();
  return google && { token: google.idToken, nonce: google.rawNonce };
}

/**
 * On sign-out: nothing a sign-in left waiting, and no step-up token, outlives the session; Google forgets the account
 * it remembers, so the next person on this phone is not offered the last one's.
 */
export function forgetSignIn(): void {
  forgetPendingSignIn();
  forgetStepUp();
  void signOutOfGoogle();
}
