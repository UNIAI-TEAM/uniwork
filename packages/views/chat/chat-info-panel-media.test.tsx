import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { ChatInfoMedia } from "./chat-info-panel-media";

initI18n();

const photo = (n: number) => ({
  message_id: `p${n}`,
  file_id: `f${n}`,
  title: `anh-${n}.png`,
  url: `https://s.test/${n}.png`,
  url_expires_at: "2099-01-01T00:00:00Z",
  created_at: `2026-10-1${n}T10:00:00Z`,
});

function serve(path: string): unknown {
  if (path.endsWith("/shared-summary")) {
    return {
      counts: { photo: 8, gif: 1, video: 0, file: 2, link: 1, voice: 1 },
      recent_photos: [1, 2, 3, 4, 5, 6].map(photo),
    };
  }
  if (path.includes("/messages")) {
    return {
      messages: [
        {
          id: "m-file",
          room_id: "room-1",
          workspace_id: "ws1",
          sender_id: "u2",
          sender_display_name: "Thu Hà",
          kind: "file",
          body: "ke-hoach.pdf",
          created_at: "2026-10-17T10:00:00Z",
          file: { filename: "ke-hoach.pdf", content_type: "application/pdf", size_bytes: 10, url: "https://s.test/f.pdf" },
        },
      ],
    };
  }
  return {};
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser({ id: "u1", email: "u1@unicom.vn", display_name: "Quang" } as User);
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => Promise.resolve(serve(path)));
});

const historyRequests = () => requestMock.mock.calls.filter(([path]) => String(path).includes("/messages"));

describe("ChatInfoMedia", () => {
  it("shows the summary's counts and newest photos without paging the history", async () => {
    const onJump = vi.fn();
    render(wrap(<ChatInfoMedia workspaceId="ws1" roomId="room-1" onJumpToMessage={onJump} />));

    expect(await screen.findByRole("button", { name: "Ảnh 8" }, { timeout: 5000 })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tệp 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Liên kết 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thoại 1" })).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "anh-1.png" }));
    expect(onJump).toHaveBeenCalledWith("p1");
    expect(historyRequests()).toHaveLength(0);
  });

  it("pages the history only once a list is opened", async () => {
    render(wrap(<ChatInfoMedia workspaceId="ws1" roomId="room-1" onJumpToMessage={vi.fn()} />));
    fireEvent.click(await screen.findByRole("button", { name: "Tệp 2" }, { timeout: 5000 }));

    expect(await screen.findByText("ke-hoach.pdf", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(historyRequests().length).toBeGreaterThan(0);
  });
});
