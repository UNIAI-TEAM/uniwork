import { render, screen } from "@testing-library/react";
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
  it("shows period-aware center label for each view mode", () => {
    const { rerender } = render(
      wrapWithNav(
        <CalendarToolbar
          anchorDate={anchor}
          mine={false}
          viewMode="month"
          workspaceId="ws1"
          onAnchorDateChange={noop}
          onMineChange={noop}
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
          viewMode="day"
          workspaceId="ws1"
          onAnchorDateChange={noop}
          onMineChange={noop}
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
          viewMode="week"
          workspaceId="ws1"
          onAnchorDateChange={noop}
          onMineChange={noop}
          onViewModeChange={noop}
        />,
      ),
    );
    expect(screen.getByText(formatPeriodLabel("week", anchor, viLocale))).toBeInTheDocument();
  });
});
