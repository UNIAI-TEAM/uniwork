import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingParticipantsSection } from "./meeting-participants-section";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  starts_at: "2026-09-22T02:00:00Z",
  ends_at: "2026-09-22T02:30:00Z",
  status: "SCHEDULED",
  host_user_id: "u-host",
} as Meeting;

function participantsRespond(participants: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/participants")) return participants();
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    return Promise.resolve({});
  });
}

const EMPTY = "Chưa có ai trong phòng.";

function renderSection() {
  render(
    wrapWithNav(
      <MeetingParticipantsSection workspaceId="w1" meeting={meeting} invitations={[]} canManage={false} />,
    ),
  );
}

describe("MeetingParticipantsSection", () => {
  it("shows a loading skeleton, not the empty copy, while participants load", () => {
    participantsRespond(() => new Promise(() => {}));
    renderSection();

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("shows the empty copy once an empty list arrives", async () => {
    participantsRespond(() => Promise.resolve({ participants: [] }));
    renderSection();

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when participants fail", async () => {
    participantsRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    renderSection();

    expect(await screen.findByText("Không tải được danh sách người tham dự.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

    participantsRespond(() => Promise.resolve({ participants: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });
});
