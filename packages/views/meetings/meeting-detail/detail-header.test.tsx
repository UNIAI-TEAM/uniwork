import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { DetailHeader } from "./detail-header";

beforeAll(() => {
  initI18n();
});

/** Local wall clock, so the cases read the same in any test zone. */
const at = (mo: number, d: number, h: number, mi: number) => new Date(2026, mo - 1, d, h, mi);
const iso = (date: Date) => date.toISOString();
const NOW = at(10, 23, 21, 18).getTime();

const base: Meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Giao ban tuần 43",
  description: "",
  room_name: "r",
  created_by: "u",
  host_user_id: "u",
  status: "SCHEDULED",
  starts_at: iso(at(10, 24, 14, 0)),
  ends_at: iso(at(10, 24, 15, 0)),
};

function header(meeting: Partial<Meeting>, status: string, now = NOW) {
  return render(<DetailHeader meeting={{ ...base, ...meeting }} status={status} now={now} />);
}

/** The meta clock line: its range is its own <time>, the tail a text run after it. */
const clockLine = (text: string) =>
  screen.getByText((_, el) => el?.tagName === "SPAN" && el.firstElementChild?.tagName === "TIME" && el.textContent === text);

describe("DetailHeader", () => {
  it("heads a scheduled meeting with its pill, day and time left, and no eyebrow over the title", () => {
    const { container } = header({}, "SCHEDULED", NOW);
    expect(container.querySelector("header")?.firstElementChild?.querySelector("h1")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Giao ban tuần 43" })).toBeInTheDocument();
    expect(screen.getByText("Sắp diễn ra")).toBeInTheDocument();
    // Tomorrow is said in the strip, not in the meta line.
    expect(screen.getByText("Thứ Bảy 24/10")).toBeInTheDocument();
    expect(clockLine("14:00–15:00 · còn 17 giờ")).toBeInTheDocument();
  });

  it("reads an ended meeting by when it actually ran, and names yesterday", () => {
    header(
      {
        status: "ENDED",
        starts_at: iso(at(10, 22, 9, 0)),
        ends_at: iso(at(10, 22, 10, 0)),
        actual_start_at: iso(at(10, 22, 9, 0)),
        actual_end_at: iso(at(10, 22, 9, 28)),
      },
      "ENDED",
    );
    expect(screen.getByText("Đã kết thúc")).toBeInTheDocument();
    expect(screen.getByText("Thứ Năm 22/10 · hôm qua")).toBeInTheDocument();
    expect(clockLine("09:00–09:28 · 28 phút")).toBeInTheDocument();
  });

  it("counts a live meeting's minutes in the pill, the time left in the meta, and draws the time bar", () => {
    const live = { status: "IN_PROGRESS", starts_at: iso(at(10, 23, 20, 54)), ends_at: iso(at(10, 23, 22, 8)), actual_start_at: iso(at(10, 23, 20, 54)) };
    header(live, "IN_PROGRESS");
    expect(screen.getByText("Đang diễn ra · 24 phút")).toBeInTheDocument();
    expect(clockLine("20:54–22:08 · còn 50 phút")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Đã họp 24 phút từ 20:54, còn 50 phút đến 22:08" })).toBeInTheDocument();
  });

  it("says how far a meeting ran over and how long it has been held", () => {
    const live = { status: "IN_PROGRESS", starts_at: iso(at(10, 23, 20, 54)), ends_at: iso(at(10, 23, 22, 8)), actual_start_at: iso(at(10, 23, 20, 54)) };
    header(live, "OVERTIME", at(10, 23, 22, 18).getTime());
    expect(screen.getByText("Quá giờ · 10 phút")).toBeInTheDocument();
    expect(clockLine("20:54–22:08 · đã họp 1 giờ 24 phút")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Bắt đầu 20:54, giờ kết thúc 22:08, đã quá 10 phút" })).toBeInTheDocument();
  });

  it("keeps a canceled meeting at full contrast: no strike-through on the title", () => {
    header({ status: "CANCELED", starts_at: iso(at(10, 28, 10, 0)), ends_at: iso(at(10, 28, 11, 30)) }, "CANCELED");
    expect(screen.getByText("Đã hủy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).className).not.toMatch(/line-through/);
    expect(clockLine("10:00–11:30 · 1 giờ 30 phút")).toBeInTheDocument();
  });

  it("marks a window that runs past midnight as ending the next day", () => {
    header({ starts_at: iso(at(10, 23, 23, 30)), ends_at: iso(at(10, 24, 0, 30)) }, "SCHEDULED");
    expect(screen.getByText(/^23:30–00:30 \(hôm sau\)/)).toBeInTheDocument();
  });

  it("names both clocks when the meeting was set in another zone, and only then", () => {
    const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const other = viewerZone === "Pacific/Kiritimati" ? "Pacific/Pago_Pago" : "Pacific/Kiritimati";
    const { unmount } = header({ timezone: other }, "SCHEDULED");
    expect(screen.getAllByText(/\(.+\)/).length).toBeGreaterThanOrEqual(2);
    unmount();
    header({ timezone: viewerZone }, "SCHEDULED");
    expect(screen.queryByText(/\(.+\)/)).not.toBeInTheDocument();
  });

  it("names the year of a meeting from another year", () => {
    header({ status: "ENDED", starts_at: new Date(2025, 9, 21, 9, 0).toISOString(), ends_at: new Date(2025, 9, 21, 10, 0).toISOString() }, "ENDED");
    expect(screen.getByText("Thứ Ba 21/10/2025")).toBeInTheDocument();
  });
});
