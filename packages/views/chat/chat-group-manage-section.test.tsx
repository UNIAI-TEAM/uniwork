import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatGroupManageSection } from "./chat-group-manage-section";

vi.mock("@uniwork/core/chat", () => ({
  useUpdateChatRoomSettings: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

beforeAll(() => {
  initI18n();
});

describe("ChatGroupManageSection", () => {
  it("lists member permission toggles", () => {
    render(
      wrap(
        <ChatGroupManageSection
          workspaceId="ws1"
          roomId="room1"
          canManage
          permissions={{
            allow_change_profile: true,
            allow_pin_content: true,
            allow_create_notes: true,
            allow_create_polls: true,
            allow_send_messages: true,
          }}
        />,
      ),
    );

    expect(screen.getByText("Cho phép các thành viên trong nhóm:")).toBeInTheDocument();
    expect(screen.getByText("Gửi tin nhắn")).toBeInTheDocument();
  });
});
