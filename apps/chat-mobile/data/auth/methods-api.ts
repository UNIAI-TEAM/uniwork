// Settings › Sign-in methods and "Xác nhận là bạn" (ADR 0047 §5-6, spec §3.7) over the app's bearer client: core's
// createSignInMethodsApi, so the phone sends each proof and reads each answer exactly as the web does. A refusal is
// the bearer ApiError (data/api.ts), whose envelope core's readSignInFailure reads as it is (its code and the
// fields proofs, masked_email, retry_after). Screens reach these through data/mutations/* hooks only.
import type { SignInMethodsChange, SignInProvider, StepUpAction } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { createSignInMethodsApi, type StepUpProofInput } from "@uniwork/core/api/endpoints/sign-in-methods-api";
import { linkAction } from "@uniwork/core/auth/step-up";
import { api } from "../api";
import { toChatRequest } from "../chat-api";
import { nativeClient } from "./flow";
import { clearChoice, pendingTicket, usePendingSignIn } from "./pending-sign-in";
import { providerToken } from "./sign-in";
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
 * "Xác nhận bằng Apple/Google": a fresh token of the linked account from its provider's own sheet, as the proof. The
 * sheet asks which account (never the one it remembers): the proof must be the account linked here, and a wrong one
 * remembered would be offered again after every refusal. `dismissed` when the sheet was closed.
 */
export async function stepUpWithProvider(provider: SignInProvider, action: StepUpAction, userId: string): Promise<"held" | "unusable" | "dismissed"> {
  const proof = await providerToken(provider, { chooseAccount: true });
  if (!proof) return "dismissed";
  return (await stepUp({ kind: "provider", provider, token: proof.token, nonce: proof.nonce }, action, userId)) ? "held" : "unusable";
}

/**
 * Settings › Liên kết on the phone (spec §5.2): the provider's own sheet (Google asks which account; the iPhone's Apple
 * sheet), then its token into this account behind the step-up already bought. `move` confirms moving the identity
 * out of the empty account holding it (after sign_in_method_movable) and opens the sheet again for a fresh token, so
 * Apple's consent it carries is the one the account keeps. Null when the sheet was closed.
 */
export async function linkProvider(input: { provider: SignInProvider; stepUpToken: string; move?: boolean }): Promise<SignInMethodsChange | null> {
  const { provider, stepUpToken, move } = input;
  const proof = await providerToken(provider, { chooseAccount: !move });
  if (!proof) return null;
  return provider === "google"
    ? signInMethodsApi.linkNative({ provider, stepUpToken, idToken: proof.token, nonce: proof.nonce, move })
    : signInMethodsApi.linkNative({
        provider,
        stepUpToken,
        identityToken: proof.token,
        nonce: proof.nonce,
        authorizationCode: proof.authorizationCode,
        move,
      });
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
