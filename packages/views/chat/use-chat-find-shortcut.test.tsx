import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureShortcutPlatform,
  createShortcutChord,
  useShortcutStore,
} from "@uniwork/core/shortcuts";
import { useChatFindShortcut } from "./use-chat-find-shortcut";

function Harness({ enabled = true, onFind }: { enabled?: boolean; onFind: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useChatFindShortcut(ref, enabled, onFind);
  return (
    <div>
      <div ref={ref}>
        <input aria-label="composer" />
      </div>
      <input aria-label="outside" />
    </div>
  );
}

beforeEach(() => {
  configureShortcutPlatform("windows");
  useShortcutStore.getState().resetAll();
});

afterEach(() => {
  configureShortcutPlatform(null);
  useShortcutStore.getState().resetAll();
});

describe("useChatFindShortcut", () => {
  it("opens room search for the find chord pressed inside the conversation", () => {
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    const notPrevented = fireEvent.keyDown(screen.getByLabelText("composer"), { key: "f", ctrlKey: true });
    expect(onFind).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("leaves the browser find alone outside the conversation", () => {
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    const notPrevented = fireEvent.keyDown(screen.getByLabelText("outside"), { key: "f", ctrlKey: true });
    expect(onFind).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it("matches the exact chord of the platform, not any modifier combination", () => {
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    const composer = screen.getByLabelText("composer");
    fireEvent.keyDown(composer, { key: "f", metaKey: true });
    fireEvent.keyDown(composer, { key: "f", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(composer, { key: "f" });
    expect(onFind).not.toHaveBeenCalled();
  });

  it("does nothing while no room is open or an IME is composing", () => {
    const onFind = vi.fn();
    const { rerender } = render(<Harness enabled={false} onFind={onFind} />);
    fireEvent.keyDown(screen.getByLabelText("composer"), { key: "f", ctrlKey: true });
    rerender(<Harness onFind={onFind} />);
    fireEvent.keyDown(screen.getByLabelText("composer"), { key: "f", ctrlKey: true, isComposing: true });
    expect(onFind).not.toHaveBeenCalled();
  });

  it("follows a rebinding of the find action", () => {
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    useShortcutStore.getState().setShortcut("findInTask", createShortcutChord("G", { primary: true }));
    const composer = screen.getByLabelText("composer");
    fireEvent.keyDown(composer, { key: "f", ctrlKey: true });
    expect(onFind).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "g", ctrlKey: true });
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  it("ignores a repeated keydown", () => {
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    fireEvent.keyDown(screen.getByLabelText("composer"), { key: "f", ctrlKey: true, repeat: true });
    expect(onFind).not.toHaveBeenCalled();
  });

  it("ignores an event another handler already claimed", () => {
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    const composer = screen.getByLabelText("composer");
    const claim = (event: Event) => event.preventDefault();
    // Registered before the hook's window listener sees the bubbling event.
    composer.addEventListener("keydown", claim);
    fireEvent.keyDown(composer, { key: "f", ctrlKey: true });
    composer.removeEventListener("keydown", claim);
    expect(onFind).not.toHaveBeenCalled();
  });

  it("uses Cmd+F on macOS and leaves Control+F to the text field", () => {
    configureShortcutPlatform("macos");
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    const composer = screen.getByLabelText("composer");
    fireEvent.keyDown(composer, { key: "f", ctrlKey: true });
    expect(onFind).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "f", metaKey: true });
    expect(onFind).toHaveBeenCalledTimes(1);
  });
});
