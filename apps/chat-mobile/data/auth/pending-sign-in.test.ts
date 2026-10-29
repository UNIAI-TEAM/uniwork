import { beforeEach, describe, expect, it } from "vitest";
import { installDeviceStore, memoryDeviceStore, type DeviceStore } from "../storage/device-store";
import {
  CHOICE_TTL_MS,
  SECOND_FACTOR_TTL_MS,
  clearChoice,
  clearSecondFactor,
  dismissInterrupted,
  forgetChoiceMark,
  forgetPendingSignIn,
  holdStep,
  pendingChallenge,
  pendingTicket,
  restoreInterruptedSignIn,
  retryOnSignIn,
  usePendingSignIn,
} from "./pending-sign-in";
import type { PendingStep } from "./sign-in-step";

const NOW = Date.parse("2026-10-28T09:00:00Z");
const identity = { provider: "google" as const, email: "an@gmail.com", name: "An", private_relay: false };
const choice: PendingStep = { kind: "choice", ticket: "t_1", nonce: "n_1", identity, ticketKind: "unmatched" };
const context = { method: "password" as const, email: "an@example.com", provider: null };
const mfa: PendingStep = { kind: "mfa", token: "mfa_1", context };

let store: DeviceStore;
const MARK = "sign-in/choice-open";
/** The mark is written and removed after the device store opens: a few microtasks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  store = memoryDeviceStore();
  installDeviceStore(async () => store);
  forgetPendingSignIn();
  dismissInterrupted();
  await settle();
});

describe("the step a sign-in waits on", () => {
  it("shows screens the identity and the context, never the ticket, its nonce or the challenge", () => {
    holdStep(choice, NOW);
    holdStep(mfa, NOW);
    const state = usePendingSignIn.getState();
    expect(state).toEqual({
      choice: { identity, ticketKind: "unmatched", expiresAtMs: NOW + CHOICE_TTL_MS },
      secondFactor: { context, expiresAtMs: NOW + SECOND_FACTOR_TTL_MS },
      interrupted: null,
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
    expect(usePendingSignIn.getState()).toEqual({ choice: null, secondFactor: null, interrupted: null });
    expect(pendingChallenge(NOW)).toBeNull();
  });

  it("has nothing to give before any step was held", () => {
    expect(pendingTicket(NOW)).toBeNull();
    expect(pendingChallenge(NOW)).toBeNull();
  });
});

describe("a choice the app is closed on", () => {
  it("leaves the provider on the device while the choice is held, and nothing once it is cleared", async () => {
    holdStep(choice, NOW);
    await settle();
    expect(store.getString(MARK)).toBe(JSON.stringify({ provider: "google", at: NOW }));
    expect(store.getString(MARK)).not.toMatch(/t_1|n_1|an@gmail/);
    clearChoice();
    await settle();
    expect(store.getString(MARK)).toBeUndefined();
  });

  it("forgets the mark once signed in, keeping the choice for its link", async () => {
    holdStep(choice, NOW);
    await settle();
    forgetChoiceMark();
    await settle();
    expect(store.getString(MARK)).toBeUndefined();
    expect(pendingTicket(NOW)).not.toBeNull();
  });

  it("tells the next open which provider it was, until said or a new choice is held", async () => {
    store.set(MARK, JSON.stringify({ provider: "apple", at: NOW }));
    await restoreInterruptedSignIn(NOW + 60_000);
    expect(usePendingSignIn.getState().interrupted).toBe("apple");
    holdStep(choice, NOW + 60_000);
    expect(usePendingSignIn.getState().interrupted).toBeNull();
    store.set(MARK, JSON.stringify({ provider: "apple", at: NOW }));
    clearChoice();
    await restoreInterruptedSignIn(NOW);
    expect(usePendingSignIn.getState().interrupted).toBeNull();
    dismissInterrupted();
    expect(usePendingSignIn.getState().interrupted).toBeNull();
  });

  it("offers a choice that ran out on screen again, as after a closed app", () => {
    holdStep(choice, NOW);
    clearChoice();
    retryOnSignIn("google");
    expect(usePendingSignIn.getState()).toMatchObject({ choice: null, interrupted: "google" });
    holdStep(choice, NOW);
    expect(usePendingSignIn.getState().interrupted).toBeNull();
  });

  it("says nothing over a choice already held again", async () => {
    store.set(MARK, JSON.stringify({ provider: "apple", at: NOW }));
    holdStep(choice, NOW);
    store.set(MARK, JSON.stringify({ provider: "apple", at: NOW }));
    await restoreInterruptedSignIn(NOW);
    expect(usePendingSignIn.getState().interrupted).toBeNull();
  });
});
