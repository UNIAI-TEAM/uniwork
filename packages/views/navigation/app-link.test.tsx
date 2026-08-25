import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppLink } from "./app-link";
import { NavigationProvider } from "./context";
import type { NavigationAdapter } from "./types";

function adapter() {
  const push = vi.fn<(path: string) => void>();
  const prefetch = vi.fn<(path: string) => void>();
  const value: NavigationAdapter = {
    push,
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => "http://app.test" + p,
    prefetch,
  };
  return Object.assign(value, { push, prefetch });
}

describe("AppLink", () => {
  it("sends a plain click through the adapter as an in-place push", () => {
    const nav = adapter();
    render(
      <NavigationProvider value={nav}>
        <AppLink href="/acme/team/tasks">Tasks</AppLink>
      </NavigationProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }));
    expect(nav.push).toHaveBeenCalledWith("/acme/team/tasks");
  });

  it("leaves cmd/ctrl-click, shift-click and target=_blank to the browser", () => {
    const nav = adapter();
    render(
      <NavigationProvider value={nav}>
        <AppLink href="/a">A</AppLink>
        <AppLink href="/b" target="_blank">
          B
        </AppLink>
      </NavigationProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "A" }), { metaKey: true });
    fireEvent.click(screen.getByRole("link", { name: "A" }), { shiftKey: true });
    fireEvent.click(screen.getByRole("link", { name: "B" }));
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "B" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("lets the caller's onClick cancel the navigation", () => {
    const nav = adapter();
    render(
      <NavigationProvider value={nav}>
        <AppLink href="/a" onClick={(e) => e.preventDefault()}>
          A
        </AppLink>
      </NavigationProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "A" }));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("prefetches on hover and focus", () => {
    const nav = adapter();
    render(
      <NavigationProvider value={nav}>
        <AppLink href="/a">A</AppLink>
      </NavigationProvider>,
    );
    fireEvent.mouseEnter(screen.getByRole("link", { name: "A" }));
    fireEvent.focus(screen.getByRole("link", { name: "A" }));
    expect(nav.prefetch).toHaveBeenCalledTimes(2);
  });
});
