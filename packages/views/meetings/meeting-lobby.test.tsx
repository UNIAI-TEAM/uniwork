import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { lobbyMessage, MeetingLobby } from "./meeting-lobby";

const t = (key: string) => key;

beforeAll(() => {
  initI18n();
});

describe("lobbyMessage", () => {
  it("maps api error codes to lobby copy", () => {
    expect(lobbyMessage(t, undefined, new ApiError("x", "livekit_not_configured", 503))).toBe(
      "meetings.notConfigured",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "meeting_not_started", 403))).toBe(
      "meetings.waitingForHost",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "meeting_ended", 403))).toBe(
      "meetings.endedCannotJoin",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "meeting_past_scheduled_end", 403))).toBe(
      "meetings.pastScheduledEnd",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "meeting_canceled", 403))).toBe(
      "meetings.canceledCannotJoin",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "unauthorized", 401))).toBe(
      "meetings.loginRequired",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "access_grant_not_found", 403))).toBe(
      "meetings.loginRequired",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "invite_link_invalid", 403))).toBe(
      "meetings.publicInviteInvalidLink",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "invite_link_limit_reached", 403))).toBe(
      "meetings.publicInviteInvalidLink",
    );
    expect(lobbyMessage(t, undefined, new ApiError("Server message", "other", 500))).toBe(
      "Server message",
    );
    expect(lobbyMessage(t, undefined, new ApiError("", "other", 500))).toBe("common.error");
  });

  it("maps join decisions when there is no transport error", () => {
    expect(lobbyMessage(t, "WAITING_FOR_HOST", undefined)).toBe("meetings.waitingForHost");
    expect(lobbyMessage(t, "WAITING_APPROVAL", undefined)).toBe("meetings.waitingApproval");
    expect(lobbyMessage(t, "WAITING_FOR_PROVIDER", undefined)).toBe("meetings.waitingForProvider");
    expect(lobbyMessage(t, "DENY", undefined)).toBe("meetings.denied");
    expect(lobbyMessage(t, "ADMIT", undefined)).toBe("common.error");
  });
});

describe("MeetingLobby", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it("shows host start and join-request actions", () => {
    const onStart = vi.fn();
    const onLeave = vi.fn();
    render(
      wrapWithNav(
        <MeetingLobby
          meetingId="m1"
          title="Standup"
          decision="WAITING_FOR_HOST"
          error={undefined}
          canStart
          onStart={onStart}
          onLeave={onLeave}
        />,
      ),
    );

    expect(screen.getByText("Standup")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu" }));
    expect(onStart).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Rời phòng" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("offers a join request after denial", () => {
    render(
      wrapWithNav(
        <MeetingLobby
          meetingId="m1"
          decision="DENY"
          error={undefined}
          allowJoinRequest
          onLeave={() => {}}
        />,
      ),
    );

    expect(screen.getByRole("button", { name: "Xin vào phòng" })).toBeInTheDocument();
    expect(screen.queryByText("Đã gửi yêu cầu. Đang chờ chủ trì.")).not.toBeInTheDocument();
  });

  it("shows the approval wait copy after a join request is sent", () => {
    render(
      wrapWithNav(
        <MeetingLobby
          meetingId="m1"
          decision="WAITING_APPROVAL"
          error={undefined}
          onLeave={() => {}}
        />,
      ),
    );

    expect(
      screen.getByText("Vui lòng đợi cho đến khi người chủ trì đưa bạn vào cuộc họp. Trang này sẽ tự cập nhật."),
    ).toBeInTheDocument();
  });

  it("renders without a title line when none is provided", () => {
    render(
      wrapWithNav(
        <MeetingLobby meetingId="m1" decision="WAITING_FOR_HOST" error={undefined} onLeave={() => {}} />,
      ),
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
