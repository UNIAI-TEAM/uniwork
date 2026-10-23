import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ChatMessage } from "./chat-messages";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import { ChatPageEmptyConversation } from "./chat-page-empty-conversation";
import { wrap } from "../test/api-mock";
import { isUrlRoomPending, useChatPagePanels } from "./use-chat-page-panels";

const group = { id: "g1", name: "Design", room_id: "room-g1", member_user_ids: ["u3"] };

/*
 * A frame shaped like ChatPageContent: a list with one row per room, and a
 * conversation pane whose title (or empty state) stands in for the toolbar.
 * No navigation provider: the hook keeps the open room locally.
 */
function Frame() {
  const [target, setTarget] = useState<ChatSidebarTarget>({ kind: "workspace" });
  const activeRoomId = target.kind === "group" ? target.group.room_id : "room-ws";
  const panels = useChatPagePanels({
    setTarget,
    activeRoomId,
    workspaceRoomId: "room-ws",
    contacts: [],
    groups: [group],
    channels: [],
    roomsReady: true,
    showLoading: false,
  });
  return (
    <>
      <div ref={panels.sidebarRef} data-testid="list" data-visible={String(panels.showMobileList)}>
        <button
          type="button"
          data-chat-sidebar-row="0"
          aria-current={target.kind === "workspace" ? "true" : undefined}
          onClick={() => panels.handleTargetChange({ kind: "workspace" })}
        >
          Chung
        </button>
        <button
          type="button"
          data-chat-sidebar-row="1"
          aria-current={target.kind === "group" ? "true" : undefined}
          onClick={() => panels.handleTargetChange({ kind: "group", group })}
        >
          Design
        </button>
        {panels.sidebarCollapsed ? null : (
          <button type="button" data-chat-sidebar-collapse="" onClick={panels.handleToggleSidebar}>
            Ẩn
          </button>
        )}
      </div>
      <div ref={panels.conversationRef} data-testid="conversation" data-visible={String(panels.showMobileChat)}>
        {panels.sidebarCollapsed ? (
          <ChatPageEmptyConversation
            t={(key) => initI18n().t(key)}
            listHidden
            onShowList={panels.handleToggleSidebar}
          />
        ) : (
          <>
            <h2 tabIndex={-1} data-chat-conversation-title="">
              {target.kind === "group" ? "Design" : "Chung"}
            </h2>
            <button type="button" onClick={panels.handleBackToConversationList}>
              Về danh sách
            </button>
          </>
        )}
      </div>
    </>
  );
}

const initialWidth = window.innerWidth;

beforeAll(() => {
  initI18n();
});

afterEach(() => {
  act(() => {
    window.innerWidth = initialWidth;
  });
});

describe("useChatPagePanels", () => {
  it("on a phone, opening a room shows it and focuses its title; back returns focus to the row", () => {
    window.innerWidth = 375;
    render(wrap(<Frame />));
    expect(screen.getByTestId("list")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("conversation")).toHaveAttribute("data-visible", "false");

    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    expect(screen.getByTestId("conversation")).toHaveAttribute("data-visible", "true");
    expect(screen.getByRole("heading", { name: "Design" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Về danh sách" }));
    expect(screen.getByTestId("list")).toHaveAttribute("data-visible", "true");
    expect(screen.getByRole("button", { name: "Design" })).toHaveFocus();
  });

  it("on a wide screen, hiding the list focuses the way back, and showing it focuses the hide control", () => {
    render(wrap(<Frame />));
    fireEvent.click(screen.getByRole("button", { name: "Ẩn" }));
    const show = screen.getByRole("button", { name: "Hiện danh sách trò chuyện" });
    expect(show).toHaveFocus();
    // With the list hidden the copy does not point at it.
    expect(screen.getByText("Danh sách trò chuyện đang ẩn. Hiện lại để mở một cuộc trò chuyện.")).toBeInTheDocument();

    fireEvent.click(show);
    expect(screen.getByRole("button", { name: "Ẩn" })).toHaveFocus();
  });

  describe("side thread", () => {
    const ROOT = { id: "m1", body: "Kịch bản bản 2", sender: "u2", ts: 0 } as unknown as ChatMessage;
    function renderPanels() {
      return renderHook(
        ({ room }) =>
          useChatPagePanels({
            setTarget: () => undefined,
            activeRoomId: room,
            workspaceRoomId: "room-ws",
            contacts: [],
            groups: [group],
            channels: [],
            roomsReady: true,
            showLoading: false,
          }),
        { initialProps: { room: "room-ws" }, wrapper: ({ children }) => wrap(<>{children}</>) },
      );
    }

    it("from lg keeps an opened thread beside the timeline until it is closed or the room changes", () => {
      const { result, rerender } = renderPanels();
      expect(result.current.threadBeside).toBe(true);

      act(() => result.current.setSideThread(ROOT));
      expect(result.current.sideThread).toBe(ROOT);
      act(() => result.current.setSideThread(null));
      expect(result.current.sideThread).toBeNull();

      act(() => result.current.setSideThread(ROOT));
      rerender({ room: "room-g1" });
      expect(result.current.sideThread).toBeNull();
    });

    it("below lg has no side panel: threads open in place", () => {
      window.innerWidth = 375;
      const { result } = renderPanels();
      expect(result.current.threadBeside).toBe(false);
      act(() => result.current.setSideThread(ROOT));
      expect(result.current.sideThread).toBeNull();
    });

    describe("info panel", () => {
      afterEach(() => localStorage.removeItem("uniwork_chat_info_panel"));

      it("docks open on a wide screen and remembers on this device that it was closed", () => {
        const first = renderPanels();
        expect(first.result.current.infoDocked).toBe(true);
        expect(first.result.current.infoOpen).toBe(true);
        act(() => first.result.current.setInfoOpen(false));
        expect(first.result.current.infoOpen).toBe(false);
        first.unmount();

        const again = renderPanels();
        expect(again.result.current.infoOpen).toBe(false);
        act(() => again.result.current.setInfoOpen(true));
        expect(localStorage.getItem("uniwork_chat_info_panel")).toBeNull();
      });

      it("below lg slides over the conversation only when asked, and a room switch closes it", () => {
        window.innerWidth = 375;
        const { result, rerender } = renderPanels();
        expect(result.current.infoDocked).toBe(false);
        expect(result.current.infoOpen).toBe(false);
        act(() => result.current.setInfoOpen(true));
        expect(result.current.infoOpen).toBe(true);
        rerender({ room: "room-g1" });
        expect(result.current.infoOpen).toBe(false);
        // The overlay never touches the docked choice.
        expect(localStorage.getItem("uniwork_chat_info_panel")).toBeNull();
      });
    });
  });
});

describe("isUrlRoomPending", () => {
  const base = { targetKind: "workspace" as const, urlRoomId: "room-g1", workspaceRoomId: "room-ws", roomsLoaded: false, roomIds: [] };

  it("keeps the workspace room closed while the URL's room is still being found", () => {
    expect(isUrlRoomPending(base)).toBe(true);
    expect(isUrlRoomPending({ ...base, roomsLoaded: true, roomIds: ["room-g1"] })).toBe(true);
  });

  it("lets it open once the URL names it, names nothing, or names a room that is gone", () => {
    expect(isUrlRoomPending({ ...base, urlRoomId: "room-ws" })).toBe(false);
    expect(isUrlRoomPending({ ...base, urlRoomId: null })).toBe(false);
    expect(isUrlRoomPending({ ...base, roomsLoaded: true, roomIds: ["room-other"] })).toBe(false);
  });

  it("never holds a room that is already the target", () => {
    expect(isUrlRoomPending({ ...base, targetKind: "group" })).toBe(false);
  });
});
