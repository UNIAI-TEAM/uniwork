import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { buildMessageRowModels, sameRowModel, type MessageRowModel, type MessageRowModelInput } from "./message-row-model";
import { toTimelineMessage, type TimelineMessage } from "./timeline-display";
import { layoutTimeline } from "./timeline-layout";

const task = (taskId: string, linkId = "l1") => ({ taskId, linkId, relation: "created_from" });

const at = (id: string, sender: string, minutes: number, extra: Partial<TimelineMessage> = {}): TimelineMessage => ({
  id,
  sender,
  body: `body of ${id}`,
  ts: new Date(2026, 9, 21, 9, minutes).getTime(),
  ...extra,
});

const record = (id: string, sender: string, extra: Record<string, unknown> = {}) =>
  toTimelineMessage(
    ChatMessageSchema.parse({ id, room_id: "r1", workspace_id: "w1", sender_id: sender, sender_display_name: sender, kind: "text", body: id, created_at: new Date(2026, 9, 21, 9, 0).toISOString(), ...extra }),
  );

function input(messages: TimelineMessage[], extra: Partial<MessageRowModelInput> = {}): MessageRowModelInput {
  const { rows, byId, continued } = layoutTimeline(messages);
  return {
    rows,
    byId,
    userId: "me",
    isGroup: true,
    continued,
    albums: { folded: new Set(), byFirstId: new Map() },
    senderName: (message) => (message.sender === "me" ? "Bạn" : message.sender.toUpperCase()),
    quoteText: (message) => message.body,
    unknownQuoteSender: "Trả lời",
    receiptOf: (_message, own) => (own ? "sent" : null),
    highlightedId: null,
    taskIdsByMessage: new Map(),
    ...extra,
  };
}

describe("buildMessageRowModels", () => {
  it("works out a group's run: the name on the first bubble, the face on the last, the spacer between", () => {
    const models = buildMessageRowModels(input([at("a1", "an", 0), at("a2", "an", 1), at("m1", "me", 2)]));
    expect([...models.keys()].sort()).toEqual(["a1", "a2", "m1"]);
    expect(models.get("a1")).toMatchObject({ own: false, showSender: true, continued: true, avatar: "spacer", senderName: "AN", receipt: null });
    expect(models.get("a2")).toMatchObject({ showSender: false, continued: false, avatar: "face", compactTop: true });
    expect(models.get("m1")).toMatchObject({ own: true, showSender: false, avatar: "none", receipt: "sent", swipeToReply: false, showThread: true });
  });

  it("draws no face, name or spacer in a DM", () => {
    const models = buildMessageRowModels(input([at("a1", "an", 0), at("a2", "an", 1)], { isGroup: false }));
    expect(models.get("a1")).toMatchObject({ showSender: false, avatar: "none" });
  });

  it("quotes a loaded message by its sender and preview, an unloaded one as a reply, and a highlighted row", () => {
    const models = buildMessageRowModels(
      input([at("a1", "an", 0), at("b1", "binh", 1, { replyToEventId: "a1" }), at("b2", "binh", 2, { replyToEventId: "gone" })], { highlightedId: "b2" }),
    );
    expect(models.get("b1")?.quote).toEqual({ id: "a1", sender: "AN", text: "body of a1" });
    expect(models.get("b2")?.quote).toEqual({ id: "gone", sender: "Trả lời", text: "…" });
    expect(models.get("b2")?.highlighted).toBe(true);
    expect(models.get("a1")?.quote).toBeNull();
  });

  it("leaves out a photo folded into its album and hands the album to its first photo", () => {
    const first = at("p1", "an", 0);
    const second = at("p2", "an", 0);
    const models = buildMessageRowModels(input([first, second], { albums: { folded: new Set(["p2"]), byFirstId: new Map([["p1", [first, second]]]) } }));
    expect([...models.keys()]).toEqual(["p1"]);
    expect(models.get("p1")?.album).toEqual([first, second]);
  });

  it("in a thread: the root is ringed and counts its replies, no reply quotes it, nothing opens another thread or swipes", () => {
    const root = record("root", "an", { reply_count: 1 });
    const reply = record("r1", "binh", { reply_to_message_id: "root" });
    const reply2 = record("r2", "binh");
    const models = buildMessageRowModels(input([root, reply, reply2], { threadRootId: "root" }));
    expect(models.get("root")).toMatchObject({ root: true, threadReplies: 2, avatar: "none", showThread: false, swipeToReply: false });
    expect(models.get("r1")).toMatchObject({ root: false, threadReplies: 0, quote: null });
  });

  it("counts a root's replies from the server when it knows of more than are loaded, and from none without a record", () => {
    const root = record("root", "an", { reply_count: 7 });
    expect(buildMessageRowModels(input([root], { threadRootId: "root" })).get("root")?.threadReplies).toBe(7);
    expect(buildMessageRowModels(input([at("root", "an", 0)], { threadRootId: "root" })).get("root")?.threadReplies).toBe(0);
  });

  it("lets a server message outside a thread swipe to reply and carries its tasks", () => {
    const message = record("m1", "an");
    const models = buildMessageRowModels(input([message], { taskIdsByMessage: new Map([["m1", [task("t1")]]]) }));
    expect(models.get("m1")).toMatchObject({ swipeToReply: true, taskIds: [task("t1")] });
  });

  it("does not let a poll vote's notice swipe to reply", () => {
    const vote = record("v1", "an", { kind: "poll_vote", poll_vote: { poll_message_id: "p1", question: "Ăn trưa?" } });
    expect(buildMessageRowModels(input([vote])).get("v1")).toMatchObject({ swipeToReply: false });
  });

  it("hands back last time's object for a row that draws the same, a new one for a row that changed", () => {
    const a1 = at("a1", "an", 0);
    const a2 = at("a2", "an", 1);
    const first = buildMessageRowModels(input([a1, a2], { taskIdsByMessage: new Map([["a1", [task("t1")]]]) }));
    // A new message from someone else: a2 stays the run's last, a1 keeps its (equal, rebuilt) task list.
    const second = buildMessageRowModels(input([a1, a2, at("b1", "binh", 2)], { taskIdsByMessage: new Map([["a1", [task("t1")]]]) }), first);
    expect(second.get("a1")).toBe(first.get("a1"));
    expect(second.get("a2")).toBe(first.get("a2"));
    // A new message from the same sender continues a2's run: only a2 changes.
    const third = buildMessageRowModels(input([a1, a2, at("a3", "an", 2)], { taskIdsByMessage: new Map([["a1", [task("t1")]]]) }), first);
    expect(third.get("a1")).toBe(first.get("a1"));
    expect(third.get("a2")).not.toBe(first.get("a2"));
  });
  it("keeps the name and the quote of a row whose receipt or highlight moved, without reading them again", () => {
    let reads = 0;
    const senderName = (message: TimelineMessage) => {
      reads += 1;
      return message.sender.toUpperCase();
    };
    const quoteText = (message: TimelineMessage) => {
      reads += 1;
      return message.body;
    };
    const messages = [at("a1", "an", 0), at("m1", "me", 1, { replyToEventId: "a1" })];
    const first = buildMessageRowModels(input(messages, { senderName, quoteText }));
    reads = 0;
    const seen = buildMessageRowModels(input(messages, { senderName, quoteText, receiptOf: (_m, own) => (own ? "seen" : null), highlightedId: "a1" }), first);
    expect(reads).toBe(0);
    expect(seen.get("m1")).toMatchObject({ receipt: "seen", senderName: "ME", quote: { id: "a1", sender: "AN", text: "body of a1" } });
    expect(seen.get("m1")).not.toBe(first.get("m1"));
    expect(seen.get("a1")?.highlighted).toBe(true);
  });

  it("reads again with new readers, and from a map it did not build", () => {
    const messages = [at("a1", "an", 0)];
    const first = buildMessageRowModels(input(messages));
    expect(buildMessageRowModels(input(messages, { senderName: () => "Ân" }), first).get("a1")?.senderName).toBe("Ân");
    expect(buildMessageRowModels(input(messages), new Map(first)).get("a1")).toBe(first.get("a1"));
  });

  it("works a thread's root out again each time: its count follows the loaded replies", () => {
    const root = record("root", "an");
    const first = buildMessageRowModels(input([root, record("r1", "binh")], { threadRootId: "root" }));
    const more = buildMessageRowModels(input([root, record("r1", "binh"), record("r2", "binh")], { threadRootId: "root" }), first);
    expect(more.get("root")?.threadReplies).toBe(2);
  });
});

describe("sameRowModel", () => {
  const base = (): MessageRowModel => ({
    key: "m1",
    message: at("m1", "an", 0),
    own: false,
    compactTop: false,
    continued: false,
    senderName: "An",
    showSender: true,
    quote: { id: "q", sender: "Bình", text: "hi" },
    receipt: null,
    avatar: "face",
    album: undefined,
    root: false,
    threadReplies: 0,
    highlighted: false,
    showThread: true,
    swipeToReply: true,
    taskIds: [task("t1")],
  });

  it("holds equal rows equal, rebuilt quotes and lists included", () => {
    const a = base();
    const photo = at("p1", "an", 0);
    const withAlbum = { ...a, album: [photo] };
    expect(sameRowModel(withAlbum, { ...withAlbum, album: [photo] })).toBe(true);
    expect(sameRowModel(withAlbum, { ...withAlbum, album: undefined })).toBe(false);
    expect(sameRowModel(withAlbum, { ...withAlbum, album: [photo, photo] })).toBe(false);
    expect(sameRowModel(withAlbum, { ...withAlbum, album: [at("p2", "an", 1)] })).toBe(false);
    expect(sameRowModel(a, a)).toBe(true);
    expect(sameRowModel(a, { ...a, quote: { ...a.quote! }, taskIds: [task("t1")] })).toBe(true);
    expect(sameRowModel({ ...a, taskIds: undefined }, { ...a, taskIds: undefined })).toBe(true);
    expect(sameRowModel({ ...a, quote: null }, { ...a, quote: null })).toBe(true);
  });

  it.each<[string, Partial<MessageRowModel>]>([
    ["key", { key: "m2" }],
    ["message", { message: at("m1", "an", 0) }],
    ["own", { own: true }],
    ["compactTop", { compactTop: true }],
    ["continued", { continued: true }],
    ["senderName", { senderName: "Ân" }],
    ["showSender", { showSender: false }],
    ["receipt", { receipt: "seen" }],
    ["avatar", { avatar: "spacer" }],
    ["root", { root: true }],
    ["threadReplies", { threadReplies: 2 }],
    ["highlighted", { highlighted: true }],
    ["showThread", { showThread: false }],
    ["swipeToReply", { swipeToReply: false }],
    ["quote gone", { quote: null }],
    ["quote id", { quote: { id: "q2", sender: "Bình", text: "hi" } }],
    ["quote sender", { quote: { id: "q", sender: "An", text: "hi" } }],
    ["quote text", { quote: { id: "q", sender: "Bình", text: "hello" } }],
    ["album", { album: [at("p1", "an", 0)] }],
    ["tasks gone", { taskIds: undefined }],
    ["tasks length", { taskIds: [task("t1"), task("t2", "l2")] }],
    ["tasks item", { taskIds: [task("t2", "l2")] }],
    ["tasks link", { taskIds: [task("t1", "l2")] }],
    ["tasks relation", { taskIds: [{ taskId: "t1", linkId: "l1", relation: "mentions" }] }],
    ["tasks hole", { taskIds: [undefined] as unknown as MessageRowModel["taskIds"] }],
  ])("tells a change of %s apart", (_name, change) => {
    const a = base();
    expect(sameRowModel(a, { ...a, ...change })).toBe(false);
  });
});
