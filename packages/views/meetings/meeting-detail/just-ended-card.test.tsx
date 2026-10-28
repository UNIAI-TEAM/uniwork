import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { DetailContext } from "./detail-context";
import { MeetingJustEndedCard } from "./just-ended-card";
import type { StripJob } from "./next-step-jobs";
import type { StripHandlers } from "./strip-rows";
import { demoUser, detailValue, fixtureMeeting, routeMeeting } from "./test-fixtures";

const meeting = fixtureMeeting("m1");
const base = `/api/v1/meetings/${meeting.id}`;

const job = (over: Partial<Extract<StripJob, { kind: "closeOut" }>> = {}): Extract<StripJob, { kind: "closeOut" }> => ({
  kind: "closeOut",
  pending: 0,
  converted: 0,
  guessed: 0,
  earliestDue: null,
  noItems: false,
  drafting: true,
  minutes: "none",
  canFinalize: true,
  canFollowUp: true,
  ...over,
});

const handlers: StripHandlers = {
  onJoin: vi.fn(),
  onEnd: vi.fn(),
  onReview: vi.fn(),
  onFinalize: vi.fn(),
  onEdit: vi.fn(),
  onFollowUpCreated: vi.fn(),
  hostName: "Hoàng Lan",
  clerkNames: ["Hoàng Lan"],
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  setSessionUser(demoUser("lan"));
  routeMeeting("m1", {
    extra: {
      [`${base}/attendance`]: { summary: { members: 7, present: 5, late: 1, excused: 0, absent: 1 }, rows: [] },
      [`${base}/recordings`]: {
        recordings: [{ id: "r1", meeting_id: meeting.id, status: "PROCESSING", started_at: "2026-10-23T06:02:00Z", ended_at: "2026-10-23T06:40:12Z" }],
      },
    },
  });
});

function renderCard(j = job()) {
  render(
    wrapWithNav(
      <DetailContext.Provider value={detailValue("m1", { user: "lan" })}>
        <MeetingJustEndedCard job={j} handlers={handlers} />
      </DetailContext.Provider>,
    ),
  );
}

describe("MeetingJustEndedCard (board E)", () => {
  it("says the meeting ended for everyone and counts what is left to close it out", async () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "Đã kết thúc cho mọi người" })).toBeInTheDocument();
    expect(await screen.findByText("Còn 4 việc để khép lại buổi họp")).toBeInTheDocument();
    expect(await screen.findByText("6/7 có mặt")).toBeInTheDocument();
    expect(screen.getByText("Thư ký UNI đang soạn")).toBeInTheDocument();
    expect(screen.getByText("có sau khi soạn xong")).toBeInTheDocument();
    expect(await screen.findByText("Bản ghi 38:12")).toBeInTheDocument();
  });

  it("finalizes attendance from the card", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Chốt" }));
    await waitFor(() =>
      expect(requestMock.mock.calls.some((c) => String(c[0]).endsWith("/attendance/finalize"))).toBe(true),
    );
  });

  it("offers to assign once the items are written", async () => {
    renderCard(job({ drafting: false, pending: 5, minutes: "draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Giao" }));
    expect(handlers.onReview).toHaveBeenCalledOnce();
    expect(screen.getByText("Giao 5 việc")).toBeInTheDocument();
  });
});
