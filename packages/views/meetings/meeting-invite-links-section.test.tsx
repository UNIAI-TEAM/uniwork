import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingInviteLinksSection } from "./meeting-invite-links-section";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

const activeLink = {
  id: "l1",
  meeting_id: "m1",
  name: "Khách đối tác",
  access_mode: "AUTO_ADMIT",
  expires_at: "2099-01-01T00:00:00Z",
  used_count: 0,
  created_at: "2026-09-20T00:00:00Z",
};

describe("MeetingInviteLinksSection", () => {
  it("shows a loading skeleton, not the empty copy, while links load", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    render(wrapWithNav(<MeetingInviteLinksSection meetingId="m1" />));
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(/Chưa có liên kết cho khách/)).not.toBeInTheDocument();
  });

  it("says the load failed and retries instead of claiming there are no links", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("lỗi", "internal", 500));
    render(wrapWithNav(<MeetingInviteLinksSection meetingId="m1" />));
    expect(await screen.findByText("Không tải được liên kết mời.")).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có liên kết cho khách/)).not.toBeInTheDocument();

    requestMock.mockResolvedValueOnce({ invite_links: [] });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(/Chưa có liên kết cho khách/)).toBeInTheDocument();
  });

  it("offers revoke on an active link while the meeting is open", async () => {
    requestMock.mockResolvedValue({ invite_links: [activeLink] });
    render(wrapWithNav(<MeetingInviteLinksSection meetingId="m1" />));
    expect(await screen.findByRole("button", { name: "Thu hồi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tạo liên kết mới/ })).toBeInTheDocument();
  });

  it("reads links as closed once the meeting is over: no revoke, no create", async () => {
    requestMock.mockResolvedValue({ invite_links: [activeLink] });
    render(wrapWithNav(<MeetingInviteLinksSection meetingId="m1" canCreate={false} />));
    expect(await screen.findByText("Đã đóng")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Thu hồi" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Tạo liên kết mới/ })).not.toBeInTheDocument();
  });
});
