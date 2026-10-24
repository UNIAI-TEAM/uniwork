import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { newMotion } from "./draft-model";
import { MotionDrafts } from "./motion-drafts";

describe("MotionDrafts", () => {
  it("does not offer to swap a draft with a motion already open or closed", async () => {
    const motions = [
      { ...newMotion(), id: "mo-a", status: "CLOSED", title: "A", position: 1 },
      { ...newMotion(), id: "mo-b", status: "DRAFT", title: "B", position: 2 },
      { ...newMotion(), id: "mo-c", status: "DRAFT", title: "C", position: 3 },
    ];
    render(<MotionDrafts motions={motions} onChange={vi.fn()} showErrors={false} />);
    fireEvent.click(screen.getByRole("button", { name: 'Thao tác với "B"' }));
    expect(await screen.findByRole("menuitem", { name: "Chuyển lên" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Chuyển xuống" })).not.toHaveAttribute("aria-disabled", "true");
  });
});
