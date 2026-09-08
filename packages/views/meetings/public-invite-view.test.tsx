import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
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
    expect(screen.getByRole("button", { name: "Vào cuộc họp" })).toBeDisabled();
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
  });
});
