// "Xác nhận là bạn" on the phone (ADR 0047 §5, spec §3.7): the ten-minute step-up token a proof bought, held in memory
// only, for one account's commands on this device session; core's auth/step-up.ts holds the rules (which actions a
// token serves, its local deadline, which proof to ask first). Never persisted: gone on sign-out and with the session
// (sign-in.ts › forgetSignIn), and it never serves another account (each read names the account in). A mailed code's
// token serves its own action only, so one is kept per action: an owner who confirms by mail holds the hand-over's
// and the erasure's together, and both are bought before the organization moves (delete-account.tsx).
import type { StepUpAction, StepUpGrant } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { readSignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { holdStepUp as heldFrom, proofChoice, stepUpTokenFor, type HeldStepUp, type ProofChoice } from "@uniwork/core/auth/step-up";
import { appProofs, type SignInOffer } from "@/lib/sign-in-offer";

/** The tokens held: one that serves every command, or one per action a mailed code was for. */
let held: HeldStepUp[] = [];

/** Keep the token a step-up just bought for `action`'s command (and, unless a mailed code bought it, every other). */
export function holdStepUp(grant: StepUpGrant, ctx: { userId: string; action: StepUpAction; now?: number }): void {
  const now = ctx.now ?? Date.now();
  const next = heldFrom(grant, { userId: ctx.userId, action: ctx.action, now });
  // A token for every command makes the narrow ones moot; a narrow one replaces only its own action's, and nothing of
  // another account or past its deadline is kept beside it.
  const kept = next.action === null ? [] : held.filter((h) => h.userId === next.userId && h.expiresAtMs > now && h.action !== next.action);
  held = [...kept, next];
}

/** The token to send with `action`'s command for `userId`, or null: ask for a proof first. */
export function stepUpToken(action: StepUpAction, userId: string | null, now: number = Date.now()): string | null {
  for (const one of held) {
    const token = stepUpTokenFor(one, { action, userId, now });
    if (token) return token;
  }
  return null;
}

/** The tokens are gone: signed out, the session ended, or the server refused one (proof_required). */
export function forgetStepUp(): void {
  held = [];
}

/**
 * Runs a command that rides the held token. When the server refuses the proof (403 proof_required: the token ran
 * out, or the session that bought it ended) the token is forgotten before the refusal goes on, so the next ask buys
 * a fresh one instead of sending the dead one again.
 */
export async function withHeldStepUp<T>(command: () => Promise<T>): Promise<T> {
  try {
    return await command();
  } catch (error: unknown) {
    if (readSignInFailure(error, "methods").kind === "step_up") forgetStepUp();
    throw error;
  }
}

/**
 * Which proof the sheet opens on and the others it offers, from the server's freshest list (proof_required's
 * `proofs`, else SignInMethods.proofs) and what this phone can present (lib/sign-in-offer.ts › appProofs).
 */
export function proofsFor(input: {
  proofs: readonly unknown[];
  mfaEnabled: boolean;
  hasPassword: boolean;
  offer: SignInOffer | undefined;
}): ProofChoice {
  return proofChoice({ proofs: input.proofs, mfaEnabled: input.mfaEnabled, hasPassword: input.hasPassword, supported: appProofs(input.offer) });
}
