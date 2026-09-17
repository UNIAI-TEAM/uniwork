import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClearablePillButton, PillButton } from "./pill-button";

describe("PillButton", () => {
  it("renders a button with the given label", () => {
    render(<PillButton>Trạng thái</PillButton>);
    expect(screen.getByRole("button", { name: "Trạng thái" })).toBeInTheDocument();
  });

  it("ClearablePillButton calls onClear without triggering the main click", () => {
    const onClear = vi.fn();
    const onClick = vi.fn();
    render(
      <ClearablePillButton onClear={onClear} clearLabel="Xóa dự án" onClick={onClick}>
        Dự án A
      </ClearablePillButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xóa dự án" }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});
