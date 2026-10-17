import { StrictMode, useRef } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFrameFocus } from "./frame-focus";

let hook: ReturnType<typeof useFrameFocus> | null = null;
let iframeEl: HTMLIFrameElement | null = null;

function Probe() {
  const ref = useRef<HTMLIFrameElement | null>(null);
  hook = useFrameFocus(ref);
  return <iframe ref={(el) => { ref.current = el; iframeEl = el; }} title="frame" />;
}

describe("useFrameFocus", () => {
  // next dev mounts under StrictMode, which runs every effect cleanup once before the real mount:
  // a hand-back that stays "unmounting" after that falls through to Base UI's default (the page Save button).
  it("still hands focus to the iframe after StrictMode's simulated unmount", () => {
    render(<StrictMode><Probe /></StrictMode>);
    const focus = vi.spyOn(iframeEl!, "focus");
    // jsdom has no window.focus.
    vi.spyOn(iframeEl!.contentWindow!, "focus").mockImplementation(() => undefined);
    hook!.focusFrame();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(hook!.finalFocus()).toBe(iframeEl);
  });

  it("leaves Base UI's default focus once the frame is unmounting", () => {
    const { unmount } = render(<Probe />);
    const result = hook!;
    vi.spyOn(iframeEl!.contentWindow!, "focus").mockImplementation(() => undefined);
    unmount();
    expect(result.finalFocus()).toBe(true);
  });
});
