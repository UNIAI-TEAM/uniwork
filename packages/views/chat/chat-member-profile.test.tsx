import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrap } from "../test/api-mock";
import { ChatPersonMessageProvider } from "./chat-person-card";
import { ChatMemberRow } from "./chat-settings-ui";

initI18n();

describe("ChatMemberRow profile", () => {
  it("opens the address and a direct-message action", async () => {
    const onMessage = vi.fn();
    render(
      wrap(
        <ChatMemberRow
          avatar={<span aria-hidden>T</span>}
          name="Trà My Đào"
          detail="Quản trị phòng"
          profile={{ email: "dtramy28@gmail.com", onMessage }}
        />,
      ),
    );

    const opener = screen.getByRole("button", { name: "Xem thông tin của Trà My Đào" });
    expect(opener).toHaveClass("cursor-pointer");
    fireEvent.click(opener);
    expect(await screen.findByText("dtramy28@gmail.com")).toBeInTheDocument();
    expect(screen.getAllByText("Quản trị phòng").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Nhắn tin" }));
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("shows the address without a direct message for yourself", async () => {
    render(
      wrap(
        <ChatMemberRow
          avatar={<span aria-hidden>B</span>}
          name="Bạn"
          detail="longthldz@gmail.com"
          profile={{ email: "longthldz@gmail.com" }}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Bạn" }));
    expect((await screen.findAllByText("longthldz@gmail.com")).length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Nhắn tin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gọi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Video" })).not.toBeInTheDocument();
  });

  it("opens an empty shared list from the card", async () => {
    render(
      wrap(
        <ChatMemberRow
          avatar={<span aria-hidden>T</span>}
          name="Trà My Đào"
          profile={{ userId: "user-tra", email: "dtramy28@gmail.com" }}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Trà My Đào" }));
    fireEvent.click(await screen.findByRole("button", { name: "0 ảnh" }));
    expect(await screen.findByText("Chưa có gì ở đây.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(screen.getByRole("button", { name: "0 tệp" })).toBeInTheDocument();
  });

  it("lists photos from the conversation the avatar was opened in", async () => {
    const user: User = {
      id: "u1",
      email: "a@b.c",
      display_name: "An",
      onboarded_at: "2026-08-25T00:00:00Z",
      email_verified_at: "2026-08-25T00:00:00Z",
      onboarding_questionnaire: {},
      locale: "vi",
    };
    const workspace: Workspace = {
      id: "ws1",
      slug: "team",
      name: "Team",
      organization_id: "o1",
      organization_slug: "acme",
      organization_name: "Acme",
    };
    setSessionUser(user);
    requestMock.mockImplementation((path: string) => {
      if (String(path).includes("/rooms/dm-nam/messages")) {
        return Promise.resolve({
          messages: [
            {
              id: "secret",
              room_id: "dm-nam",
              workspace_id: "ws1",
              sender_id: "user-tra",
              sender_display_name: "Nam",
              kind: "file",
              body: "secret.pdf",
              created_at: "2026-10-15T02:00:00Z",
              file: { filename: "secret.pdf", content_type: "application/pdf", size_bytes: 4 },
            },
          ],
        });
      }
      if (String(path).includes("/rooms/room-chung/messages")) {
        return Promise.resolve({
          messages: [
            {
              id: "pic-huy",
              room_id: "room-chung",
              workspace_id: "ws1",
              sender_id: "user-huy",
              sender_display_name: "Huy",
              kind: "file",
              body: "huy.jpg",
              created_at: "2026-10-15T02:00:00Z",
              file: { filename: "huy.jpg", content_type: "image/jpeg", size_bytes: 4 },
            },
            {
              id: "pic-tra",
              room_id: "room-chung",
              workspace_id: "ws1",
              sender_id: "user-tra",
              sender_display_name: "Trà",
              kind: "file",
              body: "tra.jpg",
              created_at: "2026-10-15T02:01:00Z",
              file: { filename: "tra.jpg", content_type: "image/jpeg", size_bytes: 4 },
            },
          ],
        });
      }
      if (String(path).endsWith("/chat/rooms")) {
        return Promise.resolve({
          rooms: [
            { id: "room-chung", kind: "workspace", name: "Chung", workspace_id: "ws1", member_user_ids: ["user-tra"] },
            {
              id: "dm-nam",
              kind: "dm",
              name: "Nam",
              workspace_id: "ws1",
              member_user_ids: ["user-tra"],
              peer_user_id: "user-tra",
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    render(
      wrap(
        <WorkspaceProvider workspace={workspace} user={user}>
          <ChatPersonMessageProvider onMessage={null} roomId="room-chung">
            <ChatMemberRow
              avatar={<span aria-hidden>T</span>}
              name="Trà My Đào"
              profile={{ userId: "user-tra", email: "dtramy28@gmail.com" }}
            />
          </ChatPersonMessageProvider>
        </WorkspaceProvider>,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Trà My Đào" }));
    try {
      expect(await screen.findByRole("button", { name: "1 ảnh" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "0 tệp" })).toBeInTheDocument();
    } finally {
      resetAuthStoreForTests();
      requestMock.mockReset();
    }
  });

  it("rings a direct call from the card", async () => {
    const onCall = vi.fn();
    render(
      wrap(
        <ChatPersonMessageProvider onMessage={null} onCall={onCall}>
          <ChatMemberRow
            avatar={<span aria-hidden>T</span>}
            name="Trà My Đào"
            detail="Quản trị phòng"
            profile={{ userId: "user-tra", email: "dtramy28@gmail.com", onMessage: vi.fn() }}
          />
        </ChatPersonMessageProvider>,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Trà My Đào" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gọi" }));
    expect(onCall).toHaveBeenCalledWith("user-tra", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Trà My Đào" }));
    fireEvent.click(await screen.findByRole("button", { name: "Video" }));
    expect(onCall).toHaveBeenLastCalledWith("user-tra", { withCamera: true });
  });
});
