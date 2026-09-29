import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useInertOutside } from "./use-inert-outside";

function Layer() {
  const ref = useRef<HTMLDivElement>(null);
  useInertOutside(ref);
  return (
    <div ref={ref} data-testid="layer">
      <button type="button">in room</button>
    </div>
  );
}

function Page({ room }: { room: boolean }) {
  return (
    <div>
      <nav data-testid="nav">
        <button type="button">sidebar</button>
      </nav>
      <main>
        <header data-testid="header" />
        <div data-testid="welcome">
          <p role="status" aria-live="polite" />
          <button type="button">dismiss</button>
        </div>
        {room ? <Layer /> : null}
      </main>
      <section aria-live="polite" data-testid="toasts" />
    </div>
  );
}

describe("useInertOutside", () => {
  it("makes the shell under the room inert and leaves the room and live regions alone", () => {
    const announcer = document.body.appendChild(document.createElement("route-announcer"));
    const { getByTestId, rerender } = render(<Page room />);
    expect(getByTestId("nav").hasAttribute("inert")).toBe(true);
    expect(getByTestId("header").hasAttribute("inert")).toBe(true);
    // A live region deep in the shell does not keep its branch reachable.
    expect(getByTestId("welcome").hasAttribute("inert")).toBe(true);
    expect(getByTestId("layer").hasAttribute("inert")).toBe(false);
    expect(getByTestId("toasts").hasAttribute("inert")).toBe(false);
    expect(announcer.hasAttribute("inert")).toBe(false);

    rerender(<Page room={false} />);
    expect(getByTestId("nav").hasAttribute("inert")).toBe(false);
    expect(getByTestId("header").hasAttribute("inert")).toBe(false);
    announcer.remove();
  });
});
