import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { wrapWithNav } from "../test/api-mock";
import { CalendarPeriodPicker } from "./calendar-period-picker";

vi.mock("@uniwork/ui/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect?: (date: Date) => void }) => (
    <button type="button" onClick={() => onSelect?.(new Date(2026, 9, 8))}>
      pick October 8
    </button>
  ),
}));

describe("CalendarPeriodPicker", () => {
  it("opens from the period label and returns the selected date", async () => {
    const onChange = vi.fn();
    render(
      wrapWithNav(
        <CalendarPeriodPicker
          anchorDate={new Date(2026, 8, 15)}
          periodLabel="tháng 9 2026"
          onChange={onChange}
        />,
      ),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Chọn kỳ hiển thị, hiện tại tháng 9 2026",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "pick October 8" }));

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 8));
    expect(screen.queryByRole("button", { name: "pick October 8" })).toBeNull();
  });
});
