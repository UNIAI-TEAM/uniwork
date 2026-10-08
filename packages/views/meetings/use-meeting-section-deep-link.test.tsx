import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationAdapter } from "../navigation";
import { wrapWithNav } from "../test/api-mock";
import { useMeetingSectionDeepLink } from "./use-meeting-section-deep-link";

function adapter(search: string): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/team/meetings/m1",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

function Probe({ ready }: { ready: boolean }) {
  useMeetingSectionDeepLink({ ready });
  return <h2 id="summary-heading">Tóm tắt</h2>;
}

describe("useMeetingSectionDeepLink", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("scrolls to the summary once the page is ready, then drops the param", () => {
    const nav = adapter("section=summary");
    const { rerender } = render(wrapWithNav(<Probe ready={false} />, nav));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    rerender(wrapWithNav(<Probe ready />, nav));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/meetings/m1");
  });

  it("does nothing without the param", () => {
    const nav = adapter("");
    render(wrapWithNav(<Probe ready />, nav));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
