import { beforeEach, describe, expect, it } from "vitest";
import { useSearchStore } from "./store";

describe("useSearchStore", () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false });
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
});
