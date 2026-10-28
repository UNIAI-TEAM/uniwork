import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markJoinWash, useJoinWash } from "./meeting-join-wash";

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motion.reduce,
}));

function Shell() {
  const ref = useRef<HTMLDivElement>(null);
  const [joined, setJoined] = useState(false);
  useJoinWash(ref);
  return (
    <div ref={ref} data-testid="shell">
      {joined ? (
        <p>Phòng họp</p>
      ) : (
        <section>
          <button type="button" onClick={(e) => (markJoinWash(e.currentTarget), setJoined(true))}>
            Vào phòng họp
          </button>
        </section>
      )}
    </div>
  );
}

const anim = { onfinish: null as null | (() => void), oncancel: null as null | (() => void) };
const animate = vi.fn(() => anim);

beforeEach(() => {
  motion.reduce = false;
  animate.mockClear();
  HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 100, y: 200, width: 40, height: 44 } as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

describe("join wash (D)", () => {
  it("opens the room from the join button's centre over a still of the prejoin", () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    // The room is there at once: the wash never holds the join back.
    expect(screen.getByText("Phòng họp")).toBeInTheDocument();
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(frames).toEqual([{ clipPath: "circle(22px at 120px 222px)" }, { clipPath: "circle(150vmax at 120px 222px)" }]);
    expect(opts).toMatchObject({ duration: 450, easing: "cubic-bezier(0.32,0.72,0,1)" });
    const still = screen.getByTestId("shell").previousElementSibling as HTMLElement;
    expect(still).toHaveAttribute("aria-hidden", "true");
    expect(still).toHaveTextContent("Vào phòng họp");
    anim.onfinish?.();
    expect(screen.getByTestId("shell").previousElementSibling).toBeNull();
  });

  it("swaps at once under reduced motion", () => {
    motion.reduce = true;
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));
    expect(screen.getByText("Phòng họp")).toBeInTheDocument();
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByTestId("shell").previousElementSibling).toBeNull();
  });
});
