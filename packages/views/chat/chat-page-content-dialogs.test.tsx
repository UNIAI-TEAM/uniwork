import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPageContentDialogs } from "./chat-page-content-dialogs";
import type { ChatPageContentProps } from "./chat-page-content-props";

// Only the picker is under test: every other dialog or sheet is a no-op.
vi.mock("./add-group-members-dialog", () => ({ AddGroupMembersDialog: () => null }));
vi.mock("./channel-settings-sheet", () => ({ ChannelSettingsSheet: () => null }));
vi.mock("./chat-create-poll-dialog", () => ({ ChatCreatePollDialog: () => null }));
vi.mock("./chat-create-reminder-dialog", () => ({ ChatCreateReminderDialog: () => null }));
vi.mock("./chat-create-note-dialog", () => ({ ChatCreateNoteDialog: () => null }));
vi.mock("./chat-create-post-dialog", () => ({ ChatCreatePostDialog: () => null }));
vi.mock("./dm-settings-sheet", () => ({ DmSettingsSheet: () => null }));
vi.mock("./group-settings-sheet", () => ({ GroupSettingsSheet: () => null }));
vi.mock("./workspace-settings-sheet", () => ({ WorkspaceSettingsSheet: () => null }));
vi.mock("./chat-document-picker", () => ({
  ChatDocumentPicker: (props: { open: boolean; roomId: string; replyToId?: string; onSent?: () => void }) => (
    <div data-testid="picker" data-open={String(props.open)} data-room={props.roomId} data-reply={props.replyToId ?? ""}>
      <button type="button" onClick={props.onSent}>
        sent
      </button>
    </div>
  ),
}));

function renderDialogs(over: Record<string, unknown> = {}) {
  const props = {
    target: { kind: "workspace" },
    workspaceId: "ws1",
    activeRoomId: "room1",
    documentPickerOpen: true,
    onDocumentPickerOpenChange: vi.fn(),
    onReplyToChange: vi.fn(),
    replyTo: { id: "m-quoted" },
    t: (key: string) => key,
    ...over,
  };
  render(<ChatPageContentDialogs {...(props as unknown as Parameters<typeof ChatPageContentDialogs>[0])} />);
  return props as unknown as ChatPageContentProps & { onReplyToChange: ReturnType<typeof vi.fn> };
}

describe("ChatPageContentDialogs document picker", () => {
  it("mounts the picker on the open room, with the room, the open flag and the reply", () => {
    renderDialogs();
    const picker = screen.getByTestId("picker");
    expect(picker).toHaveAttribute("data-open", "true");
    expect(picker).toHaveAttribute("data-room", "room1");
    expect(picker).toHaveAttribute("data-reply", "m-quoted");
  });

  it("mounts no picker without an open room", () => {
    renderDialogs({ activeRoomId: null });
    expect(screen.queryByTestId("picker")).not.toBeInTheDocument();
  });

  it("drops the reply the composer held once the document went out", () => {
    const props = renderDialogs();
    fireEvent.click(screen.getByRole("button", { name: "sent" }));
    expect(props.onReplyToChange).toHaveBeenCalledExactlyOnceWith(null);
  });
});
