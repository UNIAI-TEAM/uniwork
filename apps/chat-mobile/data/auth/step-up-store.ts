// "Xác nhận là bạn" on the phone (ADR 0047 §5, spec §3.7): the ten-minute step-up token a proof bought, held in memory
// only, for one account's commands on this device session; core's auth/step-up.ts holds the rules (which actions a
// token serves, its local deadline, which proof to ask first). Never persisted: gone on sign-out and with the session
// (sign-in.ts › forgetSignIn), and it never serves another account (each read names the account in).
import type { StepUpAction, StepUpGrant } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { holdStepUp as heldFrom, proofChoice, stepUpTokenFor, type HeldStepUp, type ProofChoice } from "@uniwork/core/auth/step-up";
import { appProofs, type SignInOffer } from "@/lib/sign-in-offer";

let held: HeldStepUp | null = null;

/** Keep the token a step-up just bought for `action`'s command (and, unless a mailed code bought it, every other). */
export function holdStepUp(grant: StepUpGrant, ctx: { userId: string; action: StepUpAction; now?: number }): void {
  held = heldFrom(grant, { userId: ctx.userId, action: ctx.action, now: ctx.now ?? Date.now() });
}

/** The token to send with `action`'s command for `userId`, or null: ask for a proof first. */
export function stepUpToken(action: StepUpAction, userId: string | null, now: number = Date.now()): string | null {
  return stepUpTokenFor(held, { action, userId, now });
}

/** The token is gone: signed out, the session ended, or the server refused it (proof_required). */
export function forgetStepUp(): void {
  held = null;
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
