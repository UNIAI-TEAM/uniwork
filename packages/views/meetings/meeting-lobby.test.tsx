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
    expect(lobbyMessage(t, undefined, new ApiError("x", "join_request_rejected", 403))).toBe(
      "meetings.joinRequestRejected",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "invite_link_revoked", 403))).toBe(
      "meetings.publicInviteInvalidLink",
    );
    expect(lobbyMessage(t, undefined, new ApiError("x", "invite_link_expired", 403))).toBe(
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
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("offers to ask again after the host declined", () => {
    const onRequestAgain = vi.fn();
    render(
      wrapWithNav(
        <MeetingLobby
          decision="WAITING_APPROVAL"
          error={new ApiError("x", "join_request_rejected", 403)}
          onRequestAgain={onRequestAgain}
          onLeave={() => {}}
        />,
      ),
    );

    expect(screen.getByText("Người chủ trì đã từ chối yêu cầu vào phòng của bạn.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xin vào lại" }));
    expect(onRequestAgain).toHaveBeenCalledOnce();
  });

  it("locks the ask-again button while the request is on its way", () => {
    render(
      wrapWithNav(
        <MeetingLobby
          decision={undefined}
          error={new ApiError("x", "join_request_rejected", 403)}
          onRequestAgain={() => {}}
          requestingAgain
          onLeave={() => {}}
        />,
      ),
    );

    expect(screen.getByRole("button", { name: "Xin vào lại" })).toBeDisabled();
  });

  it("stops the waiting spinner once the join has failed for good", () => {
    render(
      wrapWithNav(
        <MeetingLobby
          decision="WAITING_APPROVAL"
          error={new ApiError("x", "meeting_ended", 403)}
          onLeave={() => {}}
        />,
      ),
    );

    expect(screen.getByText("Cuộc họp đã kết thúc")).toBeInTheDocument();
    expect(screen.queryByText(/Trang này sẽ tự cập nhật/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xin vào lại" })).not.toBeInTheDocument();
  });

  it("shows the approval wait copy after a join request is sent", () => {
    render(
      wrapWithNav(
        <MeetingLobby
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
        <MeetingLobby decision="WAITING_FOR_HOST" error={undefined} onLeave={() => {}} />,
      ),
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("gives an ended meeting a way back instead of a hang-up button", () => {
    const onLeave = vi.fn();
    render(
      wrapWithNav(
        <MeetingLobby title="Standup" decision={undefined} error={new ApiError("x", "meeting_ended", 403)} onLeave={onLeave} />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Cuộc họp đã kết thúc" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rời phòng" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("offers a retry for a join that failed for an unknown reason", () => {
    const onRetry = vi.fn();
    render(
      wrapWithNav(
        <MeetingLobby decision={undefined} error={new ApiError("lỗi nội bộ", "internal", 500)} onRetry={onRetry} onLeave={() => {}} />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("never shows a guest infrastructure names or raw server text", () => {
    const { rerender } = render(
      wrapWithNav(
        <MeetingLobby guestMode decision={undefined} error={new ApiError("x", "livekit_not_configured", 503)} onLeave={() => {}} />,
      ),
    );
    expect(screen.queryByText(/LiveKit/)).not.toBeInTheDocument();
    expect(screen.getByText("Phòng họp chưa sẵn sàng. Thử lại sau ít phút.")).toBeInTheDocument();

    rerender(
      wrapWithNav(
        <MeetingLobby guestMode decision={undefined} error={new ApiError("pq: deadlock detected", "internal", 500)} onLeave={() => {}} />,
      ),
    );
    expect(screen.queryByText(/deadlock/)).not.toBeInTheDocument();
  });

  it("names the host wait for what it is", () => {
    render(wrapWithNav(<MeetingLobby decision="WAITING_FOR_HOST" error={undefined} onLeave={() => {}} />));
    expect(screen.getByText("Đang chờ người chủ trì")).toBeInTheDocument();
    expect(screen.queryByText("Sẵn sàng vào họp")).not.toBeInTheDocument();
  });
});
