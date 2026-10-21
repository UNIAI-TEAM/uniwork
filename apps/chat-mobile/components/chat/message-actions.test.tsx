// The long-press menu offers "Report" on someone else's message only (store
// UGC policy); one's own message keeps edit and delete.
import { fireEvent, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { toTimelineMessage } from "@/lib/timeline-display";
import { render, viText } from "@/test/render";
import { MessageActionsSheet } from "./message-actions";

const record = { id: "m1", room_id: "r1", workspace_id: "w1", sender_id: "u2", sender_display_name: "Bình", body: "chào", kind: "text", created_at: "2026-10-21T08:00:00Z" };

const props = (own: boolean, onReport = jest.fn()) => ({
  message: toTimelineMessage(record as never),
  own,
  inThread: false,
  followUp: null,
  onClose: jest.fn(),
  onReact: jest.fn(),
  onReply: jest.fn(),
  onThread: jest.fn(),
  onCopy: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onFollowUp: jest.fn(),
  onCreateTask: jest.fn(),
  onRetry: jest.fn(),
  onDiscard: jest.fn(),
  onMoreReactions: jest.fn(),
  onPin: jest.fn(),
  onForward: jest.fn(),
  onReport,
});

beforeEach(() => jest.replaceProperty(Platform, "OS", "android"));
afterEach(() => jest.restoreAllMocks());

describe("MessageActionsSheet › report", () => {
  it("reports someone else's message", async () => {
    const onReport = jest.fn();
    await render(<MessageActionsSheet {...props(false, onReport)} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.report.action") }));
    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", sender: "u2" }));
    expect(screen.queryByRole("button", { name: viText("chat.action_edit") })).toBeNull();
  });

  it("offers no report on one's own message", async () => {
    await render(<MessageActionsSheet {...props(true)} />);
    expect(screen.getByRole("button", { name: viText("chat.action_edit") })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: viText("mobile.report.action") })).toBeNull();
  });
});
