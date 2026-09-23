import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { wrapWithNav } from "../test/api-mock";
import { CalendarExportButton } from "./calendar-export-button";

vi.mock("sonner", async (orig) => {
  const mod = await orig<typeof import("sonner")>();
  return { ...mod, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

vi.mock("@uniwork/core/api/endpoints/calendar", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/calendar")>()),
  fetchWorkspaceCalendarIcs: vi.fn(() => Promise.resolve("BEGIN:VCALENDAR\nEND:VCALENDAR")),
  WORKSPACE_ICS_FILENAME: "uniwork-calendar.ics",
}));

describe("CalendarExportButton", () => {
  it("downloads workspace .ics and confirms", async () => {
    const anchors: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    }) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();

    render(
      wrapWithNav(
        <CalendarExportButton workspaceId="ws1" from="2026-09-01" to="2026-09-30" />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Xuất ICS" }));

    await waitFor(() => expect(anchors.at(-1)?.download).toBe("uniwork-calendar.ics"));
    expect(toast.success).toHaveBeenCalled();
  });
});
