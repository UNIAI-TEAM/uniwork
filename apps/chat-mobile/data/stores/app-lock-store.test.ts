import { describe, expect, it, vi } from "vitest";

// The hook is zustand's useStore over the vanilla store; outside React it reads the selector once.
vi.mock("zustand", () => ({ useStore: (store: { getState: () => unknown }, select: (state: unknown) => unknown) => select(store.getState()) }));

import { appLockState, ownerPromptOpen, setAppLockEngaged, useAppLockEngaged, whileOwnerPrompt } from "./app-lock-store";

describe("app-lock-store", () => {
  it("engages and releases the lock, writing only on a change", () => {
    const listener = vi.fn();
    const unsubscribe = appLockState.subscribe(listener);
    setAppLockEngaged(true);
    setAppLockEngaged(true);
    expect(useAppLockEngaged()).toBe(true);
    setAppLockEngaged(false);
    expect(useAppLockEngaged()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("counts an owner prompt as open while it runs, even when it fails", async () => {
    let during = false;
    await expect(
      whileOwnerPrompt(async () => {
        during = ownerPromptOpen();
        return "proven";
      }),
    ).resolves.toBe("proven");
    expect(during).toBe(true);
    expect(ownerPromptOpen()).toBe(false);
    await expect(whileOwnerPrompt(() => Promise.reject(new Error("cancelled")))).rejects.toThrow("cancelled");
    expect(ownerPromptOpen()).toBe(false);
  });
});
