import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  return (
    <>
      <h2 id="summary-heading">Tóm tắt</h2>
      <h2 id="action-items-heading">Việc cần làm</h2>
    </>
  );
}

describe("useMeetingSectionDeepLink", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("moves focus to the heading it scrolled to, without putting it in the tab order", () => {
    const nav = adapter("section=summary");
    const { getByText } = render(wrapWithNav(<Probe ready />, nav));
    const heading = getByText("Tóm tắt");
    expect(document.activeElement).toBe(heading);
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("scrolls smoothly, or at once for a reader who asked for less motion", () => {
    render(wrapWithNav(<Probe ready />, adapter("section=summary")));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });

    window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduce") }) as MediaQueryList);
    render(wrapWithNav(<Probe ready />, adapter("section=action-items")));
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: "start", behavior: "auto" });
  });

  it("scrolls to the summary once the page is ready, then drops the param", () => {
    const nav = adapter("section=summary");
    const { rerender } = render(wrapWithNav(<Probe ready={false} />, nav));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    rerender(wrapWithNav(<Probe ready />, nav));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/meetings/m1");
  });

  it("scrolls to the action items, the section a batch of assigned tasks opens", () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this.id);
    });
    const nav = adapter("section=action-items");
    render(wrapWithNav(<Probe ready />, nav));
    expect(scrolled).toEqual(["action-items-heading"]);
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/meetings/m1");
  });

  it("does nothing without the param", () => {
    const nav = adapter("");
    render(wrapWithNav(<Probe ready />, nav));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
