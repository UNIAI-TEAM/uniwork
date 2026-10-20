import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useActionsBarPlacement } from "./use-actions-bar-placement";

function Row() {
  const barRef = useRef<HTMLDivElement>(null);
  useActionsBarPlacement(barRef, true);
  return (
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <div data-testid="row" className="group/message">
        <div data-testid="bubble">
          <div ref={barRef} data-testid="bar" />
        </div>
      </div>
    </div>
  );
}

function at(el: HTMLElement, top: number) {
  el.getBoundingClientRect = () => ({ top, y: top, bottom: top, left: 0, right: 0, x: 0, width: 0, height: 0, toJSON: () => ({}) });
}

describe("useActionsBarPlacement", () => {
  it("drops the bar inside the bubble when the space above is shorter than the bar, and floats it above otherwise", () => {
    render(<Row />);
    const bar = screen.getByTestId("bar");
    Object.defineProperty(bar, "offsetHeight", { value: 44 });
    at(screen.getByTestId("scroller"), 100);

    at(screen.getByTestId("bubble"), 130);
    fireEvent.pointerEnter(screen.getByTestId("row"));
    expect(bar.dataset.place).toBe("inside");
    expect(bar.style.top).toBe("8px");

    // Half hidden under the header: the bar hangs from the scroller's visible top.
    at(screen.getByTestId("bubble"), 80);
    fireEvent.pointerEnter(screen.getByTestId("row"));
    expect(bar.style.top).toBe("28px");

    at(screen.getByTestId("bubble"), 300);
    fireEvent.focusIn(screen.getByTestId("row"));
    expect(bar.dataset.place).toBe("above");
    expect(bar.style.top).toBe("");
  });
});
