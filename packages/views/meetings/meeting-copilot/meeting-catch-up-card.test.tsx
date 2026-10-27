import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { catchUpLateMinutes, firstJoinedAt, lateJoinMinutes, MeetingCatchUpCard } from "./meeting-catch-up-card";

const brief = {
  summary: "Nhóm đã chốt lịch demo.",
  highlights: [
    { text: "Demo vào thứ Sáu", segment_id: "g1", spoken_at: "2026-10-21T02:05:00Z" },
    { text: "Ngân sách theo ghi chú" },
  ],
  action_items: [{ title: "Gửi bản demo", owner: "An", segment_id: "g2", spoken_at: "2026-10-21T02:10:00Z" }],
  generated_at: "2026-10-21T02:25:00Z",
  partial: false,
};

const calls = (suffix: string) => requestMock.mock.calls.filter(([p]) => String(p).endsWith(suffix));

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => Promise.resolve(String(path).endsWith("/catch-up") ? brief : {}));
});

describe("lateJoinMinutes", () => {
  const start = "2026-10-21T02:00:00Z";
  const at = (min: number) => Date.parse(start) + min * 60_000;
  it("offers the brief only from 10 minutes after the actual start", () => {
    expect(lateJoinMinutes(start, at(9.9))).toBeNull();
    expect(lateJoinMinutes(start, at(10))).toBe(10);
    expect(lateJoinMinutes(start, at(23.5))).toBe(23);
    expect(lateJoinMinutes(undefined, at(30))).toBeNull();
    expect(lateJoinMinutes("not a date", at(30))).toBeNull();
  });
});

describe("catchUpLateMinutes", () => {
  const meeting = { status: "IN_PROGRESS", actual_start_at: "2026-10-21T02:00:00Z", host_user_id: "host" };
  const joinedAt = Date.parse("2026-10-21T02:20:00Z");
  it("offers a late member the brief, never the host coming back, a guest or a meeting not running", () => {
    expect(catchUpLateMinutes({ meeting, joinedAt, viewerId: "lan" })).toBe(20);
    expect(catchUpLateMinutes({ meeting, joinedAt, viewerId: "host" })).toBeNull();
    expect(catchUpLateMinutes({ meeting, joinedAt, viewerId: "lan", guest: true })).toBeNull();
    expect(catchUpLateMinutes({ meeting: { ...meeting, status: "ENDED" }, joinedAt, viewerId: "lan" })).toBeNull();
    expect(catchUpLateMinutes({ meeting: undefined, joinedAt, viewerId: "lan" })).toBeNull();
  });
});

describe("firstJoinedAt", () => {
  afterEach(() => sessionStorage.clear());

  it("keeps the first entry of a meeting for the tab's session, so coming back is not coming late", () => {
    expect(firstJoinedAt("m1", 1_000)).toBe(1_000);
    expect(firstJoinedAt("m1", 900_000)).toBe(1_000);
    expect(firstJoinedAt("m2", 900_000)).toBe(900_000);
  });
});

describe("catch-up card (B7)", () => {
  it("costs nothing until clicked, then shows each point as one sentence with its local time", async () => {
    render(wrapWithNav(<MeetingCatchUpCard meetingId="m1" lateMinutes={23} />));
    const card = await screen.findByTestId("meeting-catch-up-card");
    expect(within(card).getByText(/Bạn vào sau 23 phút/)).toBeInTheDocument();
    const button = within(card).getByRole("button", { name: "Xem tóm tắt" });
    expect(calls("/catch-up")).toHaveLength(0);

    fireEvent.click(button);
    expect(await screen.findByText("Nhóm đã chốt lịch demo.")).toBeInTheDocument();
    expect(calls("/catch-up")).toHaveLength(1);
    const spoken = screen.getByText("Demo vào thứ Sáu", { exact: false }).closest("li") as HTMLElement;
    const time = spoken.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-10-21T02:05:00Z");
    expect(time).toHaveClass("tabular-nums");
    expect(time).not.toHaveClass("font-mono");
    // A point from the notes has no time and no label column ("Ghi chú Ghi chú").
    expect(screen.getByText("Ngân sách theo ghi chú").closest("li")).toHaveTextContent(/^Ngân sách theo ghi chú$/);
    expect(screen.getByText(/Gửi bản demo · An/)).toBeInTheDocument();
    expect(screen.getByText("Chỉ bạn thấy tóm tắt này.")).toBeInTheDocument();
    // AI output says it is AI, what it read and when.
    const attribution = within(card).getByTestId("meeting-summary-attribution");
    expect(attribution).toHaveTextContent("AI");
    expect(attribution).toHaveTextContent(/bản ghi lời thoại và ghi chú/);
  });

  it("folds away and can be dismissed for the rest of the meeting", async () => {
    const onDismiss = vi.fn();
    render(
      wrapWithNav(
        <MeetingCatchUpCard meetingId="m1" lateMinutes={23} onDismiss={onDismiss} />,
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Xem tóm tắt" }));
    await screen.findByText("Nhóm đã chốt lịch demo.");

    const fold = screen.getByRole("button", { name: "Phần bạn đã lỡ" });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Nhóm đã chốt lịch demo.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Đóng phần bạn đã lỡ" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("says so when the brief cannot be made, and the button says it tries again now", async () => {
    requestMock.mockImplementation((path: unknown) =>
      String(path).endsWith("/catch-up") ? Promise.reject(new Error("boom")) : Promise.resolve({}),
    );
    render(wrapWithNav(<MeetingCatchUpCard meetingId="m1" lateMinutes={15} />));
    fireEvent.click(await screen.findByRole("button", { name: "Xem tóm tắt" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Chưa tóm tắt được phần bạn đã lỡ");
    expect(alert).not.toHaveTextContent(/sau ít phút/);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(calls("/catch-up")).toHaveLength(2));
  });
});
