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

  it("is a 44px target on a coarse pointer, the clear × included", () => {
    render(
      <>
        <PillButton>Trạng thái</PillButton>
        <ClearablePillButton onClear={() => {}} clearLabel="Xóa dự án">
          Dự án A
        </ClearablePillButton>
      </>,
    );
    // 46px outside the 1px border: 44px inside, where the clearable pill's buttons are.
    expect(screen.getByRole("button", { name: "Trạng thái" })).toHaveClass("pointer-coarse:min-h-[2.875rem]");
    expect(screen.getByRole("button", { name: "Dự án A" }).parentElement).toHaveClass("pointer-coarse:min-h-[2.875rem]");
    expect(screen.getByRole("button", { name: "Dự án A" })).toHaveClass("self-stretch");
    expect(screen.getByRole("button", { name: "Xóa dự án" })).toHaveClass("pointer-coarse:min-w-11");
  });
});
