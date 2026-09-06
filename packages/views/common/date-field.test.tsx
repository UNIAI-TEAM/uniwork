import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@uniwork/core/i18n";
import { DateField, dateOnlyToLocalDate, toDateOnly } from "./date-field";

initI18n();

describe("date-only transport", () => {
  it("round-trips without a timezone shift", () => {
    expect(toDateOnly(dateOnlyToLocalDate("2026-09-06")!)).toBe("2026-09-06");
    expect(dateOnlyToLocalDate("")).toBeUndefined();
    expect(dateOnlyToLocalDate("2026-13-40")).toBeUndefined();
  });
});

describe("DateField", () => {
  it("opens a calendar, emits the picked day and clears it", () => {
    const onChange = vi.fn();
    render(<DateField id="d" value="2026-09-06" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /2026/ }));
    fireEvent.click(screen.getAllByRole("gridcell").map((c) => c.querySelector("button")).find((b) => b?.textContent === "10")!);
    expect(onChange).toHaveBeenCalledWith("2026-09-10");
    fireEvent.click(screen.getByRole("button", { name: /2026/ }));
    fireEvent.click(screen.getByText("Bỏ chọn ngày"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
