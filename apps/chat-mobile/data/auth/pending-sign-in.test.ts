import { beforeEach, describe, expect, it } from "vitest";
import {
  CHOICE_TTL_MS,
  SECOND_FACTOR_TTL_MS,
  clearChoice,
  clearSecondFactor,
  forgetPendingSignIn,
  holdStep,
  pendingChallenge,
  pendingTicket,
  usePendingSignIn,
} from "./pending-sign-in";
import type { PendingStep } from "./sign-in-step";

const NOW = Date.parse("2026-10-28T09:00:00Z");
const identity = { provider: "google" as const, email: "an@gmail.com", name: "An", private_relay: false };
const choice: PendingStep = { kind: "choice", ticket: "t_1", nonce: "n_1", identity, ticketKind: "unmatched" };
const context = { method: "password" as const, email: "an@example.com", provider: null };
const mfa: PendingStep = { kind: "mfa", token: "mfa_1", context };

beforeEach(() => forgetPendingSignIn());

describe("the step a sign-in waits on", () => {
  it("shows screens the identity and the context, never the ticket, its nonce or the challenge", () => {
    holdStep(choice, NOW);
    holdStep(mfa, NOW);
    const state = usePendingSignIn.getState();
    expect(state).toEqual({
      choice: { identity, ticketKind: "unmatched", expiresAtMs: NOW + CHOICE_TTL_MS },
      secondFactor: { context, expiresAtMs: NOW + SECOND_FACTOR_TTL_MS },
    });
    expect(JSON.stringify(state)).not.toMatch(/t_1|n_1|mfa_1/);
    expect(pendingTicket(NOW)).toEqual({ ticket: "t_1", nonce: "n_1" });
    expect(pendingChallenge(NOW)).toEqual({ token: "mfa_1", context });
  });

  it("drops an expired secret and keeps the screen's half, so the screen can say it expired", () => {
    holdStep(choice, NOW);
    holdStep(mfa, NOW);
    expect(pendingChallenge(NOW + SECOND_FACTOR_TTL_MS)).toBeNull();
    expect(pendingTicket(NOW + CHOICE_TTL_MS)).toBeNull();
    // gone for good: the clock going back does not bring it back
    expect(pendingTicket(NOW)).toBeNull();
    expect(pendingChallenge(NOW)).toBeNull();
    expect(usePendingSignIn.getState().choice?.expiresAtMs).toBe(NOW + CHOICE_TTL_MS);
    expect(usePendingSignIn.getState().secondFactor?.context).toEqual(context);
  });

  it("replaces an older step of the same kind with the newer one", () => {
    holdStep(choice, NOW);
    holdStep({ ...choice, ticket: "t_2", nonce: "n_2", ticketKind: "link_required" }, NOW + 1_000);
    expect(pendingTicket(NOW + 1_000)).toEqual({ ticket: "t_2", nonce: "n_2" });
    expect(usePendingSignIn.getState().choice?.ticketKind).toBe("link_required");
  });

  it("clears one step without the other, or both", () => {
    holdStep(choice, NOW);
    holdStep(mfa, NOW);
    clearSecondFactor();
    expect(pendingChallenge(NOW)).toBeNull();
    expect(pendingTicket(NOW)).not.toBeNull();
    holdStep(mfa, NOW);
    clearChoice();
    expect(pendingTicket(NOW)).toBeNull();
    expect(pendingChallenge(NOW)).not.toBeNull();
    forgetPendingSignIn();
    expect(usePendingSignIn.getState()).toEqual({ choice: null, secondFactor: null });
    expect(pendingChallenge(NOW)).toBeNull();
  });

  it("has nothing to give before any step was held", () => {
    expect(pendingTicket(NOW)).toBeNull();
    expect(pendingChallenge(NOW)).toBeNull();
  });
});
