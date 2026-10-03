import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDocxFind, isDocxFindOpen, openDocxFind, subscribeDocxFind, toggleDocxFind } from "./find-store";

afterEach(() => {
  closeDocxFind();
});

describe("find store", () => {
  it("tracks the open state and notifies only on transitions", () => {
    expect(isDocxFindOpen()).toBe(false);
    const listener = vi.fn();
    const unsubscribe = subscribeDocxFind(listener);

    openDocxFind();
    expect(isDocxFindOpen()).toBe(true);
    openDocxFind();
    expect(listener).toHaveBeenCalledTimes(1);

    toggleDocxFind();
    expect(isDocxFindOpen()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    toggleDocxFind();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
