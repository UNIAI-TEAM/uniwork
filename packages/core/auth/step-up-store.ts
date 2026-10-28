"use client";

import { create } from "zustand";
import { errorCode } from "../api/http";
import type { StepUpAction, StepUpGrant } from "../api/endpoints/sign-in-schemas";
import type { SwitchResolution } from "../types/workspace";
import { holdStepUp, stepUpTokenFor, type HeldStepUp } from "./step-up";
import { useAuthStore } from "./store";

/**
 * The web's step-up token (ADR 0047 §5): memory only — never persisted,
 * never a StorageAdapter, gone with the tab — so the next sensitive command
 * inside the ten minutes does not ask again, and nothing outlives the page.
 * The rules are step-up.ts's (the phone holds its own token on the same
 * ones). Cleared when the account or the session changes; a command the
 * server refused with proof_required clears it too (the token died with its
 * session, or a mailed code bought it for another action).
 */

interface StepUpState {
  held: HeldStepUp | null;
}

const useStepUpStore = create<StepUpState>(() => ({ held: null }));

function signedInUserId(): string | null {
  const { user, status } = useAuthStore.getState();
  return status === "authed" && user ? user.id : null;
}

/** Keep the token a step-up for `action` just bought; nothing when no one is signed in. */
export function rememberStepUp(grant: StepUpGrant, action: StepUpAction, now: number = Date.now()): void {
  const userId = signedInUserId();
  useStepUpStore.setState({ held: userId ? holdStepUp(grant, { userId, action, now }) : null });
}

/** The token `action`'s command may send, or null: open the proof dialog first. */
export function stepUpToken(action: StepUpAction, now: number = Date.now()): string | null {
  return stepUpTokenFor(useStepUpStore.getState().held, { action, userId: signedInUserId(), now });
}

/** Whether `action` can run without asking for a proof (the token is read again when the command runs). */
export function hasStepUp(action: StepUpAction, now: number = Date.now()): boolean {
  return stepUpToken(action, now) !== null;
}

export function forgetStepUp(): void {
  if (useStepUpStore.getState().held !== null) useStepUpStore.setState({ held: null });
}

/** A command's onError: proof_required means the held token no longer serves it. */
export function forgetStepUpIfRefused(err: unknown): void {
  if (errorCode(err) === "proof_required") forgetStepUp();
}

/** The invitation switch's transfers, each proved with the held token when there is one and it carries none. */
export function withTransferProof(resolve: SwitchResolution[] | undefined): SwitchResolution[] | undefined {
  const token = resolve?.some((r) => r.action === "transfer") ? stepUpToken("transfer_ownership") : null;
  if (!resolve || !token) return resolve;
  return resolve.map((r) => (r.action === "transfer" && !r.step_up_token ? { ...r, step_up_token: token } : r));
}

// A token is bound to the session that bought it: another account, a
// sign-out or a dropped session takes it away.
useAuthStore.subscribe((state, prev) => {
  if (state.status !== "authed" || state.user?.id !== prev.user?.id) forgetStepUp();
});
