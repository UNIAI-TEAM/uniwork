import { beforeEach, describe, expect, it } from "vitest";
import {
  getPollVotesForUser,
  resetChatRoomBulletinForTests,
  useChatRoomBulletinStore,
} from "./room-bulletin-store";

const ROOM_ID = "ws1/r1";

beforeEach(() => {
  resetChatRoomBulletinForTests();
});

describe("useChatRoomBulletinStore", () => {
  it("adds a reminder with trimmed body and default repeat", () => {
    useChatRoomBulletinStore
      .getState()
      .addReminder(ROOM_ID, { body: "  Standup  ", remindAt: "2026-09-08T09:00:00.000Z" });
    const reminders = useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID] ?? [];
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.body).toBe("Standup");
    expect(reminders[0]?.remindAt).toBe("2026-09-08T09:00:00.000Z");
    expect(reminders[0]?.repeat).toBe("none");
    expect(typeof reminders[0]?.id).toBe("string");
    expect(typeof reminders[0]?.createdAt).toBe("string");
  });

  it("ignores reminders with blank body", () => {
    useChatRoomBulletinStore.getState().addReminder(ROOM_ID, { body: "   ", remindAt: "2026-09-08T09:00:00.000Z" });
    expect(useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID] ?? []).toHaveLength(0);
  });

  it("keeps repeat, creator and appends multiple reminders", () => {
    const store = useChatRoomBulletinStore.getState();
    store.addReminder(ROOM_ID, { body: "First", remindAt: "2026-09-08T09:00:00.000Z", repeat: "daily", createdBy: "u1" });
    useChatRoomBulletinStore
      .getState()
      .addReminder(ROOM_ID, { body: "Second", remindAt: "2026-09-09T09:00:00.000Z" });
    const reminders = useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID] ?? [];
    expect(reminders).toHaveLength(2);
    expect(reminders[0]?.repeat).toBe("daily");
    expect(reminders[0]?.createdBy).toBe("u1");
    expect(reminders[1]?.body).toBe("Second");
  });

  it("adds a note with trimmed fields", () => {
    useChatRoomBulletinStore.getState().addNote(ROOM_ID, { title: "  Retro  ", body: "  Keep it short  " });
    const notes = useChatRoomBulletinStore.getState().notesByRoomId[ROOM_ID] ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe("Retro");
    expect(notes[0]?.body).toBe("Keep it short");
    expect(typeof notes[0]?.id).toBe("string");
  });

  it("ignores notes with blank title", () => {
    useChatRoomBulletinStore.getState().addNote(ROOM_ID, { title: "  ", body: "Body" });
    expect(useChatRoomBulletinStore.getState().notesByRoomId[ROOM_ID] ?? []).toHaveLength(0);
  });

  it("ignores notes with blank body", () => {
    useChatRoomBulletinStore.getState().addNote(ROOM_ID, { title: "Title", body: "   " });
    expect(useChatRoomBulletinStore.getState().notesByRoomId[ROOM_ID] ?? []).toHaveLength(0);
  });

  it("creates a poll with options and merged settings", () => {
    const pollId = useChatRoomBulletinStore
      .getState()
      .addPoll(ROOM_ID, { question: "  Lunch?  ", options: [" Pizza ", "Sushi"], createdBy: "u1" });
    expect(typeof pollId).toBe("string");
    const polls = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID] ?? [];
    expect(polls).toHaveLength(1);
    expect(polls[0]?.id).toBe(pollId);
    expect(polls[0]?.question).toBe("Lunch?");
    expect(polls[0]?.options.map((option) => option.label)).toEqual(["Pizza", "Sushi"]);
    expect(polls[0]?.options.every((option) => option.votes === 0)).toBe(true);
    expect(polls[0]?.createdBy).toBe("u1");
    expect(polls[0]?.settings.allowMultiple).toBe(true);
    expect(polls[0]?.settings.allowAddOptions).toBe(true);
  });

  it("returns null for a blank poll question", () => {
    const pollId = useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "   ", options: ["A", "B"] });
    expect(pollId).toBeNull();
    expect(useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID] ?? []).toHaveLength(0);
  });

  it("returns null when fewer than two usable options remain", () => {
    expect(useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "Q?", options: ["Only"] })).toBeNull();
    expect(
      useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "Q?", options: ["A", "   ", ""] }),
    ).toBeNull();
    expect(useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID] ?? []).toHaveLength(0);
  });

  it("toggles a single-choice vote off on duplicate vote", () => {
    const pollId = useChatRoomBulletinStore
      .getState()
      .addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"], settings: { allowMultiple: false } });
    expect(typeof pollId).toBe("string");
    if (pollId === null) return;
    const optionId = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options[0]?.id ?? "";
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, pollId, optionId, "voter1");
    expect(getPollVotesForUser(ROOM_ID, pollId, "voter1")).toEqual([optionId]);
    expect(useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options[0]?.votes).toBe(1);
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, pollId, optionId, "voter1");
    expect(getPollVotesForUser(ROOM_ID, pollId, "voter1")).toEqual([]);
    expect(useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options[0]?.votes).toBe(0);
  });

  it("moves a single-choice vote between options", () => {
    const pollId = useChatRoomBulletinStore
      .getState()
      .addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"], settings: { allowMultiple: false } });
    if (pollId === null) return;
    const options = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options ?? [];
    const first = options[0]?.id ?? "";
    const second = options[1]?.id ?? "";
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, pollId, first, "voter1");
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, pollId, second, "voter1");
    expect(getPollVotesForUser(ROOM_ID, pollId, "voter1")).toEqual([second]);
    const updated = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options ?? [];
    expect(updated[0]?.votes).toBe(0);
    expect(updated[1]?.votes).toBe(1);
  });

  it("toggles multiple-choice votes independently", () => {
    const pollId = useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"] });
    if (pollId === null) return;
    const options = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options ?? [];
    const first = options[0]?.id ?? "";
    const second = options[1]?.id ?? "";
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, pollId, first, "voter1");
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, pollId, second, "voter1");
    expect(getPollVotesForUser(ROOM_ID, pollId, "voter1")).toEqual([first, second]);
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, pollId, first, "voter1");
    expect(getPollVotesForUser(ROOM_ID, pollId, "voter1")).toEqual([second]);
    const updated = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options ?? [];
    expect(updated[0]?.votes).toBe(0);
    expect(updated[1]?.votes).toBe(1);
  });

  it("ignores votes for a missing poll", () => {
    const pollId = useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"] });
    if (pollId === null) return;
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, "missing", "opt", "voter1");
    expect(getPollVotesForUser(ROOM_ID, "missing", "voter1")).toEqual([]);
    const options = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options ?? [];
    expect(options[0]?.votes).toBe(0);
    expect(options[1]?.votes).toBe(0);
  });

  it("leaves vote counts unchanged for a missing option", () => {
    const pollId = useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"] });
    if (pollId === null) return;
    useChatRoomBulletinStore.getState().votePoll(ROOM_ID, pollId, "missing-option", "voter1");
    const options = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options ?? [];
    expect(options[0]?.votes).toBe(0);
    expect(options[1]?.votes).toBe(0);
    expect(getPollVotesForUser(ROOM_ID, pollId, "voter1")).toEqual(["missing-option"]);
  });

  it("appends a trimmed poll option", () => {
    const pollId = useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"] });
    if (pollId === null) return;
    useChatRoomBulletinStore.getState().addPollOption(ROOM_ID, pollId, "  C  ");
    const options = useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options ?? [];
    expect(options).toHaveLength(3);
    expect(options[2]?.label).toBe("C");
    expect(options[2]?.votes).toBe(0);
  });

  it("ignores blank poll option labels", () => {
    const pollId = useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"] });
    if (pollId === null) return;
    useChatRoomBulletinStore.getState().addPollOption(ROOM_ID, pollId, "   ");
    expect(useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options).toHaveLength(2);
  });

  it("ignores poll options for a missing poll", () => {
    const pollId = useChatRoomBulletinStore.getState().addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"] });
    if (pollId === null) return;
    useChatRoomBulletinStore.getState().addPollOption(ROOM_ID, "missing", "C");
    expect(useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options).toHaveLength(2);
  });

  it("respects allowAddOptions when adding poll options", () => {
    const pollId = useChatRoomBulletinStore
      .getState()
      .addPoll(ROOM_ID, { question: "Q?", options: ["A", "B"], settings: { allowAddOptions: false } });
    if (pollId === null) return;
    useChatRoomBulletinStore.getState().addPollOption(ROOM_ID, pollId, "C");
    expect(useChatRoomBulletinStore.getState().pollsByRoomId[ROOM_ID]?.[0]?.options).toHaveLength(2);
  });

  it("advances an existing reminder", () => {
    useChatRoomBulletinStore.getState().addReminder(ROOM_ID, { body: "Call", remindAt: "2026-09-08T09:00:00.000Z" });
    const reminderId = useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID]?.[0]?.id ?? "";
    useChatRoomBulletinStore.getState().advanceReminder(ROOM_ID, reminderId, "2026-09-09T09:00:00.000Z");
    const reminders = useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID] ?? [];
    expect(reminders[0]?.remindAt).toBe("2026-09-09T09:00:00.000Z");
    expect(reminders[0]?.body).toBe("Call");
  });

  it("leaves reminders unchanged when advancing a missing id", () => {
    useChatRoomBulletinStore.getState().addReminder(ROOM_ID, { body: "Call", remindAt: "2026-09-08T09:00:00.000Z" });
    useChatRoomBulletinStore.getState().advanceReminder(ROOM_ID, "missing", "2026-09-09T09:00:00.000Z");
    const reminders = useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID] ?? [];
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.remindAt).toBe("2026-09-08T09:00:00.000Z");
  });

  it("removes an existing reminder", () => {
    useChatRoomBulletinStore.getState().addReminder(ROOM_ID, { body: "One", remindAt: "2026-09-08T09:00:00.000Z" });
    useChatRoomBulletinStore.getState().addReminder(ROOM_ID, { body: "Two", remindAt: "2026-09-08T10:00:00.000Z" });
    const reminderId = useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID]?.[0]?.id ?? "";
    useChatRoomBulletinStore.getState().removeReminder(ROOM_ID, reminderId);
    const reminders = useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID] ?? [];
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.body).toBe("Two");
  });

  it("leaves reminders unchanged when removing a missing id", () => {
    useChatRoomBulletinStore.getState().addReminder(ROOM_ID, { body: "One", remindAt: "2026-09-08T09:00:00.000Z" });
    useChatRoomBulletinStore.getState().removeReminder(ROOM_ID, "missing");
    expect(useChatRoomBulletinStore.getState().remindersByRoomId[ROOM_ID] ?? []).toHaveLength(1);
  });

  it("resets all bulletin state for tests", () => {
    useChatRoomBulletinStore.getState().addReminder(ROOM_ID, { body: "One", remindAt: "2026-09-08T09:00:00.000Z" });
    useChatRoomBulletinStore.getState().addNote(ROOM_ID, { title: "T", body: "B" });
    resetChatRoomBulletinForTests();
    const state = useChatRoomBulletinStore.getState();
    expect(state.remindersByRoomId).toEqual({});
    expect(state.notesByRoomId).toEqual({});
    expect(state.pollsByRoomId).toEqual({});
    expect(state.pollVotesById).toEqual({});
  });
});
