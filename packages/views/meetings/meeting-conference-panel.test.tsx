import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { MeetingConference } from "./meeting-conference";

/**
 * How the conference hosts its side panel: docked with a collapse button on a
 * desktop, a bottom sheet on a phone, and the stage's vote prompt stands down
 * while the Votes tab shows the same ballot.
 */
const view = vi.hoisted(() => ({ compact: false }));
const live = vi.hoisted(() => ({ count: 0 }));

vi.mock("@uniwork/ui/hooks/use-mobile", () => ({
  useIsMobile: () => view.compact,
  useIsCompact: () => view.compact,
}));
vi.mock("@livekit/components-react", () => ({
  RoomAudioRenderer: () => null,
  StartMediaButton: () => null,
  useIsRecording: () => false,
  useParticipants: () => [],
  useRemoteParticipants: () => [],
  useSpeakingParticipants: () => [],
  useTracks: () => [],
  isTrackReference: (t: { publication?: unknown }) => Boolean(t.publication),
}));
vi.mock("./use-meeting-signals", () => ({
  MeetingSignalsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./meeting-room-avatars", () => ({
  MeetingRoomAvatarsProvider: ({ children }: { children: ReactNode }) => children,
  useRoomAvatarOf: () => () => undefined,
  useRoomTintOf: () => () => "gray",
}));
vi.mock("./meeting-room-sidebar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./meeting-room-sidebar")>()),
  MeetingRoomSidebar: ({
    tab,
    onTabChange,
    onCollapse,
    tabsEnd,
  }: {
    tab: string;
    onTabChange: (tab: string) => void;
    onCollapse?: () => void;
    tabsEnd?: ReactNode;
  }) => (
    <div data-testid="room-sidebar" data-tab={tab}>
      {["chat", "motions"].map((id) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTabChange(id)}>
          {`${id}-tab`}
        </button>
      ))}
      {onCollapse ? (
        <button type="button" onClick={onCollapse}>
          collapse
        </button>
      ) : null}
      {tabsEnd}
    </div>
  ),
}));
vi.mock("./meeting-copilot/live-items-unseen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./meeting-copilot/live-items-unseen")>()),
  useUnseenLiveItems: () => ({ count: live.count, latest: undefined, ids: new Set<string>() }),
}));
vi.mock("./meeting-control-bar", () => ({ MeetingControlBar: () => null }));
vi.mock("./meeting-stage-footer", () => ({
  MeetingStageFooter: ({ prompt }: { prompt: ReactNode }) => prompt,
}));
vi.mock("./meeting-participant-tile", () => ({ MeetingParticipantTile: () => null }));
vi.mock("./meeting-room-announcers", () => ({
  ChatMessageAnnouncer: () => null,
  ParticipantPresenceAnnouncer: () => null,
  ReactionAnnouncer: () => null,
  ScreenShareAnnouncer: () => null,
  ScribeAnnouncer: () => null,
  OnOffAnnouncer: () => null,
  useMeetingChatUnread: () => ({ unread: 0, latest: undefined }),
}));
vi.mock("./meeting-captions", () => ({
  captionsErrorKey: (c: string) => c,
  captionsSupported: () => false,
  MeetingLiveCaptions: () => null,
}));
vi.mock("./meeting-camera-background-sync", () => ({ MeetingCameraBackgroundSync: () => null }));
vi.mock("./meeting-screen-share-notices", () => ({ MeetingScreenShareWatcher: () => null }));
vi.mock("./meeting-single-presenter", () => ({ MeetingSinglePresenter: () => null }));
vi.mock("./meeting-connection-notice", () => ({ MeetingConnectionNotice: () => null }));
vi.mock("./meeting-schedule-banner", () => ({ MeetingScheduleBanner: () => null }));
vi.mock("./meeting-vote-prompt", () => ({
  MeetingVotePrompt: ({ hidden, onOpenTab }: { hidden?: boolean; onOpenTab: () => void }) =>
    hidden ? null : (
      <button type="button" data-testid="meeting-vote-prompt" onClick={onOpenTab}>
        open-votes
      </button>
    ),
}));

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  view.compact = false;
  live.count = 0;
});

function renderConference() {
  render(wrapWithNav(<MeetingConference meetingId="m1" workspaceId="w1" onExit={() => {}} />));
}

describe("MeetingConference side panel", () => {
  it("hides the stage's vote prompt while the docked Votes tab shows the ballot", () => {
    renderConference();
    fireEvent.click(screen.getByTestId("meeting-vote-prompt"));
    expect(screen.getByTestId("room-sidebar")).toHaveAttribute("data-tab", "motions");
    expect(screen.queryByTestId("meeting-vote-prompt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "chat-tab" }));
    expect(screen.getByTestId("meeting-vote-prompt")).toBeInTheDocument();
  });

  it("hands focus to the Votes tab when the prompt goes away under its own button", () => {
    renderConference();
    fireEvent.click(screen.getByTestId("meeting-vote-prompt"));
    // The panel is already open, on another tab.
    fireEvent.click(screen.getByRole("tab", { name: "chat-tab" }));
    const promptButton = screen.getByTestId("meeting-vote-prompt");
    promptButton.focus();

    fireEvent.click(promptButton);
    expect(screen.getByRole("tab", { name: "motions-tab" })).toHaveFocus();
  });

  it("collapses the docked panel from its tab row, bringing the prompt back", () => {
    renderConference();
    fireEvent.click(screen.getByTestId("meeting-vote-prompt"));
    expect(screen.queryByTestId("meeting-vote-prompt")).not.toBeInTheDocument();

    const collapse = screen.getByRole("button", { name: "collapse" });
    collapse.focus();
    fireEvent.click(collapse);
    expect(screen.getByTestId("meeting-vote-prompt")).toBeInTheDocument();
    // The button left with the panel; the keyboard lands on the header's toggle that reopens it.
    expect(screen.getByRole("button", { name: "Mở bảng phụ" })).toHaveFocus();
  });

  it("marks the header's panel button with what waits in UNI once the panel is closed", () => {
    live.count = 2;
    renderConference();
    fireEvent.click(screen.getByTestId("meeting-vote-prompt"));
    const open = screen.getByRole("button", { name: "Đóng bảng phụ" });
    expect(open.querySelector("[data-slot=panel-news]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "collapse" }));
    const closed = screen.getByRole("button", { name: "Mở bảng phụ, UNI · 2 việc mới ghi" });
    expect(closed.querySelector("[data-slot=panel-news]")).not.toBeNull();
  });

  it("opens the panel as a bottom sheet on a phone, with no collapse button", async () => {
    view.compact = true;
    renderConference();
    fireEvent.click(screen.getByTestId("meeting-vote-prompt"));

    const sidebar = await screen.findByTestId("room-sidebar");
    expect(sidebar.closest("[data-side]")).toHaveAttribute("data-side", "bottom");
    // The room stays in sight behind it: no blur, no dim (Phone board).
    const backdrop = document.querySelector('[data-slot="sheet-overlay"]');
    expect(backdrop).toHaveClass("bg-transparent", "supports-backdrop-filter:backdrop-blur-none");
    expect(backdrop).not.toHaveClass("supports-backdrop-filter:backdrop-blur-xs");
    expect(screen.queryByRole("button", { name: "collapse" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-vote-prompt")).not.toBeInTheDocument();

    fireEvent.click(within(sidebar).getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByTestId("room-sidebar")).not.toBeInTheDocument());
    expect(screen.getByTestId("meeting-vote-prompt")).toBeInTheDocument();
  });
});
