import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPageContent } from "./chat-page-content";
import type { ChatPageContentProps } from "./chat-page-content-props";
import { wrap } from "../test/api-mock";

// The frame under test is the one line from the attach menu to the picker's
// open flag: everything around it is a stub.
vi.mock("./chat-sidebar", () => ({ ChatSidebar: () => null }));
vi.mock("./chat-thread-side-panel", () => ({ ChatThreadSidePanel: () => null }));
vi.mock("./chat-page-content-info", () => ({ ChatPageInfoPanel: () => null }));
vi.mock("./chat-page-content-sheets", () => ({ ChatPageContentSheets: () => null }));
vi.mock("./chat-person-card", () => ({ ChatPersonMessageProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./chat-voice-call-host", () => ({ useChatVoiceCall: () => ({ startCall: vi.fn() }) }));
vi.mock("./use-chat-person-actions", () => ({ useChatPersonActions: () => ({ messagePerson: vi.fn(), callPerson: vi.fn() }) }));
vi.mock("./use-chat-follow-up-ui", () => ({ useChatFollowUpUi: () => ({ openList: vi.fn(), onFollowUp: vi.fn(), sheet: null }) }));
vi.mock("./use-chat-followed-threads-ui", () => ({ useChatFollowedThreadsUi: () => ({ openList: vi.fn(), sheet: null }) }));
vi.mock("./use-chat-catch-up-ui", () => ({
  useChatCatchUpUi: () => ({ enabled: false, open: false, setOpen: vi.fn(), loading: false, requestCatchUp: vi.fn(), onCatchUp: vi.fn(), onRetry: vi.fn() }),
}));
vi.mock("./use-chat-page-panels", () => ({
  useChatPagePanels: () => ({
    sidebarCollapsed: false,
    sidebarRef: { current: null },
    conversationRef: { current: null },
    showMobileList: false,
    showMobileChat: true,
    handleTargetChange: vi.fn(),
    handleBackToConversationList: vi.fn(),
    handleToggleSidebar: vi.fn(),
    threadBeside: false,
    sideThread: null,
    setSideThread: vi.fn(),
    infoOpen: false,
    infoDocked: false,
    setInfoOpen: vi.fn(),
  }),
}));
vi.mock("./chat-realtime-status-banner", () => ({ ChatRealtimeStatusBanner: () => null }));
vi.mock("./chat-notice", () => ({ ChatConversationNotices: () => null }));
vi.mock("./chat-page-empty-conversation", () => ({
  ChatFrameListToggle: () => null,
  ChatPageEmptyConversation: () => <p>no room</p>,
}));
vi.mock("./chat-page-conversation", () => ({
  ChatPageConversation: ({ onAttachAction }: { onAttachAction: (action: string) => void }) => (
    <button type="button" onClick={() => onAttachAction("attach_document")}>
      attach document
    </button>
  ),
}));
vi.mock("./chat-page-content-dialogs", () => ({
  ChatPageContentDialogs: (props: { documentPickerOpen: boolean; onDocumentPickerOpenChange: (open: boolean) => void }) => (
    <div data-testid="dialogs" data-picker-open={String(props.documentPickerOpen)}>
      <button type="button" onClick={() => props.onDocumentPickerOpenChange(false)}>
        close picker
      </button>
    </div>
  ),
}));

function renderPage(activeRoomId: string | null) {
  const props = {
    target: { kind: "workspace" },
    setTarget: vi.fn(),
    currentUserId: "u1",
    headerTitle: "Chung",
    contacts: [],
    groups: [],
    channels: [],
    workspaceId: "ws1",
    activeRoomId,
    showLoading: false,
    isWorkspaceError: false,
    unreadBadgesReady: true,
    mentionCandidates: [],
    memberAvatarByUserId: {},
    workspaceMembers: [],
    groupMemberProfiles: {},
    onComposerPriorityChange: vi.fn(),
    onGroupSettingsOpenChange: vi.fn(),
    onChannelSettingsOpenChange: vi.fn(),
    onWorkspaceSettingsOpenChange: vi.fn(),
    onMessageSearchOpenChange: vi.fn(),
    onJumpToMessageIdChange: vi.fn(),
    t: (key: string) => key,
  };
  render(wrap(<ChatPageContent {...(props as unknown as ChatPageContentProps)} />));
}

describe("ChatPageContent attach from Documents", () => {
  it("opens the document picker when the attach menu asks for a document", () => {
    renderPage("room1");
    expect(screen.getByTestId("dialogs")).toHaveAttribute("data-picker-open", "false");
    fireEvent.click(screen.getByRole("button", { name: "attach document" }));
    expect(screen.getByTestId("dialogs")).toHaveAttribute("data-picker-open", "true");
    fireEvent.click(screen.getByRole("button", { name: "close picker" }));
    expect(screen.getByTestId("dialogs")).toHaveAttribute("data-picker-open", "false");
  });

  it("offers no composer, so no way to open the picker, without an open room", () => {
    renderPage(null);
    expect(screen.queryByRole("button", { name: "attach document" })).not.toBeInTheDocument();
    expect(screen.getByTestId("dialogs")).toHaveAttribute("data-picker-open", "false");
  });
});
