// Settings › Sign-in methods and "Xác nhận là bạn" (ADR 0047 §5-6, spec §3.7) over the app's bearer client: core's
// createSignInMethodsApi, so the phone sends each proof and reads each answer exactly as the web does. A refusal is
// the bearer ApiError (data/api.ts), whose envelope core's readSignInFailure reads as it is (its code and the
// fields proofs, masked_email, retry_after). Screens reach these through data/mutations/* hooks only.
import type { SignInMethodsChange, StepUpAction } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { createSignInMethodsApi, type StepUpProofInput } from "@uniwork/core/api/endpoints/sign-in-methods-api";
import { linkAction } from "@uniwork/core/auth/step-up";
import { api } from "../api";
import { toChatRequest } from "../chat-api";
import { nativeClient } from "./flow";
import { clearChoice, pendingTicket, usePendingSignIn } from "./pending-sign-in";
import { holdStepUp, stepUpToken } from "./step-up-store";
import { TransportError } from "./transport";

export const signInMethodsApi = createSignInMethodsApi(toChatRequest((path, init) => api.request(path, init)));

/**
 * One proof for `action`, its token held for the account in (step-up-store.ts). False when the answer carried no token
 * the app can use: the screen says it did not work, and nothing is held.
 */
export async function stepUp(proof: StepUpProofInput, action: StepUpAction, userId: string): Promise<boolean> {
  const grant = await signInMethodsApi.stepUp(proof, action);
  if (!grant) return false;
  holdStepUp(grant, { userId, action });
  return true;
}

/**
 * "Tôi đã có tài khoản", once signed in to it: link the identity of the choice screen's ticket into this account, with
 * the step-up token held for that link when there is one (needed when this device session signed in before the
 * ticket was issued, and for `move`). The ticket is spent by an answer, kept by a refusal (the person may confirm a
 * proof or the move and try again); a ticket that is gone says sign_in_expired without asking the server.
 */
export async function linkPendingTicket(input: { userId: string; move?: boolean }): Promise<SignInMethodsChange> {
  const held = pendingTicket(Date.now());
  const provider = usePendingSignIn.getState().choice?.identity.provider;
  if (!held || !provider) throw new TransportError("sign_in_expired");
  const change = await signInMethodsApi.linkNativeTicket(nativeClient, {
    ...held,
    move: input.move,
    stepUpToken: stepUpToken(linkAction(provider), input.userId) ?? undefined,
  });
  clearChoice();
  return change;
}
