import { act, cleanup, render } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficePrintShortcutScope, useOfficePrintShortcut } from "./shortcut";

function Scope({ children, hidden = false }: { children: ReactNode; hidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div hidden={hidden}>
      <div ref={ref}>
        <OfficePrintShortcutScope rootRef={ref}>{children}</OfficePrintShortcutScope>
      </div>
    </div>
  );
}

function View({ run }: { run: (() => void) | null }) {
  useOfficePrintShortcut(run);
  return null;
}

function pressCtrlP(target: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function platformUserAgent(userAgent: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

beforeEach(() => platformUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Office print shortcut", () => {
  it("runs the registered print and prevents the native print, from focus outside the editor", () => {
    const run = vi.fn();
    render(<><button type="button">header</button><Scope><View run={run} /></Scope></>);
    const outside = document.querySelector("button")!;
    const event = pressCtrlP(outside);
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("accepts Ctrl+P with an upper-case key, ignores Shift/Alt chords, IME composition and Meta on Windows/Linux", () => {
    const run = vi.fn();
    render(<Scope><View run={run} /></Scope>);
    pressCtrlP(document.body, { key: "P" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(pressCtrlP(document.body, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(pressCtrlP(document.body, { altKey: true }).defaultPrevented).toBe(false);
    expect(pressCtrlP(document.body, { isComposing: true }).defaultPrevented).toBe(false);
    expect(pressCtrlP(document.body, { ctrlKey: false }).defaultPrevented).toBe(false);
    expect(pressCtrlP(document.body, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(false);
    expect(pressCtrlP(document.body, { metaKey: true }).defaultPrevented).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("takes Cmd+P on macOS and leaves Ctrl+P to the text field", () => {
    platformUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15");
    const run = vi.fn();
    render(<Scope><View run={run} /></Scope>);
    const cmd = pressCtrlP(document.body, { ctrlKey: false, metaKey: true });
    expect(cmd.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(pressCtrlP().defaultPrevented).toBe(false);
    expect(pressCtrlP(document.body, { metaKey: true }).defaultPrevented).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("blocks a held key's repeats without starting another run", () => {
    const run = vi.fn();
    render(<Scope><View run={run} /></Scope>);
    pressCtrlP();
    expect(pressCtrlP(document.body, { repeat: true }).defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves the platform default alone when no view can print", () => {
    render(<Scope><View run={null} /></Scope>);
    expect(pressCtrlP().defaultPrevented).toBe(false);
  });

  it("calls the latest run without re-registering", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Scope><View run={first} /></Scope>);
    rerender(<Scope><View run={second} /></Scope>);
    pressCtrlP();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("prints only the visible document when several are mounted", () => {
    const hiddenRun = vi.fn();
    const activeRun = vi.fn();
    render(<>
      <Scope hidden><View run={hiddenRun} /></Scope>
      <Scope><View run={activeRun} /></Scope>
    </>);
    expect(pressCtrlP().defaultPrevented).toBe(true);
    expect(activeRun).toHaveBeenCalledTimes(1);
    expect(hiddenRun).not.toHaveBeenCalled();
  });

  it("skips an inert (inactive desktop tab) document", () => {
    const run = vi.fn();
    const { container } = render(<Scope><View run={run} /></Scope>);
    container.firstElementChild!.setAttribute("inert", "");
    expect(pressCtrlP().defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("unregisters when the view stops printing and removes the listener on unmount", () => {
    const run = vi.fn();
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { rerender, unmount } = render(<Scope><View run={run} /></Scope>);
    rerender(<Scope><View run={null} /></Scope>);
    expect(pressCtrlP().defaultPrevented).toBe(false);
    rerender(<Scope><View run={run} /></Scope>);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(pressCtrlP().defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    removeSpy.mockRestore();
  });

  it("does nothing outside a shell scope", () => {
    const run = vi.fn();
    render(<View run={run} />);
    expect(pressCtrlP().defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
