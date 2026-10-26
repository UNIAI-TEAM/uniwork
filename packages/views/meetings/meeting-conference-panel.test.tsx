import { fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("@uniwork/ui/hooks/use-mobile", () => ({
  useIsMobile: () => view.compact,
  useIsCompact: () => view.compact,
}));
vi.mock("@livekit/components-react", () => ({
  RoomAudioRenderer: () => null,
  StartMediaButton: () => null,
  useIsRecording: () => false,
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
}));
vi.mock("./meeting-stage-header", () => ({ MeetingStageHeader: () => null }));
vi.mock("./meeting-room-sidebar", () => ({
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
      <button type="button" onClick={() => onTabChange("chat")}>
        chat-tab
      </button>
      {onCollapse ? (
        <button type="button" onClick={onCollapse}>
          collapse
        </button>
      ) : null}
      {tabsEnd}
    </div>
  ),
  MeetingSidebarDock: ({ children }: { children: ReactNode }) => children,
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
});

function renderConference() {
  render(wrapWithNav(<MeetingConference meetingId="m1" workspaceId="w1" onLeave={() => {}} />));
}

describe("MeetingConference side panel", () => {
  it("hides the stage's vote prompt while the docked Votes tab shows the ballot", () => {
    renderConference();
    fireEvent.click(screen.getByTestId("meeting-vote-prompt"));
    expect(screen.getByTestId("room-sidebar")).toHaveAttribute("data-tab", "motions");
    expect(screen.queryByTestId("meeting-vote-prompt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "chat-tab" }));
    expect(screen.getByTestId("meeting-vote-prompt")).toBeInTheDocument();
  });

  it("collapses the docked panel from its tab row, bringing the prompt back", () => {
    renderConference();
    fireEvent.click(screen.getByTestId("meeting-vote-prompt"));
    expect(screen.queryByTestId("meeting-vote-prompt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "collapse" }));
    expect(screen.getByTestId("meeting-vote-prompt")).toBeInTheDocument();
  });

  it("opens the panel as a bottom sheet on a phone, with no collapse button", async () => {
    view.compact = true;
    renderConference();
    fireEvent.click(screen.getByTestId("meeting-vote-prompt"));

    const sidebar = await screen.findByTestId("room-sidebar");
    expect(sidebar.closest("[data-side]")).toHaveAttribute("data-side", "bottom");
    expect(screen.queryByRole("button", { name: "collapse" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-vote-prompt")).not.toBeInTheDocument();
  });
});
