import { describe, expect, it } from "vitest";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { senderLabelFor, toChatMessage } from "./native-chat-message-mapping";

const base: ChatMessageRecord = {
  id: "m1",
  room_id: "r1",
  workspace_id: "ws1",
  sender_id: "u1",
  sender_display_name: "An",
  body: "hello",
  kind: "text",
  created_at: "2026-03-26T10:00:00.000Z",
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
};

describe("toChatMessage", () => {
  it("maps base fields and optional edited_at", () => {
    const mapped = toChatMessage({
      ...base,
      edited_at: "2026-03-26T11:00:00.000Z",
      pinned: true,
      client_msg_id: "c1",
    });
    expect(mapped).toMatchObject({
      id: "m1",
      sender: "u1",
      body: "hello",
      kind: "text",
      pinned: true,
      clientMsgId: "c1",
    });
    expect(mapped.ts).toBe(Date.parse(base.created_at));
    expect(mapped.editedAt).toBe(Date.parse("2026-03-26T11:00:00.000Z"));
  });

  it("defaults reactions and omits optional payloads", () => {
    const mapped = toChatMessage({ ...base, reactions: undefined as never });
    expect(mapped.reactions).toEqual({});
    expect(mapped.voiceCall).toBeUndefined();
    expect(mapped.file).toBeUndefined();
    expect(mapped.poll).toBeUndefined();
    expect(mapped.reminder).toBeUndefined();
    expect(mapped.note).toBeUndefined();
    expect(mapped.priority).toBeUndefined();
  });

  it("maps voice_call, file, poll, reminder, note, and priority", () => {
    const mapped = toChatMessage({
      ...base,
      voice_call: { outcome: "answered", duration_seconds: 12, caller_id: "u1" },
      file: { filename: "a.pdf", content_type: "application/pdf", size_bytes: 10 },
      poll: {
        question: "Lunch?",
        options: [{ id: "o1", label: "Pho", votes: 2 }],
        settings: {
          deadline_at: null,
          pin_to_top: true,
          allow_multiple: false,
          allow_add_options: false,
          hide_results_until_vote: true,
          hide_voters: true,
        },
        viewer_option_ids: ["o1"],
        votes_by_user: { u1: ["o1"] },
      },
      reminder: { body: "standup", remind_at: "2026-03-27T09:00:00Z", repeat: "none" },
      note: { body: "note", pin_to_top: true },
      priority: "urgent",
    });
    expect(mapped.voiceCall).toEqual({
      outcome: "answered",
      duration_seconds: 12,
      caller_id: "u1",
    });
    expect(mapped.file).toEqual({
      filename: "a.pdf",
      content_type: "application/pdf",
      size_bytes: 10,
    });
    expect(mapped.poll?.options[0]).toEqual({ id: "o1", label: "Pho", votes: 2 });
    expect(mapped.poll?.settings.pin_to_top).toBe(true);
    expect(mapped.reminder).toEqual({
      body: "standup",
      remindAt: "2026-03-27T09:00:00Z",
      repeat: "none",
    });
    expect(mapped.note).toEqual({ body: "note", pinToTop: true });
    expect(mapped.priority).toBe("urgent");
  });

  it("applies poll/note defaults and drops unknown priority", () => {
    const mapped = toChatMessage({
      ...base,
      poll: {
        question: "Q",
        options: [{ id: "o1", label: "A", votes: 0 }],
        settings: {} as NonNullable<ChatMessageRecord["poll"]>["settings"],
        viewer_option_ids: [],
        votes_by_user: {},
      },
      note: { body: "n" } as NonNullable<ChatMessageRecord["note"]>,
      reminder: {
        body: "standup",
        remind_at: "2026-03-27T09:00:00Z",
      } as NonNullable<ChatMessageRecord["reminder"]>,
      priority: "normal" as never,
    });
    expect(mapped.poll?.settings).toMatchObject({
      deadline_at: null,
      pin_to_top: false,
      allow_multiple: true,
      allow_add_options: true,
      hide_results_until_vote: false,
      hide_voters: false,
    });
    expect(mapped.note?.pinToTop).toBe(false);
    expect(mapped.reminder?.repeat).toBe("none");
    expect(mapped.priority).toBeUndefined();
  });
});

describe("senderLabelFor", () => {
  const message = toChatMessage(base);

  it("returns youLabel for the current user", () => {
    expect(senderLabelFor(message, "u1", "Bạn", [])).toBe("Bạn");
  });

  it("uses name context and falls back to sender id", () => {
    expect(
      senderLabelFor(message, "other", "Bạn", [{ user_id: "u1", display_name: "  An  " }]),
    ).toBe("An");
    expect(senderLabelFor(message, "other", "Bạn", [{ user_id: "u1", display_name: "  " }])).toBe(
      "u1",
    );
    expect(senderLabelFor(message, "other", "Bạn", [])).toBe("u1");
  });
});
