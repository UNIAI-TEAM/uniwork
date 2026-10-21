import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { i18n } from "./i18n/singleton";
import { KNOWN_MESSAGE_KINDS, formatFileSize, isChatMediaUrlFresh, isReminderDue, messageContent, messagePreviewText, messageView, pendingPreviewText, pollResults, voiceCallLogLabel } from "./message-display";
import { formatVoiceCallDuration } from "@uniwork/core/chat/voice-call-duration";

const base = ChatMessageSchema.parse({
  id: "m1",
  room_id: "r1",
  workspace_id: "w1",
  sender_id: "u1",
  sender_display_name: "An",
  body: "hi",
  created_at: "2026-10-17T10:00:00Z",
});
const file = (filename: string, content_type = "") => ({ filename, content_type, size_bytes: 1, url: "", download_url: "", thumb_url: "", url_expires_at: "" });
const poll = {
  question: "Ăn gì?",
  options: [
    { id: "o1", label: "Phở", votes: 3 },
    { id: "o2", label: "Bún", votes: 1 },
  ],
  settings: { deadline_at: null, pin_to_top: false, allow_multiple: true, allow_add_options: true, hide_results_until_vote: false, hide_voters: false },
  viewer_option_ids: [] as string[],
  votes_by_user: undefined,
};

/** One complete message per kind the server writes (spec §5: every kind has a row). */
const byKind: Record<(typeof KNOWN_MESSAGE_KINDS)[number], ChatMessageRecord> = {
  text: base,
  system: { ...base, kind: "system" },
  voice_call_log: { ...base, kind: "voice_call_log", voice_call: { outcome: "completed", caller_id: "u1", duration_seconds: 65 } },
  poll: { ...base, kind: "poll", poll },
  reminder: { ...base, kind: "reminder", reminder: { body: "Họp", remind_at: "2026-10-17T11:00:00Z", repeat: "none" } },
  note: { ...base, kind: "note", note: { body: "Ghi chú", pin_to_top: false } },
  voice: { ...base, kind: "voice", voice: { duration_ms: 4000, content_type: "audio/mp4", size_bytes: 1, url: "", url_expires_at: "" } },
  file: { ...base, kind: "file", file: file("plan.pdf", "application/pdf") },
  post: { ...base, kind: "post", post: { title: "Tin", body: "Nội dung", pin_to_top: false } },
};

describe("messageView", () => {
  it("gives every kind the server writes a card of its own", () => {
    for (const kind of KNOWN_MESSAGE_KINDS) expect(messageView(byKind[kind]), kind).not.toBe("unsupported");
    expect(messageView(byKind.file)).toBe("file");
    expect(messageView({ ...byKind.file, file: file("IMG_1.jpg") })).toBe("image");
    expect(messageView({ ...base, body: "![sticker:vui](https://media.giphy.com/a.webp)" })).toBe("media");
    expect(messageView({ ...base, voice_call_summary: { call_id: "c", call_log_message_id: "m", summary: "", highlights: [], action_items: [] } })).toBe(
      "call-summary",
    );
  });

  // The card draws the payload the tag came with, never a field it asserts is there.
  it("carries the payload each card draws with its tag", () => {
    expect(messageContent(byKind.file)).toEqual({ view: "file", file: byKind.file.file });
    expect(messageContent(byKind.voice)).toEqual({ view: "voice", voice: byKind.voice.voice });
    expect(messageContent(byKind.poll)).toEqual({ view: "poll", poll: byKind.poll.poll });
    expect(messageContent(byKind.note)).toEqual({ view: "note", note: byKind.note.note });
    expect(messageContent(byKind.post)).toEqual({ view: "post", post: byKind.post.post });
    expect(messageContent(byKind.reminder)).toEqual({ view: "reminder", reminder: byKind.reminder.reminder });
    expect(messageContent({ ...base, body: "![sticker:vui](https://media.giphy.com/a.webp)" })).toMatchObject({ view: "media", media: { url: "https://media.giphy.com/a.webp" } });
    expect(messageContent(byKind.text)).toEqual({ view: "text" });
  });

  it("reads an unknown kind, or a known kind without its payload, as unsupported (a web link, never a crash)", () => {
    // The schema keeps any kind string, so a newer server's kind reaches the list.
    const future = ChatMessageSchema.parse({ ...base, kind: "whiteboard" });
    expect(messageView(future)).toBe("unsupported");
    for (const kind of ["file", "voice", "poll", "note", "post", "reminder"]) {
      expect(messageView({ ...base, kind }), kind).toBe("unsupported");
    }
  });
});

describe("labels", () => {
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key);

  it("names a call by outcome and side, as the web's call log row", () => {
    expect(voiceCallLogLabel(undefined, "u1", t)).toBe("chat.voice_call_log_unknown");
    expect(voiceCallLogLabel({ outcome: "completed", caller_id: "u1" }, "u1", t)).toBe('chat.voice_call_log_completed:{"duration":"0:00"}');
    expect(voiceCallLogLabel({ outcome: "declined", caller_id: "u1" }, "u1", t)).toBe("chat.voice_call_log_declined_outgoing");
    expect(voiceCallLogLabel({ outcome: "declined", caller_id: "u2" }, "u1", t)).toBe("chat.voice_call_log_declined_incoming");
    expect(voiceCallLogLabel({ outcome: "unanswered", caller_id: "u1", video: true }, "u1", t)).toBe("chat.video_call_log_cancelled");
    expect(voiceCallLogLabel({ outcome: "unanswered", caller_id: "u2" }, "u1", t)).toBe("chat.voice_call_log_missed");
    expect(voiceCallLogLabel({ outcome: "busy", caller_id: "u2" }, "u1", t)).toBe("chat.voice_call_log_unknown");
  });

  it("formats durations and sizes", () => {
    expect(formatVoiceCallDuration(65)).toBe("1:05");
    expect(formatVoiceCallDuration(3_725)).toBe("1:02:05");
    expect(formatVoiceCallDuration(-3)).toBe("0:00");
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(820 * 1024)).toBe("820 KB");
    expect(formatFileSize(1.44 * 1024 * 1024)).toBe("1.4 MB");
  });

  it("hides a poll's counts until the reader voted, when the poll says so", () => {
    expect(pollResults(poll)).toMatchObject({ hideCounts: false, total: 4, options: [{ percent: 75, mine: false }, { percent: 25 }] });
    const secret = { ...poll, settings: { ...poll.settings, hide_results_until_vote: true } };
    expect(pollResults(secret).hideCounts).toBe(true);
    expect(pollResults({ ...secret, viewer_option_ids: ["o2"] })).toMatchObject({ hideCounts: false, options: [{ mine: false }, { mine: true }] });
    expect(pollResults({ ...poll, options: [{ id: "o1", label: "x", votes: 0 }] }).options[0]?.percent).toBe(0);
    // Past its deadline a poll takes no vote (chat-poll-message-row.tsx › isPollExpired).
    const now = Date.parse("2026-10-17T10:00:00Z");
    expect(pollResults({ ...poll, settings: { ...poll.settings, deadline_at: "2026-10-17T09:00:00Z" } }, now).closed).toBe(true);
    expect(pollResults({ ...poll, settings: { ...poll.settings, deadline_at: "2026-10-17T11:00:00Z" } }, now).closed).toBe(false);
    expect(pollResults(poll, now).closed).toBe(false);
  });

  it("treats a signed URL as dead a minute before it expires", () => {
    const now = Date.parse("2026-10-17T10:00:00Z");
    expect(isChatMediaUrlFresh("https://s/a", "2026-10-17T10:05:00Z", now)).toBe(true);
    expect(isChatMediaUrlFresh("https://s/a", "2026-10-17T10:00:30Z", now)).toBe(false);
    expect(isChatMediaUrlFresh("https://s/a", "", now)).toBe(false);
    expect(isChatMediaUrlFresh("", "2026-10-17T11:00:00Z", now)).toBe(false);
    expect(isChatMediaUrlFresh("https://s/a", undefined)).toBe(false);
  });

  it("puts a message in one line for a reply quote", () => {
    const tVi = i18n.getFixedT("vi");
    expect(messagePreviewText({ ...base, body: "[@Lan](mention://member/u2) ơi" }, tVi)).toBe("@Lan ơi");
    expect(messagePreviewText(byKind.file, tVi)).toBe("plan.pdf");
    expect(messagePreviewText({ ...byKind.file, file: undefined, body: "" }, tVi)).toBe("Tệp đính kèm");
    expect(messagePreviewText(byKind.voice, tVi)).toBe("Tin nhắn thoại");
    expect(messagePreviewText(byKind.poll, tVi)).toBe("Ăn gì?");
    expect(messagePreviewText(byKind.post, tVi)).toBe("Tin");
    expect(messagePreviewText(byKind.note, tVi)).toBe("Ghi chú");
    expect(messagePreviewText(byKind.reminder, tVi)).toBe("Họp");
    expect(messagePreviewText({ ...base, body: "![gif:vui](https://media.tenor.com/a.gif)" }, tVi)).toBe("GIF · vui");
    expect(messagePreviewText({ ...base, body: " " }, tVi)).toBe("");
  });

  it("says whether a reminder is due", () => {
    expect(isReminderDue("2026-10-17T11:00:00Z", Date.parse("2026-10-17T11:00:00Z"))).toBe(true);
    expect(isReminderDue("2026-10-17T11:00:00Z", Date.parse("2026-10-17T10:00:00Z"))).toBe(false);
    expect(isReminderDue("garbage")).toBe(false);
  });
});

describe("pendingPreviewText", () => {
  it("says what a message still on its way is: its text with names, its file, a voice message or the reminder", () => {
    const tVi = i18n.getFixedT("vi");
    expect(pendingPreviewText({ body: "chào [@An](mention://member/u1)" }, tVi)).toBe("chào @An");
    expect(pendingPreviewText({ body: "", file: { uri: "file:///a", name: "báo giá.pdf" } }, tVi)).toBe("báo giá.pdf");
    expect(pendingPreviewText({ body: "", file: { uri: "file:///v", name: "voice.m4a" }, voiceDurationMs: 3_000 }, tVi)).toBe("Tin nhắn thoại");
    expect(pendingPreviewText({ body: "", reminder: { body: "Gửi báo giá", remindAt: "2026-10-18T02:00:00.000Z", repeat: "none" } }, tVi)).toBe("Gửi báo giá");
  });
});
