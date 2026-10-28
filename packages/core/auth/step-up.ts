import {
  isStepUpProof,
  knownProofs,
  type SignInProvider,
  type StepUpAction,
  type StepUpGrant,
  type StepUpProof,
} from "../api/endpoints/sign-in-schemas";

/**
 * "Confirm it is you" (ADR 0047 §5, spec §3.7) as rules both platforms share.
 * A step-up token lives ten minutes, is bound to the session that bought it,
 * and is never persisted: the web keeps it in a memory store
 * (step-up-store.ts), the phone in its own, both built on these functions.
 * Pure: no clock (callers pass `now`), no storage, no transport.
 */

/** How long a token lives on the server (StepUpSDO.expires_at is ten minutes after issue). */
export const STEP_UP_WINDOW_MS = 10 * 60_000;

/** A token this close to its end is treated as gone: the command it is about to ride takes a moment too. */
const STEP_UP_MARGIN_MS = 30_000;

/**
 * Which emailed-code actions serve each command. A token bought with a code
 * serves only the commands of the action the mail named (the server's
 * requireStepUp); PUT /me/password takes both password actions. A password,
 * a second factor or a provider token buys a token every command takes.
 */
const SERVED_BY: Record<StepUpAction, readonly StepUpAction[]> = {
  set_password: ["set_password", "change_password"],
  change_password: ["set_password", "change_password"],
  link_google: ["link_google"],
  link_apple: ["link_apple"],
  unlink_google: ["unlink_google"],
  unlink_apple: ["unlink_apple"],
  enable_mfa: ["enable_mfa"],
  delete_account: ["delete_account"],
  transfer_ownership: ["transfer_ownership"],
};

export function linkAction(provider: SignInProvider): StepUpAction {
  return provider === "apple" ? "link_apple" : "link_google";
}

export function unlinkAction(provider: SignInProvider): StepUpAction {
  return provider === "apple" ? "unlink_apple" : "unlink_google";
}

/** A step-up token as a client holds it, in memory only. */
export interface HeldStepUp {
  token: string;
  /** The proof that bought it; null when the server named one this client does not know. */
  method: StepUpProof | null;
  /**
   * The one action it serves when an emailed code bought it — or when the
   * proof is unknown, read as narrowly as a code; null for every other proof
   * (it then serves every command).
   */
  action: StepUpAction | null;
  /** The account it was bought for: a token of another account never serves. */
  userId: string;
  /** Local clock, margin taken off. */
  expiresAtMs: number;
}

/**
 * The token of a step-up that just passed, as the client holds it. The
 * deadline is local: the server's `expires_at` counted from now when it
 * reads as a plausible remaining life (0–10 minutes on synchronised clocks),
 * else the full window — so a phone whose clock runs ahead never throws a
 * fresh token away, and one that runs behind never keeps it past ten minutes.
 */
export function holdStepUp(grant: StepUpGrant, ctx: { userId: string; action: StepUpAction; now: number }): HeldStepUp {
  const method = isStepUpProof(grant.method) ? grant.method : null;
  const remaining = Date.parse(grant.expires_at) - ctx.now;
  const life = Number.isFinite(remaining) && remaining > 0 && remaining <= STEP_UP_WINDOW_MS ? remaining : STEP_UP_WINDOW_MS;
  return {
    token: grant.step_up_token,
    method,
    action: method === "email_code" || method === null ? ctx.action : null,
    userId: ctx.userId,
    expiresAtMs: ctx.now + life - STEP_UP_MARGIN_MS,
  };
}

/** Whether a held token may ride `action`'s command for `userId` at `now`. */
export function stepUpServes(held: HeldStepUp | null, ctx: { action: StepUpAction; userId: string | null; now: number }): boolean {
  if (!held || !ctx.userId || held.userId !== ctx.userId || ctx.now >= held.expiresAtMs) return false;
  return held.action === null || SERVED_BY[ctx.action].includes(held.action);
}

/** The token to send with `action`'s command, or null: ask for a proof first. */
export function stepUpTokenFor(held: HeldStepUp | null, ctx: { action: StepUpAction; userId: string | null; now: number }): string | null {
  return held && stepUpServes(held, ctx) ? held.token : null;
}

/** The proofs a client can present: the web never holds a provider token, the app may. */
export const WEB_PROOFS: readonly StepUpProof[] = ["totp", "password", "email_code"];
export const APP_PROOFS: readonly StepUpProof[] = ["totp", "password", "apple", "google", "email_code"];

/**
 * The order proofs are offered in: the second factor (it is then the only
 * one), the password, a provider sheet (one tap, and the only proof that
 * reaches an Apple relay account whose mail may not arrive), then a mailed
 * code, which every account can take.
 */
const PREFERENCE: readonly StepUpProof[] = ["totp", "password", "apple", "google", "email_code"];

export interface ProofChoice {
  /** What the proof dialog opens on; null when this client can present none of them. */
  first: StepUpProof | null;
  /** "Dùng cách khác": the rest, in order. Empty with a second factor on. */
  others: StepUpProof[];
}

/**
 * Which proof to ask for first, and the alternatives. `proofs` is the
 * server's list (SignInMethodsSDO.proofs, or proof_required's fields.proofs);
 * when it is empty — a drifted answer, or no answer yet — the account's own
 * state decides: the second factor alone when it is on, else the password
 * when there is one, then a mailed code. With the second factor on nothing
 * else is ever offered (ADR 0047 §5).
 */
export function proofChoice(input: {
  proofs: readonly unknown[];
  mfaEnabled: boolean;
  hasPassword: boolean;
  supported: readonly StepUpProof[];
}): ProofChoice {
  let proofs = knownProofs(input.proofs);
  if (proofs.length === 0) {
    proofs = input.mfaEnabled ? ["totp"] : input.hasPassword ? ["password", "email_code"] : ["email_code"];
  }
  if (input.mfaEnabled || proofs.includes("totp")) {
    return { first: input.supported.includes("totp") ? "totp" : null, others: [] };
  }
  const ordered = PREFERENCE.filter((proof) => proofs.includes(proof) && input.supported.includes(proof));
  return { first: ordered[0] ?? null, others: ordered.slice(1) };
}
