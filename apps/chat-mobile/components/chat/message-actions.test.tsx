// The long-press menu offers "Report" on someone else's message only (store
// UGC policy); one's own message keeps edit and delete.
import { fireEvent, screen, within } from "@testing-library/react-native";
import { Dimensions, Platform, ScrollView, StyleSheet } from "react-native";
import { actionMenuLayout } from "@/lib/action-menu-layout";
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

describe("MessageActionsSheet › touch", () => {
  const ripples = (name: string) => expect(screen.getByRole("button", { name }).props.nativeBackgroundAndroid).toEqual(expect.objectContaining({ type: "RippleAndroid" }));

  it("draws every reaction 44 pt round, 48 dp tall on Android without reaching into its neighbour, with a ripple", async () => {
    await render(<MessageActionsSheet {...props(false)} />);
    for (const name of [viText("chat.mobile.react_label_like"), viText("chat.action_react_more")]) {
      const button = screen.getByRole("button", { name });
      expect(button.props.className).toContain("h-11 w-11");
      expect(button.props.hitSlop).toEqual({ top: 2, bottom: 2 });
      ripples(name);
    }
  });

  it("gives each menu row 48 dp on Android and 46 pt on iOS, with a ripple", async () => {
    const { unmount } = await render(<MessageActionsSheet {...props(false)} />);
    expect(screen.getByRole("button", { name: viText("chat.action_copy") }).props.className).toContain("min-h-12");
    ripples(viText("chat.action_copy"));
    await unmount();
    jest.replaceProperty(Platform, "OS", "ios");
    await render(<MessageActionsSheet {...props(false)} />);
    expect(screen.getByRole("button", { name: viText("chat.action_copy") }).props.className).toContain("min-h-[46px]");
  });
});

describe("MessageActionsSheet › commands", () => {
  // A row's name is its label, or its label and hint ("Tạo việc, …").
  const name = (key: string) => new RegExp(`^${viText(key)}(, .*)?$`);
  const button = (key: string) => screen.getByRole("button", { name: name(key) });

  it("runs each command of someone else's message with that message, and closes first", async () => {
    const p = props(false);
    await render(<MessageActionsSheet {...p} />);
    const runs: [string, jest.Mock][] = [
      ["chat.action_reply", p.onReply],
      ["chat.action_thread", p.onThread],
      ["chat.action_copy", p.onCopy],
      ["chat.action_pin", p.onPin],
      ["chat.link.create_task", p.onCreateTask],
      ["chat.forward.action", p.onForward],
    ];
    for (const [key, handler] of runs) {
      await fireEvent.press(button(key));
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    }
    await fireEvent.press(button("chat.follow_up.action"));
    expect(p.onFollowUp).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), "create");
    expect(p.onClose).toHaveBeenCalledTimes(runs.length + 1);
  });

  it("reacts with a quick emoji, or opens the full set", async () => {
    const p = props(false);
    await render(<MessageActionsSheet {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.react_label_like") }));
    expect(p.onReact).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), expect.any(String));
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.action_react_more") }));
    expect(p.onMoreReactions).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("edits and deletes one's own text message", async () => {
    const p = props(true);
    await render(<MessageActionsSheet {...p} />);
    await fireEvent.press(button("chat.action_edit"));
    expect(p.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    await fireEvent.press(button("chat.action_delete"));
    expect(p.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("completes, converts or removes an open follow-up instead of setting one", async () => {
    const p = { ...props(false), followUp: { id: "f1", message_id: "m1", note: "", due_at: null, completed_at: null } };
    await render(<MessageActionsSheet {...p} />);
    expect(screen.queryByRole("button", { name: name("chat.follow_up.action") })).toBeNull();
    for (const [key, command] of [
      ["chat.follow_up.complete", "complete"],
      ["chat.follow_up.convert", "convert"],
      ["chat.mobile.follow_up_remove", "remove"],
    ] as const) {
      await fireEvent.press(button(key));
      expect(p.onFollowUp).toHaveBeenLastCalledWith(expect.objectContaining({ id: "m1" }), command);
    }
  });

  it("offers retry and discard for a failed send, and no reactions", async () => {
    const pending = {
      workspaceId: "w1",
      roomId: "r1",
      senderId: "u1",
      clientMsgId: "c1",
      body: "chưa gửi",
      createdAt: Date.parse("2026-10-21T08:00:00Z"),
      status: "failed" as const,
    };
    const message = { id: "pending:c1", sender: "u1", body: "chưa gửi", ts: pending.createdAt, clientMsgId: "c1", pending };
    const p = { ...props(true), message };
    await render(<MessageActionsSheet {...p} />);
    expect(screen.queryByRole("button", { name: viText("chat.mobile.react_label_like") })).toBeNull();
    expect(screen.getByText("chưa gửi")).toBeOnTheScreen();
    await fireEvent.press(button("chat.retry"));
    expect(p.onRetry).toHaveBeenCalledWith(message);
    await fireEvent.press(button("chat.action_delete"));
    expect(p.onDiscard).toHaveBeenCalledWith(message);
  });

  it("names who has read the message above the menu", async () => {
    const seenBy = [
      { user_id: "u3", display_name: "Lan" },
      { user_id: "u4", display_name: "Minh" },
    ];
    await render(<MessageActionsSheet {...props(false)} seenBy={seenBy} />);
    expect(screen.getByLabelText(viText("chat.seen_by_count", { count: 2 }))).toBeOnTheScreen();
  });
});

describe("MessageActionsSheet › fit", () => {
  /** A 360 × 640 dp Android phone at the given text size (the test's safe-area insets are zero). */
  const phone = (fontScale: number) => jest.spyOn(Dimensions, "get").mockReturnValue({ width: 360, height: 640, scale: 2, fontScale });
  // One's own text message with an open follow-up, read by a group: the longest menu there is (eleven rows and seen-by).
  const longest = () => ({
    ...props(true),
    followUp: { id: "f1", message_id: "m1", note: "", due_at: null, completed_at: null },
    seenBy: [{ user_id: "u3", display_name: "Lan" }],
  });

  it("caps the menu at the height the window has left and scrolls the rows past it, Delete included", async () => {
    phone(1);
    await render(<MessageActionsSheet {...longest()} />);
    const menu = screen.getByTestId("message-actions-menu");
    const expected = actionMenuLayout({
      windowWidth: 360,
      windowHeight: 640,
      fontScale: 1,
      insetTop: 0,
      insetBottom: 0,
      reactions: true,
      senderName: false,
      avatar: false,
    });
    expect(StyleSheet.flatten(menu.props.style)).toEqual(expect.objectContaining({ maxHeight: expected.menuMaxHeight }));
    expect(within(menu).getByRole("button", { name: viText("chat.action_delete") })).toBeOnTheScreen();
    expect(within(menu).getByLabelText(viText("chat.seen_by_count", { count: 1 }))).toBeOnTheScreen();
    expect(screen.getByText("chào").props.numberOfLines).toBe(expected.previewLines);
  });

  it("lifts two lines of the message and widens the card at the largest text size", async () => {
    phone(2);
    await render(<MessageActionsSheet {...longest()} />);
    expect(screen.getByText("chào").props.numberOfLines).toBe(2);
    const card = screen.getByTestId("message-actions-menu").parent;
    expect(card).not.toBeNull();
    expect(StyleSheet.flatten(card?.props.style)).toEqual(expect.objectContaining({ width: 328 }));
  });

  it("flashes the scroll bar when the rows overflow the cap, and not when they fit", async () => {
    phone(1);
    const flash = jest.spyOn(ScrollView.prototype, "flashScrollIndicators").mockImplementation(() => undefined);
    await render(<MessageActionsSheet {...longest()} />);
    const menu = screen.getByTestId("message-actions-menu");
    await fireEvent(menu, "contentSizeChange", 256, 100);
    expect(flash).not.toHaveBeenCalled();
    await fireEvent(menu, "contentSizeChange", 256, 2000);
    expect(flash).toHaveBeenCalledTimes(1);
  });

  it("is one modal layer to VoiceOver, closed by its escape scrub", async () => {
    const p = props(false);
    await render(<MessageActionsSheet {...p} />);
    const column = screen.getByTestId("message-actions");
    expect(column.props.accessibilityViewIsModal).toBe(true);
    await fireEvent(column, "accessibilityEscape");
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});
