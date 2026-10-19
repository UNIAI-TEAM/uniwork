import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { NavigationProvider } from "../navigation";
import { fakeNav } from "../test/api-mock";
import { chatScopeOf, useChatScope } from "./chat-scope";
import type { ChatSidebarTarget } from "./chat-sidebar-types";

const room = (id: string, kind: ChatRoomRecord["kind"], at: string) =>
  ({ id, kind, name: id, workspace_id: "ws1", member_user_ids: [], member_count: 0, unread_count: 0, mention_unread_count: 0, last_message_at: at }) as ChatRoomRecord;

const contact = { user_id: "u2", email: "", display_name: "Hà", dm_room_id: "dm1" };
const group = { id: "g1", name: "Thiết kế", room_id: "g1", member_user_ids: [] };
const rooms = [room("dm1", "dm", "2026-10-19T01:00:00Z"), room("g1", "group", "2026-10-19T02:00:00Z"), room("ch1", "channel", "2026-10-19T03:00:00Z")];

function renderScope(url: string, target: ChatSidebarTarget, setTarget = vi.fn()) {
  const nav = fakeNav(url);
  const wrapper = ({ children }: { children: ReactNode }) => <NavigationProvider value={nav}>{children}</NavigationProvider>;
  const hook = renderHook(
    () => useChatScope({ target, setTarget, rooms, roomsReady: true, contacts: [contact], groups: [group] }),
    { wrapper },
  );
  return { ...hook, setTarget };
}

describe("chatScopeOf", () => {
  it("follows the explicit view, else the kind of the open room", () => {
    expect(chatScopeOf("messages", "channel")).toBe("messages");
    expect(chatScopeOf("channels", "dm")).toBe("workspace");
    expect(chatScopeOf(null, "dm")).toBe("messages");
    expect(chatScopeOf(null, "group")).toBe("messages");
    expect(chatScopeOf(null, "channel")).toBe("workspace");
    expect(chatScopeOf(null, undefined)).toBe("workspace");
  });
});

describe("useChatScope", () => {
  it("takes the scope from the open room when the URL names none", () => {
    expect(renderScope("/o/w/chat?room=dm1", { kind: "dm", contact }).result.current).toEqual({ scope: "messages", mismatch: false });
    expect(renderScope("/o/w/chat", { kind: "workspace" }).result.current).toEqual({ scope: "workspace", mismatch: false });
  });

  it("opens the most recent DM or group for ?view=messages, opening nothing meanwhile", () => {
    const { result, setTarget } = renderScope("/o/w/chat?view=messages", { kind: "workspace" });
    expect(result.current).toEqual({ scope: "messages", mismatch: true });
    expect(setTarget).toHaveBeenCalledWith({ kind: "group", group });
  });

  it("closes a DM for the workspace room on ?view=channels", () => {
    const { result, setTarget } = renderScope("/o/w/chat?view=channels", { kind: "dm", contact });
    expect(result.current).toEqual({ scope: "workspace", mismatch: true });
    expect(setTarget).toHaveBeenCalledWith({ kind: "workspace" });
  });
});
