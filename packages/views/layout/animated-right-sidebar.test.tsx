import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnimatedRightSidebarLayout,
  RightSidebarToggle,
  useAnimatedRightSidebar,
  type AnimatedRightSidebarController,
} from "./animated-right-sidebar";

/**
 * Holds `requestAnimationFrame` callbacks until the test runs them, so "the
 * next frame arrives after the panel is gone" is a step in the test rather
 * than a race with jsdom's frame timer. Under that race the stale frame threw
 * "Group _r_2_ not found" as an uncaught exception inside whichever test ran
 * next, which failed the whole vitest run with every test green.
 */
function holdAnimationFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pending.delete(id);
  });
  return {
    runPending() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(performance.now());
    },
  };
}

function Harness({
  showLayout,
  onController,
}: {
  showLayout: boolean;
  onController?: (controller: AnimatedRightSidebarController) => void;
}) {
  const controller = useAnimatedRightSidebar(true);
  onController?.(controller);
  return (
    <div>
      <RightSidebarToggle controller={controller} label="Toggle properties" />
      {showLayout ? (
        <AnimatedRightSidebarLayout
          controller={controller}
          main={<div>main</div>}
          sidebar={<div>sidebar</div>}
          sidebarLabel="Properties"
        />
      ) : null}
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAnimatedRightSidebar", () => {
  it("a toggle whose frame lands after the page unmounted does not throw", () => {
    const { unmount } = render(<Harness showLayout />);
    const frames = holdAnimationFrames();

    fireEvent.click(screen.getByRole("button", { name: "Toggle properties" }));
    unmount();

    expect(() => frames.runPending()).not.toThrow();
  });

  // The detail page keeps the hook mounted while it swaps the layout for its
  // loading or not-found branch, so the group can go away on its own.
  it("a toggle whose frame lands after only the panel group unmounted does not throw", () => {
    const { rerender } = render(<Harness showLayout />);
    const frames = holdAnimationFrames();

    fireEvent.click(screen.getByRole("button", { name: "Toggle properties" }));
    rerender(<Harness showLayout={false} />);

    expect(() => frames.runPending()).not.toThrow();
  });

  it("still collapses the panel on the next frame while it is mounted", () => {
    let controller: AnimatedRightSidebarController | null = null;
    render(
      <Harness
        showLayout
        onController={(c) => {
          controller = c;
        }}
      />,
    );
    const frames = holdAnimationFrames();
    const panel = () => (controller as AnimatedRightSidebarController | null)?.panelRef.current;
    expect(panel()?.isCollapsed()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Toggle properties" }));
    expect(panel()?.isCollapsed()).toBe(false);
    act(() => frames.runPending());

    expect(panel()?.isCollapsed()).toBe(true);
  });
});
