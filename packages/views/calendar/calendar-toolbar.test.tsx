import { fireEvent, render, screen } from "@testing-library/react";
import { vi as viLocale } from "date-fns/locale";
import { describe, expect, it, vi } from "vitest";
import { wrapWithNav } from "../test/api-mock";
import { CalendarToolbar } from "./calendar-toolbar";
import { formatPeriodLabel } from "./calendar-view-mode";

vi.mock("./calendar-export-button", () => ({
  CalendarExportButton: () => <button type="button">export</button>,
}));

const anchor = new Date("2026-09-15T12:00:00Z");
const noop = () => {};

describe("CalendarToolbar", () => {
  it("keeps dense toolbar actions flat and the selected view edge-free", () => {
    render(
      wrapWithNav(
        <CalendarToolbar
          anchorDate={anchor}
          mine={false}
          showWeekends
          viewMode="week"
          workspaceId="ws1"
          isRefreshing={false}
          onAnchorDateChange={noop}
          onMineChange={noop}
          onRefresh={noop}
          onShowWeekendsChange={noop}
          onViewModeChange={noop}
        />,
      ),
    );

    for (const name of ["Kỳ trước", "Kỳ sau", "Hôm nay", "Làm mới lịch", "Cài đặt lịch"]) {
      const control = screen.getByRole("button", { name });
      expect(control).toHaveClass("border-transparent");
      expect(control).not.toHaveClass("border-input");
    }

    const selectedView = screen.getByRole("button", { name: "Tuần" });
    expect(selectedView).toHaveClass("aria-pressed:border-transparent");
    expect(selectedView).not.toHaveClass("aria-pressed:border-border");
    expect(selectedView.className).not.toContain("aria-pressed:shadow-");
  });

  it("keeps text controls while icon actions navigate, switch views, and filter mine", () => {
    const onAnchorDateChange = vi.fn();
    const onMineChange = vi.fn();
    const onViewModeChange = vi.fn();
    render(
      wrapWithNav(
        <CalendarToolbar
          anchorDate={anchor}
          mine={false}
          showWeekends
          viewMode="week"
          workspaceId="ws1"
          isRefreshing={false}
          onAnchorDateChange={onAnchorDateChange}
          onMineChange={onMineChange}
          onRefresh={noop}
          onShowWeekendsChange={noop}
          onViewModeChange={onViewModeChange}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Kỳ trước" }));
    fireEvent.click(screen.getByRole("button", { name: "Kỳ sau" }));
    fireEvent.click(screen.getByRole("button", { name: "Hôm nay" }));
    expect(onAnchorDateChange).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Ngày" }));
    expect(onViewModeChange).toHaveBeenCalledWith("day");

    fireEvent.click(screen.getByRole("switch", { name: "Của tôi" }));
    expect(onMineChange.mock.calls[0]?.[0]).toBe(true);
  });

  it("shows period-aware center label for each view mode", () => {
    const { rerender } = render(
      wrapWithNav(
        <CalendarToolbar
          anchorDate={anchor}
          mine={false}
          showWeekends
          viewMode="month"
          workspaceId="ws1"
          isRefreshing={false}
          onAnchorDateChange={noop}
          onMineChange={noop}
          onRefresh={noop}
          onShowWeekendsChange={noop}
          onViewModeChange={noop}
        />,
      ),
    );
    expect(screen.getByText(formatPeriodLabel("month", anchor, viLocale))).toBeInTheDocument();

    rerender(
      wrapWithNav(
        <CalendarToolbar
          anchorDate={anchor}
          mine={false}
          showWeekends
          viewMode="day"
          workspaceId="ws1"
          isRefreshing={false}
          onAnchorDateChange={noop}
          onMineChange={noop}
          onRefresh={noop}
          onShowWeekendsChange={noop}
          onViewModeChange={noop}
        />,
      ),
    );
    expect(screen.getByText(formatPeriodLabel("day", anchor, viLocale))).toBeInTheDocument();

    rerender(
      wrapWithNav(
        <CalendarToolbar
          anchorDate={anchor}
          mine={false}
          showWeekends
          viewMode="week"
          workspaceId="ws1"
          isRefreshing={false}
          onAnchorDateChange={noop}
          onMineChange={noop}
          onRefresh={noop}
          onShowWeekendsChange={noop}
          onViewModeChange={noop}
        />,
      ),
    );
    expect(screen.getByText(formatPeriodLabel("week", anchor, viLocale))).toBeInTheDocument();
  });

  it("refreshes calendar data and exposes the loading state", () => {
    const onRefresh = vi.fn();
    const renderToolbar = (isRefreshing: boolean) =>
      wrapWithNav(
        <CalendarToolbar
          anchorDate={anchor}
          mine={false}
          showWeekends
          viewMode="week"
          workspaceId="ws1"
          isRefreshing={isRefreshing}
          onAnchorDateChange={noop}
          onMineChange={noop}
          onRefresh={onRefresh}
          onShowWeekendsChange={noop}
          onViewModeChange={noop}
        />,
      );
    const { rerender } = render(renderToolbar(false));

    fireEvent.click(screen.getByRole("button", { name: "Làm mới lịch" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(renderToolbar(true));
    const refreshing = screen.getByRole("button", { name: "Đang làm mới lịch…" });
    expect(refreshing).toHaveAttribute("aria-busy", "true");
    expect(refreshing).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(refreshing);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("toggles weekend visibility from calendar settings", () => {
    const onShowWeekendsChange = vi.fn();
    render(
      wrapWithNav(
        <CalendarToolbar
          anchorDate={anchor}
          mine={false}
          showWeekends
          viewMode="week"
          workspaceId="ws1"
          isRefreshing={false}
          onAnchorDateChange={noop}
          onMineChange={noop}
          onRefresh={noop}
          onShowWeekendsChange={onShowWeekendsChange}
          onViewModeChange={noop}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cài đặt lịch" }));
    const weekendSwitch = screen.getByRole("switch", { name: "Hiện cuối tuần" });
    expect(weekendSwitch).toBeChecked();

    fireEvent.click(weekendSwitch);
    expect(onShowWeekendsChange).toHaveBeenCalledTimes(1);
    expect(onShowWeekendsChange.mock.calls[0]?.[0]).toBe(false);
  });
});
