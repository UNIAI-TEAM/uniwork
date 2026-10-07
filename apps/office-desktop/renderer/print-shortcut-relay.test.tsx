// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficePrintShortcutScope, useOfficePrintShortcut } from "@uniwork/views/office/print/shortcut";
import { relayNativePrintShortcut } from "./print-shortcut-relay";

function Registers({ run }: { run: () => void }) {
  useOfficePrintShortcut(run);
  return null;
}

/** Stands in for one Office shell: a tab panel that is `hidden` when inactive. */
function Document({ run, hidden }: { run: () => void; hidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref} hidden={hidden}><OfficePrintShortcutScope rootRef={ref}><Registers run={run} /></OfficePrintShortcutScope></div>;
}

function bridgeWithEmit() {
  let listener: (() => void) | undefined;
  const off = vi.fn(() => { listener = undefined; });
  return { bridge: { onOfficePrintRequested: (next: () => void) => { listener = next; return off; } }, emit: () => listener?.(), off };
}

afterEach(() => vi.restoreAllMocks());

describe("relayNativePrintShortcut", () => {
  it("relays Cmd+P on macOS, so the shell's platform rule accepts it", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
    const run = vi.fn();
    const { bridge, emit } = bridgeWithEmit();
    render(<Document run={run} />);
    relayNativePrintShortcut(bridge);
    const seen = vi.fn();
    window.addEventListener("keydown", (event) => seen({ meta: event.metaKey, ctrl: event.ctrlKey }), { once: true });
    emit();
    expect(seen).toHaveBeenCalledWith({ meta: true, ctrl: false });
    expect(run).toHaveBeenCalledOnce();
  });

  it("runs the open document's print when main reports the chord (a key pressed inside a preview frame)", () => {
    const run = vi.fn();
    const { bridge, emit } = bridgeWithEmit();
    render(<Document run={run} />);
    relayNativePrintShortcut(bridge);
    emit();
    expect(run).toHaveBeenCalledOnce();
  });

  it("does nothing when no document registered a print, or the document is a hidden tab", () => {
    const { bridge, emit } = bridgeWithEmit();
    relayNativePrintShortcut(bridge);
    const seen = vi.fn();
    window.addEventListener("keydown", (event) => seen(event.defaultPrevented), { once: true });
    emit();
    expect(seen).toHaveBeenCalledWith(false);
    const run = vi.fn();
    render(<Document run={run} hidden />);
    emit();
    expect(run).not.toHaveBeenCalled();
  });

  it("unsubscribes, and tolerates a bridge without the event", () => {
    const { bridge, emit, off } = bridgeWithEmit();
    const run = vi.fn();
    render(<Document run={run} />);
    relayNativePrintShortcut(bridge)();
    expect(off).toHaveBeenCalledOnce();
    emit();
    expect(run).not.toHaveBeenCalled();
    expect(() => relayNativePrintShortcut({})()).not.toThrow();
  });
});
