import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./use-auto-save";

describe("useAutoSave", () => {
  it("debounces saves and reports saved status", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) =>
        useAutoSave({
          value,
          savedValue: "saved",
          onSave,
          onSuccess,
          isEqual: (left, right) => left === right,
          delay: 100,
        }),
      { initialProps: { value: "saved" } },
    );

    rerender({ value: "draft" });
    // Debouncing is not saving: the status only says "saving" once a request runs.
    expect(result.current.status).toBe("idle");

    await waitFor(
      () => {
        expect(onSave).toHaveBeenCalledWith("draft");
        expect(result.current.status).toBe("saved");
      },
      { timeout: 2_000 },
    );
    expect(onSuccess).toHaveBeenCalledWith("draft");
  });

  it("flush saves immediately", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }) =>
        useAutoSave({
          value,
          savedValue: "",
          onSave,
          isEqual: (left, right) => left === right,
        }),
      { initialProps: { value: "" } },
    );

    rerender({ value: "now" });
    act(() => {
      result.current.flush();
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("now");
    });
  });
});
