import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { resetAuthStoreForTests, useAuthStore } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { MeetingPublicInviteView } from "./public-invite-view";

vi.mock("@uniwork/core/realtime", async (orig) => {
  const mod = await orig<typeof import("@uniwork/core/realtime")>();
  return {
    ...mod,
    MeetingLobbyWSProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

beforeAll(() => {
  initI18n();
});

function fakeNav(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/invite/meeting/link-1",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
}

const RESOLVE = "/api/v1/public/meeting-invite-links/resolve";

function resolved(extra: Record<string, unknown> = {}) {
  return {
    link_id: "link-1",
    meeting_id: "m1",
    title: "Standup",
    starts_at: "2026-09-10T02:00:00Z",
    access_mode: "AUTO_ADMIT",
    expired: false,
    ...extra,
  };
}

beforeEach(() => {
  resetAuthStoreForTests();
  useAuthStore.setState({ user: null, status: "anon" });
  requestMock.mockReset();
  sessionStorage.clear();
});

describe("MeetingPublicInviteView", () => {
  it("shows guest join form instead of redirecting to login", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/api/v1/public/meeting-invite-links/resolve" && opts?.method === "POST") {
        return Promise.resolve({
          link_id: "link-1",
          meeting_id: "m1",
          title: "Standup",
          starts_at: "2026-09-10T02:00:00Z",
          access_mode: "AUTO_ADMIT",
          expired: false,
        });
      }
      return Promise.resolve(null);
    });

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByRole("heading", { name: "Standup" })).toBeInTheDocument();
    expect(screen.getByText("Lời mời họp")).toBeInTheDocument();
    expect(screen.getByLabelText("Tên hiển thị")).toBeInTheDocument();
    expect(screen.queryByText("Đang chuyển tới trang đăng nhập…")).not.toBeInTheDocument();
    // Enabled on purpose: an empty name is explained on submit, not by a dead button.
    expect(screen.getByRole("button", { name: "Vào cuộc họp" })).toBeEnabled();
    expect(document.title).toBe("Lời mời họp · Standup · UniWork");
  });

  it("explains a missing name inline and focuses the field instead of joining", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === RESOLVE ? resolved() : null),
    );

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    const input = await screen.findByLabelText("Tên hiển thị");
    expect(input).toBeRequired();
    fireEvent.click(screen.getByRole("button", { name: "Vào cuộc họp" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nhập tên hiển thị để tham gia");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(input).toHaveFocus();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/join", expect.anything());

    fireEvent.change(input, { target: { value: "Khách A" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows how guests get in as visible text, not only in a tooltip", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === RESOLVE ? resolved({ access_mode: "REQUEST_APPROVAL" }) : null),
    );

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByText("Khách chờ chủ trì duyệt trước khi vào phòng.")).toBeVisible();
  });

  it("joins as guest and navigates to the invite room", async () => {
    const adapter = fakeNav();
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/api/v1/public/meeting-invite-links/resolve" && opts?.method === "POST") {
        return Promise.resolve({
          link_id: "link-1",
          meeting_id: "m1",
          title: "Standup",
          starts_at: "2026-09-10T02:00:00Z",
          access_mode: "AUTO_ADMIT",
          expired: false,
        });
      }
      if (path === "/api/v1/meetings/m1/join" && opts?.method === "POST") {
        const body = opts.body as { display_name?: string; invite_link_id?: string; secret?: string };
        expect(body.display_name).toBe("Khách A");
        expect(body.invite_link_id).toBe("link-1");
        expect(body.secret).toBe("sec-abc");
        return Promise.resolve({
          decision: "ADMIT",
          participant_token: "tok",
          server_url: "wss://lk.example",
          provider: "livekit",
        });
      }
      return Promise.resolve(null);
    });

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, adapter));

    const nameInput = await screen.findByLabelText("Tên hiển thị");
    fireEvent.change(nameInput, { target: { value: "Khách A" } });
    fireEvent.click(screen.getByRole("button", { name: "Vào cuộc họp" }));

    await waitFor(() => {
      expect(adapter.push).toHaveBeenCalledWith(paths.meetingInviteRoom("link-1"));
    });
    expect(sessionStorage.getItem("uw.meeting-invite.link-1.preJoinChoice")).toContain('"video":false');
  });

  it("stores camera-on when the guest turns the camera on before joining", async () => {
    const adapter = fakeNav();
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/api/v1/public/meeting-invite-links/resolve" && opts?.method === "POST") {
        return Promise.resolve({
          link_id: "link-1",
          meeting_id: "m1",
          title: "Standup",
          starts_at: "2026-09-10T02:00:00Z",
          access_mode: "AUTO_ADMIT",
          expired: false,
        });
      }
      if (path === "/api/v1/meetings/m1/join" && opts?.method === "POST") {
        return Promise.resolve({
          decision: "ADMIT",
          participant_token: "tok",
          server_url: "wss://lk.example",
          provider: "livekit",
        });
      }
      return Promise.resolve(null);
    });

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, adapter));

    const nameInput = await screen.findByLabelText("Tên hiển thị");
    fireEvent.change(nameInput, { target: { value: "Khách A" } });
    expect(screen.getByRole("button", { name: "Camera", pressed: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bật camera để xem trước" }));
    expect(screen.getByRole("button", { name: "Camera", pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vào cuộc họp" }));

    await waitFor(() => {
      expect(adapter.push).toHaveBeenCalledWith(paths.meetingInviteRoom("link-1"));
    });
    expect(JSON.parse(sessionStorage.getItem("uw.meeting-invite.link-1.preJoinChoice") ?? "{}")).toEqual({
      audio: true,
      video: true,
    });
  });

  it("shows the invalid-link card when the server refuses the link", async () => {
    requestMock.mockRejectedValue(new ApiError("liên kết không hợp lệ", "invite_link_invalid", 404));

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByText("Liên kết không hợp lệ hoặc đã bị thu hồi")).toBeInTheDocument();
    expect(screen.queryByText("Đang tải…")).not.toBeInTheDocument();
  });

  it("offers a retry when the link cannot be reached, and loads the invite on retry", async () => {
    requestMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === RESOLVE ? resolved() : null),
    );

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByRole("heading", { name: "Chưa tải được lời mời" })).toBeInTheDocument();
    expect(screen.getByText("Kiểm tra kết nối mạng rồi thử lại.")).toBeInTheDocument();
    expect(screen.queryByText("Mở lại đúng liên kết đã nhận, hoặc xin chủ trì gửi liên kết mới.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(await screen.findByRole("heading", { name: "Standup" })).toBeInTheDocument();
  });

  it("says a revoked link was revoked, not that it expired", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === RESOLVE ? resolved({ expired: true, link_state: "revoked" }) : null),
    );

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByRole("heading", { name: "Liên kết đã bị thu hồi" })).toBeInTheDocument();
    expect(document.title).toBe("Liên kết đã bị thu hồi · UniWork");
  });

  it("still reads an older server's expired flag", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === RESOLVE ? resolved({ expired: true }) : null),
    );

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByRole("heading", { name: "Liên kết này đã hết hạn" })).toBeInTheDocument();
  });

  it("says a spent link is out of uses", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === RESOLVE ? resolved({ link_state: "exhausted" }) : null),
    );

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByRole("heading", { name: "Liên kết đã hết lượt dùng" })).toBeInTheDocument();
  });

  it("shows an ended meeting before the guest types a name", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === RESOLVE ? resolved({ link_state: "active", meeting_state: "ended" }) : null),
    );

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByRole("heading", { name: "Cuộc họp đã kết thúc" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Tên hiển thị")).not.toBeInTheDocument();
  });

  it("turns a refused join into a localized screen, never the server's own sentence", async () => {
    await setLocale("en");
    try {
      requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
        if (path === RESOLVE) return Promise.resolve(resolved());
        if (path === "/api/v1/meetings/m1/join" && opts?.method === "POST") {
          return Promise.reject(new ApiError("cuộc họp đã bị huỷ", "meeting_canceled", 403));
        }
        return Promise.resolve(null);
      });

      render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

      fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Guest A" } });
      fireEvent.click(screen.getByRole("button", { name: "Join meeting" }));

      expect(await screen.findByRole("heading", { name: "This meeting was canceled" })).toBeInTheDocument();
      expect(screen.queryByText("cuộc họp đã bị huỷ")).not.toBeInTheDocument();
    } finally {
      await setLocale("vi");
    }
  });

  it("does not spin forever after a signed-in visitor's join fails", async () => {
    useAuthStore.setState({
      status: "authed",
      user: { id: "u1", email: "a@example.com", display_name: "An" } as never,
    });
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === RESOLVE) return Promise.resolve(resolved());
      if (path === "/api/v1/meetings/m1/join" && opts?.method === "POST") {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
      return Promise.resolve(null);
    });

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    expect(await screen.findByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    expect(screen.queryByText("Đang tải…")).not.toBeInTheDocument();
    expect(screen.queryByText("Đang vào…")).not.toBeInTheDocument();
  });

  it("lets a declined guest ask the host again", async () => {
    const joinBodies: Array<Record<string, unknown>> = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/api/v1/public/meeting-invite-links/resolve") {
        return Promise.resolve({
          link_id: "link-1",
          meeting_id: "m1",
          title: "Standup",
          starts_at: "2026-09-10T02:00:00Z",
          access_mode: "REQUEST_APPROVAL",
          expired: false,
        });
      }
      if (path === "/api/v1/meetings/m1/join" && opts?.method === "POST") {
        const body = opts.body as Record<string, unknown>;
        joinBodies.push(body);
        if (!body.request_again) {
          return Promise.reject(new ApiError("từ chối", "join_request_rejected", 403));
        }
        return Promise.resolve({ decision: "WAITING_APPROVAL", join_request_id: "jr-2" });
      }
      return Promise.resolve(null);
    });

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, fakeNav()));

    fireEvent.change(await screen.findByLabelText("Tên hiển thị"), { target: { value: "Khách A" } });
    fireEvent.click(screen.getByRole("button", { name: "Xin vào phòng" }));

    fireEvent.click(await screen.findByRole("button", { name: "Xin vào lại" }));

    expect(
      await screen.findByText("Người chủ trì sẽ đưa bạn vào cuộc họp. Trang này tự cập nhật."),
    ).toBeInTheDocument();
    expect(joinBodies.at(-1)?.request_again).toBe(true);
  });

  it("Back from the waiting lobby cancels the request and brings the form back", async () => {
    const adapter = fakeNav();
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === RESOLVE) return Promise.resolve(resolved({ access_mode: "REQUEST_APPROVAL" }));
      if (path === "/api/v1/meetings/m1/join" && opts?.method === "POST") {
        return Promise.resolve({ decision: "WAITING_APPROVAL", join_request_id: "jr-1" });
      }
      if (path === "/api/v1/meeting-join-requests/jr-1/cancel") {
        return Promise.reject(new ApiError("đã xử lý", "join_request_already_decided", 409));
      }
      return Promise.resolve(null);
    });

    render(wrapWithNav(<MeetingPublicInviteView linkId="link-1" secret="sec-abc" />, adapter));

    fireEvent.change(await screen.findByLabelText("Tên hiển thị"), { target: { value: "Khách A" } });
    fireEvent.click(screen.getByRole("button", { name: "Xin vào phòng" }));

    // The waiting lobby keeps the invite chrome: logo, language switch, <main>.
    await screen.findByText("Người chủ trì sẽ đưa bạn vào cuộc họp. Trang này tự cập nhật.");
    const waitingHeading = screen.getByRole("heading", { name: "Standup" });
    expect(screen.getByRole("main")).toContainElement(waitingHeading);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(waitingHeading).toHaveFocus();
    expect(document.title).toBe("Đang chờ tham gia · Standup · UniWork");

    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));

    expect(await screen.findByLabelText("Tên hiển thị")).toHaveValue("Khách A");
    expect(screen.getByRole("button", { name: "Xin vào phòng" })).toBeEnabled();
    expect(requestMock).toHaveBeenCalledWith("/api/v1/meeting-join-requests/jr-1/cancel", { method: "POST" });
    expect(adapter.replace).not.toHaveBeenCalled();
    expect(adapter.push).not.toHaveBeenCalled();
    expect(screen.queryByText("Người chủ trì sẽ đưa bạn vào cuộc họp. Trang này tự cập nhật.")).not.toBeInTheDocument();
  });
});
