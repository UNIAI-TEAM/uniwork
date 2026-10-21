import { ChatMessageSchema, type ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { fireEvent, screen } from "@testing-library/react-native";
import { formatMessageTime, type TimelineMessage } from "@/lib/timeline-display";
import type { PendingSend } from "@/lib/send-pipeline";
import { render, viText } from "@/test/render";
import { MessageRow, type MessageRowProps } from "./message-row";

const TS = Date.UTC(2026, 9, 21, 2, 41);
const TIME = formatMessageTime(TS, "vi");

const record = (extra: Record<string, unknown> = {}): ChatMessageRecord =>
  ChatMessageSchema.parse({
    id: "m1",
    room_id: "r1",
    workspace_id: "w1",
    sender_id: "u2",
    sender_display_name: "Bình",
    kind: "text",
    body: "Mai họp lúc 9 giờ nhé",
    created_at: new Date(TS).toISOString(),
    ...extra,
  });

const sent = (extra: Record<string, unknown> = {}): TimelineMessage => {
  const r = record(extra);
  return { id: r.id, sender: r.sender_id, body: r.body, kind: r.kind, ts: TS, record: r };
};

const pending = (status: PendingSend["status"], extra: Partial<PendingSend> = {}): TimelineMessage => {
  const entry: PendingSend = { workspaceId: "w1", roomId: "r1", senderId: "u1", clientMsgId: "c1", body: "[@Bình](mention://member/u2) xem giúp", createdAt: TS, status, ...extra };
  return { id: "pending:c1", sender: "u1", body: entry.body, ts: TS, clientMsgId: "c1", pending: entry };
};

const handlers = () => ({
  onLongPress: jest.fn(),
  onPressQuote: jest.fn(),
  onPressThread: jest.fn(),
  onPressPending: jest.fn(),
  onToggleReaction: jest.fn(),
});

const props = (message: TimelineMessage, extra: Partial<MessageRowProps> = {}): MessageRowProps => ({
  message,
  own: false,
  compactTop: false,
  continued: false,
  senderName: "Bình",
  showSender: false,
  quote: null,
  receipt: null,
  highlighted: false,
  showThread: true,
  ctx: { wsId: "w1", orgSlug: "acme", wsSlug: "hq", roomId: "r1", userId: "u1", onOpenImage: jest.fn(), onVotePoll: jest.fn(), onOpenLink: jest.fn(), onLinkMenu: jest.fn() },
  scheme: "light",
  ...handlers(),
  ...extra,
});

const bubbleLabel = (sender: string, preview: string, ...rest: (string | undefined)[]) =>
  [viText("chat.message_list.label", { sender, time: TIME }), preview, ...rest].filter(Boolean).join(". ");

describe("MessageRow", () => {
  it("reads a received message as its sender, time and text, and opens its actions on a long press", async () => {
    const p = props(sent());
    await render(<MessageRow {...p} />);
    const bubble = screen.getByLabelText(bubbleLabel("Bình", "Mai họp lúc 9 giờ nhé"));
    expect(screen.getByText("Mai họp lúc 9 giờ nhé")).toBeOnTheScreen();
    await fireEvent(bubble, "longPress");
    expect(p.onLongPress).toHaveBeenCalledWith(p.message);
    await fireEvent(bubble, "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
    expect(p.onLongPress).toHaveBeenCalledTimes(2);
  });

  it("says an edited message was edited, in the bubble and to a screen reader", async () => {
    await render(<MessageRow {...props(sent({ edited_at: new Date(TS + 60_000).toISOString() }))} />);
    expect(screen.getByText(`${viText("chat.edited_label")} · ${TIME}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(bubbleLabel("Bình", "Mai họp lúc 9 giờ nhé", viText("chat.edited_label")))).toBeOnTheScreen();
  });

  it.each([
    ["sending", "chat.mobile.send_sending"],
    ["queued", "chat.mobile.send_queued"],
    ["failed", "chat.send_failed"],
  ] as const)("shows a %s message's state where a sent one has its time, and reads it out", async (status, key) => {
    const p = props(pending(status), { own: true, senderName: viText("chat.you") });
    await render(<MessageRow {...p} />);
    // Mentions read as names, never as their stored token.
    expect(screen.getByText("@Bình xem giúp")).toBeOnTheScreen();
    expect(screen.getByText(viText(key))).toBeOnTheScreen();
    const bubble = screen.getByLabelText(bubbleLabel(viText("chat.you"), "@Bình xem giúp", viText(key)));
    // What the tap does, said as a hint: a sending one can only be deleted, the others sent again too.
    expect(bubble.props.accessibilityHint).toBe(viText(status === "sending" ? "mobile.a11y.bubble_sending_hint" : "mobile.a11y.bubble_retry_hint"));
    await fireEvent.press(bubble);
    expect(p.onPressPending).toHaveBeenCalledWith(p.message);
  });

  it("names a pending file by its file name", async () => {
    const file = { uri: "file:///a.pdf", name: "bao-gia.pdf", mimeType: "application/pdf", size: 10 };
    await render(<MessageRow {...props(pending("sending", { body: "", file }), { own: true, senderName: viText("chat.you") })} />);
    expect(screen.getByText("bao-gia.pdf")).toBeOnTheScreen();
  });

  it("does nothing on a tap on a sent message", async () => {
    const p = props(sent());
    await render(<MessageRow {...p} />);
    await fireEvent.press(screen.getByLabelText(bubbleLabel("Bình", "Mai họp lúc 9 giờ nhé")));
    expect(p.onPressPending).not.toHaveBeenCalled();
  });

  it.each([
    ["seen", "chat.read_receipt"],
    ["delivered", "chat.receipt_delivered"],
    ["sent", "chat.receipt_sent"],
  ] as const)("reads a %s receipt as part of the bubble", async (receipt, key) => {
    await render(<MessageRow {...props(sent({ sender_id: "u1" }), { own: true, senderName: viText("chat.you"), receipt })} />);
    expect(screen.getByLabelText(bubbleLabel(viText("chat.you"), "Mai họp lúc 9 giờ nhé", viText(key)))).toBeOnTheScreen();
    // Seen is told apart by shape, not by a near-white shift of delivered's colour.
    expect(screen.queryByTestId("receipt-seen") !== null).toBe(receipt === "seen");
  });

  it("reads a card's foot as one line, its time and receipt, while the card keeps its own button", async () => {
    // A kind this phone cannot draw is a card with an "Open on the web" button, like a photo or a poll.
    const card = sent({ sender_id: "u1", kind: "hologram", body: "", edited_at: new Date(TS + 60_000).toISOString() });
    await render(<MessageRow {...props(card, { own: true, senderName: viText("chat.you"), receipt: "seen" })} />);
    expect(screen.getByLabelText(`${viText("chat.edited_label")}, ${TIME}, ${viText("chat.read_receipt")}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(new RegExp(`^${viText("chat.message_list.label", { sender: viText("chat.you"), time: TIME })}`)).props.accessible).toBe(false);
    expect(screen.getByText(viText("chat.mobile.open_on_web"))).toBeOnTheScreen();
  });

  it("toggles a reaction from its pill, which says whether it is mine", async () => {
    const message = sent({ reactions: { "👍": 2, "❤️": 1, "😂": 0 }, my_reactions: ["👍"] });
    const p = props(message);
    await render(<MessageRow {...p} />);
    const mine = screen.getByRole("button", { name: viText("chat.message_list.reaction_mine_aria", { emoji: "👍", count: 2 }) });
    expect(mine).toBeSelected();
    const theirs = screen.getByRole("button", { name: viText("chat.message_list.reaction_aria", { emoji: "❤️", count: 1 }) });
    expect(theirs).not.toBeSelected();
    expect(screen.queryByText("😂")).toBeNull();
    await fireEvent.press(theirs);
    expect(p.onToggleReaction).toHaveBeenCalledWith(message, "❤️");
  });

  it("reads a reply as one bubble that names its quote, and jumps to the quote by touch or by its action", async () => {
    const p = props(sent(), { quote: { sender: "An", text: "Ai đi họp?", id: "m0" }, showSender: true });
    await render(<MessageRow {...p} />);
    const bubble = screen.getByLabelText(bubbleLabel("Bình", viText("mobile.a11y.bubble_quote", { sender: "An", text: "Ai đi họp?" }), "Mai họp lúc 9 giờ nhé"));
    // One stop for VoiceOver/TalkBack: the quote is an action of the bubble, not a second button.
    expect(screen.queryByRole("button", { name: viText("chat.reply_quote_jump", { preview: "Ai đi họp?" }) })).toBeNull();
    expect(bubble.props.accessibilityActions).toEqual([
      { name: "longpress", label: viText("chat.message_actions_aria") },
      { name: "open_quote", label: viText("chat.reply_quote_jump", { preview: "Ai đi họp?" }) },
    ]);
    await fireEvent(bubble, "accessibilityAction", { nativeEvent: { actionName: "open_quote" } });
    expect(p.onPressQuote).toHaveBeenCalledWith("m0");
    await fireEvent(bubble, "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
    expect(p.onLongPress).toHaveBeenCalledWith(p.message);
    // A sighted tap on the quote still jumps.
    await fireEvent.press(screen.getByText("Ai đi họp?", { includeHiddenElements: true }));
    expect(p.onPressQuote).toHaveBeenCalledTimes(2);
  });

  it("keeps a quote over a card with its own button a button of its own", async () => {
    const card = sent({ kind: "hologram", body: "" });
    const p = props(card, { quote: { sender: "An", text: "Ảnh hôm qua?", id: "m0" } });
    await render(<MessageRow {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.reply_quote_jump", { preview: "Ảnh hôm qua?" }) }));
    expect(p.onPressQuote).toHaveBeenCalledWith("m0");
  });

  it("opens the thread from its reply count, and hides it inside a thread", async () => {
    const message = sent({ reply_count: 3, thread_unread: false });
    const p = props(message);
    const { rerender } = await render(<MessageRow {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.thread_replies", { count: 3 }) }));
    expect(p.onPressThread).toHaveBeenCalledWith(message);
    await rerender(<MessageRow {...p} showThread={false} />);
    expect(screen.queryByRole("button", { name: viText("chat.thread_replies", { count: 3 }) })).toBeNull();
  });

  it("draws a call log as a chip with its own time, not a bubble", async () => {
    await render(<MessageRow {...props(sent({ kind: "voice_call_log", body: "", voice_call: { outcome: "completed", duration_seconds: 65, caller_id: "u2" } }))} />);
    expect(screen.getByText(viText("chat.voice_call_log_completed", { duration: "1:05" }))).toBeOnTheScreen();
    expect(screen.queryByLabelText(new RegExp(`^${viText("chat.message_list.label", { sender: "Bình", time: TIME })}`))).toBeNull();
  });

  it("draws a system line as one centred, readable chip", async () => {
    await render(<MessageRow {...props(sent({ kind: "system", body: "An đã thêm Bình vào nhóm" }))} />);
    expect(screen.getByLabelText("An đã thêm Bình vào nhóm")).toBeOnTheScreen();
  });
});

describe("links and bold in a message", () => {
  const body = "Xem **bản chốt** ở https://docs.example.com/a?b=1. và https://b.example/";

  it("draws the bold without its stars and each address as a link that opens on a tap", async () => {
    const p = props(sent({ body }));
    await render(<MessageRow {...p} />);
    expect(screen.getByText("bản chốt")).toBeOnTheScreen();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    const link = screen.getByRole("link", { name: viText("mobile.conversation.link_label", { link: "docs.example.com/a?b=1" }) });
    await fireEvent.press(link);
    expect(p.ctx.onOpenLink).toHaveBeenCalledWith("https://docs.example.com/a?b=1");
    await fireEvent(link, "longPress");
    expect(p.ctx.onLinkMenu).toHaveBeenCalledWith("https://docs.example.com/a?b=1");
  });

  it("gives a screen reader one action per link on the bubble, after the menu", async () => {
    const p = props(sent({ body }));
    await render(<MessageRow {...p} />);
    const bubble = screen.getByLabelText(new RegExp(`^${viText("chat.message_list.label", { sender: "Bình", time: TIME })}`));
    expect(bubble.props.accessibilityActions).toEqual([
      { name: "longpress", label: viText("chat.message_actions_aria") },
      { name: "link_0", label: viText("mobile.conversation.link_label", { link: "docs.example.com/a?b=1" }) },
      { name: "link_1", label: viText("mobile.conversation.link_label", { link: "b.example" }) },
    ]);
    await fireEvent(bubble, "accessibilityAction", { nativeEvent: { actionName: "link_1" } });
    expect(p.ctx.onLinkMenu).toHaveBeenCalledWith("https://b.example/");
    await fireEvent(bubble, "accessibilityAction", { nativeEvent: { actionName: "link_9" } });
    expect(p.onLongPress).toHaveBeenCalledTimes(1);
  });

  it("links in my own bubble too", async () => {
    const p = props(sent({ body: "**https://a.example/x**", sender_id: "u1" }), { own: true });
    await render(<MessageRow {...p} />);
    expect(screen.getByRole("link", { name: viText("mobile.conversation.link_label", { link: "a.example/x" }) })).toBeOnTheScreen();
  });
});
