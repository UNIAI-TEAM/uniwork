import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFocusHeadingOnViewChange } from "./use-focus-heading-on-view-change";

function Screen({ view }: { view: string }) {
  useFocusHeadingOnViewChange(view, { selector: "[data-gate-heading]", fallback: null });
  return view.startsWith("lobby") ? <h1 data-gate-heading>{view}</h1> : <button type="button">Vào phòng họp</button>;
}

describe("useFocusHeadingOnViewChange", () => {
  it("leaves the first paint alone and follows each later screen to its heading", () => {
    const { rerender } = render(<Screen view="prejoin" />);
    expect(document.body).toHaveFocus();

    rerender(<Screen view="lobby:WAITING_APPROVAL:" />);
    expect(screen.getByRole("heading")).toHaveFocus();

    rerender(<Screen view="lobby:WAITING_APPROVAL:join_request_rejected" />);
    expect(screen.getByRole("heading")).toHaveFocus();
  });

  it("does nothing when the new screen has no gate heading", () => {
    const { rerender } = render(<Screen view="lobby:WAITING_APPROVAL:" />);
    rerender(<Screen view="room" />);
    expect(document.body).toHaveFocus();
  });
});
