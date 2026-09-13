import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LoadMoreFooter } from "./load-more-footer";

initI18n();

/**
 * An observer the test reports through by hand. The shared views setup
 * installs one that says "visible" the moment it observes
 * (test/media-stub.ts), which cannot show the once-per-transition contract.
 */
class ManualIntersectionObserver {
  static instances: ManualIntersectionObserver[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    ManualIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  report(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as never);
  }
}

function footer(props: Partial<ComponentProps<typeof LoadMoreFooter>> = {}) {
  return (
    <LoadMoreFooter
      hasMore
      isLoading={false}
      isError={false}
      total={120}
      onLoadMore={() => {}}
      {...props}
    />
  );
}

describe("modes/LoadMoreFooter", () => {
  beforeEach(() => {
    // The button is the tested path; keep the sentinel out of these cases.
    vi.stubGlobal("IntersectionObserver", undefined);
    ManualIntersectionObserver.instances = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers a real load-more button while pages remain", () => {
    const onLoadMore = vi.fn();
    render(footer({ onLoadMore }));

    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("keeps the button reachable but inert while the next page loads, and announces it", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(footer({ onLoadMore }));
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    rerender(footer({ onLoadMore, isLoading: true }));

    const button = screen.getByRole("button", { name: "Tải thêm" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onLoadMore).not.toHaveBeenCalled();
    // The same live region, mounted before the change, now carries the text.
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Đang tải thêm công việc…");
  });

  it("turns a failed page into a retry that asks for the page again", () => {
    const onLoadMore = vi.fn();
    render(footer({ onLoadMore, isError: true }));

    expect(screen.getByText("Không tải thêm được công việc.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải thêm" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("marks the end once a list that paginated is fully loaded", () => {
    render(footer({ hasMore: false, total: 120 }));

    expect(screen.getByText("Không còn công việc để tải")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for a list that never needed a second page", () => {
    const { container, rerender } = render(footer({ hasMore: false, total: 50 }));
    expect(container).toBeEmptyDOMElement();

    rerender(footer({ hasMore: false, total: 0 }));
    expect(container).toBeEmptyDOMElement();
  });

  it("auto-loads once per visibility change and reads the latest callback without rebuilding the observer", () => {
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(footer({ onLoadMore: first }));
    expect(ManualIntersectionObserver.instances).toHaveLength(1);
    const observer = ManualIntersectionObserver.instances[0]!;

    act(() => observer.report(true));
    expect(first).toHaveBeenCalledTimes(1);

    // A page load round-trip re-renders with new props while the sentinel
    // stays on screen: no new observer, so nothing fires again by itself.
    rerender(footer({ onLoadMore: second, isLoading: true }));
    rerender(footer({ onLoadMore: second }));
    expect(ManualIntersectionObserver.instances).toHaveLength(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    act(() => observer.report(false));
    expect(second).not.toHaveBeenCalled();
    act(() => observer.report(true));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("still works where IntersectionObserver does not exist", () => {
    expect(typeof IntersectionObserver).toBe("undefined");
    const onLoadMore = vi.fn();

    render(footer({ onLoadMore }));
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
