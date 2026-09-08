import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@uniwork/core/i18n";
import { DateTimeField, joinDateTimeLocal, splitDateTimeLocal } from "./datetime-field";

initI18n();

describe("datetime-local transport", () => {
  it("splits a full value and reads anything else as empty", () => {
    expect(splitDateTimeLocal("2026-09-06T14:30")).toEqual({ date: "2026-09-06", time: "14:30" });
    expect(splitDateTimeLocal("")).toEqual({ date: "", time: "" });
    expect(splitDateTimeLocal("2026-09-06")).toEqual({ date: "", time: "" });
  });

  it("joins the halves and stays empty while the day is unset", () => {
    expect(joinDateTimeLocal("2026-09-06", "14:30")).toBe("2026-09-06T14:30");
    expect(joinDateTimeLocal("2026-09-06", "")).toBe("2026-09-06T09:00");
    expect(joinDateTimeLocal("", "14:30")).toBe("");
  });
});

describe("DateTimeField", () => {
  it("keeps the time when only the hour segment changes", () => {
    const onChange = vi.fn();
    render(
      <DateTimeField
        id="dt"
        value="2026-09-06T14:30"
        onChange={onChange}
        hourLabel="Giờ"
        minuteLabel="Phút"
      />,
    );
    // The hour segment is driven by keydown, not by a native change event.
    fireEvent.keyDown(screen.getByLabelText("Giờ"), { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith("2026-09-06T15:30");
  });
});
