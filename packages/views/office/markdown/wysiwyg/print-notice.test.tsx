// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PrintNotice, usePrintNotice } from "./print-notice";

initI18n();

beforeEach(async () => {
  await setLocale("en");
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe("usePrintNotice", () => {
  it("keeps quiet for printed and cancelled", () => {
    const { result } = renderHook(() => usePrintNotice());
    act(() => result.current.onOutcome({ outcome: "printed" }));
    expect(result.current.notice).toBeNull();
    act(() => result.current.onOutcome({ outcome: "cancelled" }));
    expect(result.current.notice).toBeNull();
  });

  it.each(["print_busy", "print_timeout"])("shows the neutral busy notice for %s", (reason) => {
    const { result } = renderHook(() => usePrintNotice());
    act(() => result.current.onOutcome({ outcome: "failed", reason }));
    expect(result.current.notice).toBe("busy");
  });

  it("shows the generic failure for any other reason, and clears on the next print and after a while", () => {
    const { result } = renderHook(() => usePrintNotice());
    act(() => result.current.onOutcome({ outcome: "failed", reason: "print_blocked" }));
    expect(result.current.notice).toBe("failed");
    act(() => result.current.onStart());
    expect(result.current.notice).toBeNull();
    act(() => result.current.onOutcome({ outcome: "failed", reason: "no_dom" }));
    act(() => { vi.advanceTimersByTime(7000); });
    expect(result.current.notice).toBeNull();
  });
});

describe("PrintNotice", () => {
  it("renders a polite status region that is empty without a notice", () => {
    const { rerender } = render(<PrintNotice notice={null} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    rerender(<PrintNotice notice="busy" />);
    expect(screen.getByRole("status")).toHaveTextContent("A print dialog is already open. Finish or close it first.");
    rerender(<PrintNotice notice="failed" />);
    expect(screen.getByRole("status")).toHaveTextContent("Could not print the document. Try again.");
  });
});
