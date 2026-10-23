import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { ChatSidebarMessageResults } from "./chat-sidebar-message-results";

initI18n();

const contact: ChatContact = { user_id: "u2", display_name: "Trần Đức Anh", email: "da@x.vn", dm_room_id: "room-dm" };
const group = { id: "g1", name: "Ra mắt UniWork Q4", room_id: "room-g1", member_user_ids: ["u3"] };

const message = (id: string, roomId: string, sender: string, name: string, body: string) => ({
  id,
  room_id: roomId,
  workspace_id: "ws1",
  sender_id: sender,
  sender_display_name: name,
  kind: "text",
  body,
  created_at: "2026-10-19T05:04:00Z",
});

function resolve(roomId: string) {
  if (roomId === "room-dm") return { target: { kind: "dm" as const, contact }, title: contact.display_name };
  if (roomId === "room-g1") return { target: { kind: "group" as const, group }, title: group.name };
  return null;
}

function renderResults(nav = fakeNav("/unicom/tt/chat?view=messages")) {
  render(
    wrapWithNav(
      <ChatSidebarMessageResults
        workspaceId="ws1"
        scope="messages"
        query="ra mat"
        currentUserId="self"
        youLabel="Bạn"
        resolve={resolve}
      />,
      nav,
    ),
  );
  return nav;
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser({ id: "self", email: "self@x.vn", display_name: "Self" } as User);
  requestMock.mockReset();
});

describe("ChatSidebarMessageResults", () => {
  it("lists the matching messages of my rooms, the match marked, rooms the list cannot open left out", async () => {
    requestMock.mockResolvedValue({
      messages: [
        message("m1", "room-g1", "u3", "Nguyễn Thu Hà", "Nhóm ơi, chốt kịch bản ra mắt"),
        message("m2", "room-dm", "self", "Self", "Gửi anh kế hoạch ra mắt"),
        message("m3", "room-gone", "u9", "Ai đó", "ra mắt ở phòng đã rời"),
      ],
    });
    renderResults();
    const group = await screen.findByRole("button", { name: /Ra mắt UniWork Q4/ });
    // The start gives way so the match stays on the line.
    expect(group).toHaveTextContent(/Nguyễn Thu Hà: ….*kịch bản ra mắt$/);
    expect(group.querySelector("mark")).toHaveTextContent("ra mắt");
    // My own line says "Bạn"; a DM's other person goes unnamed.
    expect(screen.getByRole("button", { name: /Trần Đức Anh/ })).toHaveTextContent("Bạn: Gửi anh kế hoạch ra mắt");
    expect(screen.queryByText(/phòng đã rời/)).not.toBeInTheDocument();
    expect(String(requestMock.mock.calls[0]?.[0])).toContain("/chat/messages/search?q=ra+mat&scope=messages");
  });

  it("opens the room at the message, keeping where the reader is", async () => {
    requestMock.mockResolvedValue({ messages: [message("m1", "room-g1", "u3", "Hà", "ra mắt")] });
    const nav = renderResults();
    fireEvent.click(await screen.findByRole("button", { name: /Ra mắt UniWork Q4/ }));
    expect(nav.push).toHaveBeenCalledWith("/unicom/tt/chat?view=messages&room=room-g1&message=m1");
  });

  it("says when nothing matches", async () => {
    requestMock.mockResolvedValue({ messages: [] });
    renderResults();
    expect(await screen.findByText("Không có tin nhắn nào khớp.")).toBeInTheDocument();
  });
});
