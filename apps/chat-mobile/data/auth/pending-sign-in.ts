// The step a sign-in waits on between two screens (spec §5.1): the second factor's challenge after a password or a
// provider matched an account that has one, or the choice screen's ticket after a provider matched none. In memory
// only — never persisted, never a route param, never in an event or a log — and gone on sign-out
// (sign-in.ts › forgetSignIn). Screens read what they may show through usePendingSignIn; the challenge token, the
// ticket and its nonce stay in this module, for the doors in sign-in.ts alone. A choice the app is killed in the
// middle of is told on the next open (`interrupted`, from interrupted-sign-in.ts: the provider and nothing else).
import type { NativeTicket } from "@uniwork/core/api/endpoints/sign-in-native-api";
import type { SignInIdentity, SignInProvider, SignInTicketKind } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { create } from "zustand";
import { bestEffort } from "../report";
import { clearChoiceMark, markChoiceOpen, takeInterruptedChoice } from "./interrupted-sign-in";
import type { PendingStep, SecondFactorContext } from "./sign-in-step";

/** The challenge's life on the server (NativeSignInSDO.mfa_token: five minutes). */
export const SECOND_FACTOR_TTL_MS = 5 * 60_000;
/** The ticket's life on the server (spec §3.2: fifteen minutes). */
export const CHOICE_TTL_MS = 15 * 60_000;

/** The choice screen's half: whose identity, and whether the address already has an account. */
interface PendingChoiceView {
  identity: SignInIdentity;
  ticketKind: SignInTicketKind;
  /** local clock; past it the ticket is dropped and the screen says the sign-in expired */
  expiresAtMs: number;
}

/** The second step's half: whose sign-in, and the provider it may link. */
interface PendingSecondFactorView {
  context: SecondFactorContext;
  expiresAtMs: number;
}

interface PendingSignInState {
  choice: PendingChoiceView | null;
  secondFactor: PendingSecondFactorView | null;
  /** the provider whose choice screen the last run of the app was closed on, until the sign-in screen has said so */
  interrupted: SignInProvider | null;
}

export const usePendingSignIn = create<PendingSignInState>(() => ({ choice: null, secondFactor: null, interrupted: null }));

let ticket: NativeTicket | null = null;
let challenge: string | null = null;

/** Hold a step the sign-in needs next; a newer step of the same kind replaces the older one. */
export function holdStep(step: PendingStep, now: number): void {
  if (step.kind === "mfa") {
    challenge = step.token;
    usePendingSignIn.setState({ secondFactor: { context: step.context, expiresAtMs: now + SECOND_FACTOR_TTL_MS } });
    return;
  }
  ticket = { ticket: step.ticket, nonce: step.nonce };
  usePendingSignIn.setState({
    choice: { identity: step.identity, ticketKind: step.ticketKind, expiresAtMs: now + CHOICE_TTL_MS },
    interrupted: null,
  });
  markChoiceOpen(step.identity.provider, now).catch(bestEffort("auth", "choice mark not written", "breadcrumb"));
}

/**
 * The choice screen's ticket and the nonce that opens it; null once it is gone or expired. An expired one is dropped
 * here, while the screen's half stays for it to say so.
 */
export function pendingTicket(now: number): NativeTicket | null {
  const view = usePendingSignIn.getState().choice;
  if (!ticket || !view || now >= view.expiresAtMs) {
    ticket = null;
    return null;
  }
  return ticket;
}

/** The second step's challenge and its context; null once it is gone or expired (dropped as pendingTicket does). */
export function pendingChallenge(now: number): { token: string; context: SecondFactorContext } | null {
  const view = usePendingSignIn.getState().secondFactor;
  if (!challenge || !view || now >= view.expiresAtMs) {
    challenge = null;
    return null;
  }
  return { token: challenge, context: view.context };
}

/** The ticket was spent, linked or declined. */
export function clearChoice(): void {
  ticket = null;
  usePendingSignIn.setState({ choice: null });
  forgetChoiceMark();
}

/** Someone is signed in: a choice still held only waits to be linked, and nothing is left to tell after a kill. */
export function forgetChoiceMark(): void {
  clearChoiceMark().catch(bestEffort("auth", "choice mark not removed", "breadcrumb"));
}

/** Boot: whether the last run was closed on the choice screen (the sign-in screen says so once). */
export async function restoreInterruptedSignIn(now: number): Promise<void> {
  const provider = await takeInterruptedChoice(now);
  if (provider && !usePendingSignIn.getState().choice) usePendingSignIn.setState({ interrupted: provider });
}

/** The sign-in screen said it, or the person started again. */
export function dismissInterrupted(): void {
  usePendingSignIn.setState({ interrupted: null });
}

/** The second step passed, or the person went back to sign in another way. */
export function clearSecondFactor(): void {
  challenge = null;
  usePendingSignIn.setState({ secondFactor: null });
}

/** Everything a sign-in left waiting. */
export function forgetPendingSignIn(): void {
  clearChoice();
  clearSecondFactor();
}
