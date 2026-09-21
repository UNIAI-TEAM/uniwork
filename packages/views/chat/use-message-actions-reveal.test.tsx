import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageActionsReveal } from "./use-message-actions-reveal";

function Probe() {
  const { open, rootRef, bind } = useMessageActionsReveal();
  return (
    <div>
      <div ref={rootRef} data-testid="message" {...bind}>
        <div data-message-actions>
          <button type="button">Trả lời</button>
        </div>
      </div>
      <button type="button">Ngoài</button>
      <p>{open ? "open" : "closed"}</p>
    </div>
  );
}

describe("useMessageActionsReveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens on a touch long press, focuses the first action, closes on an outside tap", async () => {
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("message"), { pointerType: "touch", clientX: 10, clientY: 10 });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trả lời" })).toHaveFocus();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Ngoài" }));
    expect(screen.getByText("closed")).toBeInTheDocument();
  });

  it("treats a moving touch as a scroll and ignores the mouse", async () => {
    render(<Probe />);
    const message = screen.getByTestId("message");
    fireEvent.pointerDown(message, { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(message, { pointerType: "touch", clientX: 10, clientY: 40 });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("closed")).toBeInTheDocument();
    fireEvent.pointerDown(message, { pointerType: "mouse", clientX: 10, clientY: 10 });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("closed")).toBeInTheDocument();
  });
});
