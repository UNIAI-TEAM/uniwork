import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";
import { initI18n } from "@uniwork/core/i18n";
import type { Member } from "@uniwork/core/types/workspace";
import { wrap } from "../test/api-mock";
import { ChatPageConversationIntro } from "./chat-page-conversation-toolbar";

beforeAll(() => {
  initI18n();
});

const member = (user_id: string, display_name: string): Member => ({
  workspace_id: "ws1",
  user_id,
  role: "member",
  email: `${user_id}@x.vn`,
  display_name,
});

describe("ChatPageConversationIntro", () => {
  it("names two people of the workspace room by their last two words and counts the rest, you included", () => {
    const members = [
      member("me", "Quang Phạm"),
      member("u1", "Nguyễn Thu Hà"),
      member("u2", "Võ Minh"),
      member("u3", "Hoàng Lan"),
    ];
    render(
      wrap(
        <ChatPageConversationIntro
          target={{ kind: "workspace" }}
          headerTitle="Truyền thông"
          activeChannel={null}
          nicknamesByUserId={{}}
          t={(key, options) => getI18n().t(key, options)}
          onViewMembers={() => undefined}
          onAddMembers={() => undefined}
          workspaceMembers={members}
          currentUserId="me"
          memberAvatarByUserId={{}}
        />,
      ),
    );
    expect(screen.getByText("Thu Hà, Võ Minh và 2 người khác")).toBeInTheDocument();
  });
});
