import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingActivityTimeline } from "./meeting-activity-timeline";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

function activityRespond(activity: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/activity")) return activity();
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    return Promise.resolve({});
  });
}

const EMPTY = "Chưa có thao tác nào.";

function renderTimeline() {
  render(wrapWithNav(<MeetingActivityTimeline workspaceId="w1" meetingId="m1" defaultOpen />));
}

describe("MeetingActivityTimeline", () => {
  it("shows a loading skeleton, not the empty copy, while activity loads", () => {
    activityRespond(() => new Promise(() => {}));
    renderTimeline();

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("shows the empty copy once an empty list arrives", async () => {
    activityRespond(() => Promise.resolve({ activity: [] }));
    renderTimeline();

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when activity fails", async () => {
    activityRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    renderTimeline();

    expect(await screen.findByText("Không tải được lịch sử thao tác.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

    activityRespond(() => Promise.resolve({ activity: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });
});
