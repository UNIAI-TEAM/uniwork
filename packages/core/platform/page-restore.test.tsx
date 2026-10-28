import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePageRestore } from "./page-restore";

const pageshow = (persisted: boolean) => {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
};

describe("usePageRestore", () => {
  it("runs the latest callback only when the page comes back from the back/forward cache", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ cb }) => usePageRestore(cb), { initialProps: { cb: first } });
    pageshow(false);
    expect(first).not.toHaveBeenCalled();
    rerender({ cb: second });
    pageshow(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    pageshow(true);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
