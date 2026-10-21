import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchStore } from "./store";

describe("useSearchStore", () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false, focusTarget: null });
  });

  it("starts closed", () => {
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("setOpen and toggle", () => {
    useSearchStore.getState().setOpen(true);
    expect(useSearchStore.getState().open).toBe(true);
    useSearchStore.getState().toggle();
    expect(useSearchStore.getState().open).toBe(false);
  });

  describe("focus target", () => {
    it("has none by default, so nothing claims the chord", () => {
      expect(useSearchStore.getState().focusLocalSearch()).toBe(false);
    });

    it("runs the registered target and reports whether it took the chord", () => {
      const target = vi.fn(() => true);
      useSearchStore.getState().registerFocusTarget(target);
      expect(useSearchStore.getState().focusLocalSearch()).toBe(true);
      expect(target).toHaveBeenCalledTimes(1);
      target.mockReturnValue(false);
      expect(useSearchStore.getState().focusLocalSearch()).toBe(false);
    });

    it("unregisters only its own target", () => {
      const first = vi.fn(() => true);
      const second = vi.fn(() => true);
      const unregisterFirst = useSearchStore.getState().registerFocusTarget(first);
      useSearchStore.getState().registerFocusTarget(second);
      unregisterFirst();
      expect(useSearchStore.getState().focusLocalSearch()).toBe(true);
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });
  });
});
