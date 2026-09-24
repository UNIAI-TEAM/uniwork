import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@uniwork/core/i18n";
import { DateTimePicker } from "./date-time-picker";

initI18n();

describe("DateTimePicker", () => {
  beforeAll(async () => {
    await import("@uniwork/ui/components/ui/calendar");
  }, 60_000);

  it("keeps date and time inside one custom popover", async () => {
    const onChange = vi.fn();
    render(
      <DateTimePicker
        value="2026-09-24"
        onChange={onChange}
        ariaLabel="Hạn chót"
      />,
    );

    expect(screen.queryByLabelText("Giờ")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hạn chót" }));

    await screen.findAllByRole("gridcell", {}, { timeout: 20_000 });
    expect(screen.getByRole("button", { name: "Thêm giờ" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Giờ")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thêm giờ" }));

    expect(onChange).toHaveBeenLastCalledWith("2026-09-24T09:00");
    expect(screen.getByLabelText("Giờ")).toHaveValue("09");
    expect(screen.getByLabelText("Phút")).toHaveValue("00");
  });

  it("selects another day without closing before the user finishes", async () => {
    const onChange = vi.fn();
    render(
      <DateTimePicker
        value="2026-09-24T14:30"
        onChange={onChange}
        ariaLabel="Ngày bắt đầu"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ngày bắt đầu" }));
    await screen.findAllByRole("gridcell", {}, { timeout: 20_000 });
    const day = screen
      .getAllByRole("gridcell")
      .map((cell) => cell.querySelector("button"))
      .find((button) => button?.textContent === "25");
    fireEvent.click(day!);

    expect(onChange).toHaveBeenLastCalledWith("2026-09-25T14:30");
    expect(screen.getByRole("button", { name: "Cả ngày" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xong" })).toBeInTheDocument();
  });

  it("returns a timed value to an all-day value in the same popover", async () => {
    const onChange = vi.fn();
    render(
      <DateTimePicker
        value="2026-09-24T14:30"
        onChange={onChange}
        ariaLabel="Hạn chót"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hạn chót" }));
    await screen.findByLabelText("Giờ", {}, { timeout: 20_000 });
    fireEvent.click(screen.getByRole("button", { name: "Cả ngày" }));

    expect(onChange).toHaveBeenLastCalledWith("2026-09-24");
    expect(screen.queryByLabelText("Giờ")).not.toBeInTheDocument();
  });
});
