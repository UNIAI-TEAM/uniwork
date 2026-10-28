import { afterEach, describe, expect, it } from "vitest";
import { buildTransientTranscript, MAX_TRANSIENT_CHARS, MAX_TRANSIENT_TURNS, useAiPanelStore } from "./store";
import type { AiMessage } from "../types/ai";

function turn(role: "user" | "assistant", content: string, id = `${role}-${content}`): AiMessage {
  return {
    id,
    role,
    content,
    citations: [],
    notice: "",
    steps: [],
    followups: [],
    focus: null,
    mentions: [],
    model: "",
    attachments: [],
    file_notes: [],
    proposals: [],
    memory_ids: [],
    memory_proposals: [],
    created_at: "",
  };
}

describe("ai panel store", () => {
  afterEach(() => {
    useAiPanelStore.getState().reset();
  });

  it("setFocus stores the hand-picked focus; a new conversation and a workspace change clear it", () => {
    const s = useAiPanelStore.getState();
    s.bindWorkspace("w1");
    s.setFocus({ kind: "task", id: "t1", label: "A" });
    expect(useAiPanelStore.getState().focus).toEqual({ kind: "task", id: "t1", label: "A" });
    s.select("c1");
    expect(useAiPanelStore.getState().focus).not.toBeNull();
    s.select(null);
    expect(useAiPanelStore.getState().focus).toBeNull();
    s.setFocus({ kind: "task", id: "t1" });
    s.bindWorkspace("w2");
    expect(useAiPanelStore.getState().focus).toBeNull();
  });

  it("drops the selected conversation and focus when the workspace changes", () => {
    const s = useAiPanelStore.getState();
    s.bindWorkspace("w1");
    s.select("c1");
    s.openWithFocus({ kind: "task", id: "t1" });
    s.bindWorkspace("w1");
    expect(useAiPanelStore.getState().pendingFocus).toEqual({ kind: "task", id: "t1" });
    s.bindWorkspace("w2");
    expect(useAiPanelStore.getState()).toMatchObject({ workspaceId: "w2", conversationId: null, pendingFocus: null });
  });

  it("the first bind keeps what was selected", () => {
    useAiPanelStore.getState().select("c1");
    useAiPanelStore.getState().bindWorkspace("w1");
    expect(useAiPanelStore.getState()).toMatchObject({ workspaceId: "w1", conversationId: "c1" });
  });

  it("picking another conversation drops a focus meant for a new question", () => {
    const s = useAiPanelStore.getState();
    s.openWithFocus({ kind: "email_thread", id: "e1" });
    s.select("c9");
    expect(useAiPanelStore.getState()).toMatchObject({ conversationId: "c9", pendingFocus: null });
  });

  it("opens a conversation handed over from a meeting with its focus, and remembers it for that meeting", () => {
    useAiPanelStore.getState().openConversation("c1", { kind: "meeting", id: "m1" });
    expect(useAiPanelStore.getState()).toMatchObject({
      open: true,
      conversationId: "c1",
      pendingFocus: null,
      focus: { kind: "meeting", id: "m1" },
      focusByConversation: { c1: { kind: "meeting", id: "m1" } },
      conversationByMeeting: { m1: "c1" },
    });
    useAiPanelStore.getState().rememberFocus("c2", { kind: "task", id: "t1" });
    expect(useAiPanelStore.getState().conversationByMeeting).toEqual({ m1: "c1" });
    useAiPanelStore.getState().forgetConversation("c1");
    expect(useAiPanelStore.getState()).toMatchObject({
      conversationId: null,
      focusByConversation: { c2: { kind: "task", id: "t1" } },
      conversationByMeeting: {},
    });
  });

  it("reset forgets every conversation, for the next person on this browser", () => {
    useAiPanelStore.getState().bindWorkspace("w1");
    useAiPanelStore.getState().openConversation("c1", { kind: "meeting", id: "m1" });
    useAiPanelStore.getState().reset();
    expect(useAiPanelStore.getState()).toMatchObject({
      open: false,
      conversationId: null,
      workspaceId: null,
      focusByConversation: {},
      conversationByMeeting: {},
    });
  });
});

describe("ai panel page context", () => {
  const T = { kind: "task", id: "t1", label: "A" } as const;
  const U = { kind: "task", id: "t2", label: "B" } as const;
  afterEach(() => useAiPanelStore.setState({ page: null, pageDismissed: null }));

  it("a dismissed page stays dismissed on a same-key update and returns on another page", () => {
    const s = useAiPanelStore.getState();
    s.setPage(T);
    s.dismissPage();
    expect(useAiPanelStore.getState().pageDismissed).toBe("task:t1");
    s.setPage({ ...T, label: "Renamed" });
    expect(useAiPanelStore.getState()).toMatchObject({ page: { label: "Renamed" }, pageDismissed: "task:t1" });
    s.setPage(U);
    expect(useAiPanelStore.getState().pageDismissed).toBeNull();
  });

  it("setPage(null) clears the page", () => {
    useAiPanelStore.getState().setPage(T);
    useAiPanelStore.getState().setPage(null);
    expect(useAiPanelStore.getState().page).toBeNull();
  });

  it("view switches to memory and back to the thread on a workspace change or close", () => {
    const s = useAiPanelStore.getState();
    s.bindWorkspace("w1");
    expect(useAiPanelStore.getState().view).toBe("thread");
    s.setView("memory");
    expect(useAiPanelStore.getState().view).toBe("memory");
    s.bindWorkspace("w1");
    expect(useAiPanelStore.getState().view).toBe("memory");
    s.bindWorkspace("w2");
    expect(useAiPanelStore.getState().view).toBe("thread");
    s.setView("memory");
    s.setOpen(false);
    expect(useAiPanelStore.getState().view).toBe("thread");
    s.setView("memory");
    s.toggle();
    s.toggle();
    expect(useAiPanelStore.getState().view).toBe("thread");
  });

  it("the memory help strip opens on the thread and goes with a workspace change or close", () => {
    const s = useAiPanelStore.getState();
    s.bindWorkspace("w1");
    s.setView("memory");
    s.openMemoryHelp();
    expect(useAiPanelStore.getState()).toMatchObject({ view: "thread", memoryHelp: true });
    s.setMemoryHelp(false);
    expect(useAiPanelStore.getState().memoryHelp).toBe(false);
    s.openMemoryHelp();
    s.bindWorkspace("w2");
    expect(useAiPanelStore.getState().memoryHelp).toBe(false);
    s.openMemoryHelp();
    s.setOpen(false);
    expect(useAiPanelStore.getState().memoryHelp).toBe(false);
  });

  it("composerPrefill is set and cleared", () => {
    const s = useAiPanelStore.getState();
    s.setComposerPrefill("Cập nhật bộ nhớ của tôi: ");
    expect(useAiPanelStore.getState().composerPrefill).toBe("Cập nhật bộ nhớ của tôi: ");
    s.setComposerPrefill(null);
    expect(useAiPanelStore.getState().composerPrefill).toBeNull();
  });
});

describe("ai panel transient mode (drive_file)", () => {
  afterEach(() => {
    useAiPanelStore.getState().reset();
  });

  it("buildTransientTranscript keeps up to 20 turns and slides the window on turn 21", () => {
    const twenty = Array.from({ length: MAX_TRANSIENT_TURNS }, (_, i) =>
      turn(i % 2 === 0 ? "user" : "assistant", `turn-${i + 1}`),
    );
    const exact = buildTransientTranscript(twenty);
    expect(exact.trimmed).toBe(false);
    expect(exact.transcript).toHaveLength(20);
    expect(exact.transcript[0]).toEqual({ role: "user", text: "turn-1" });

    const twentyOne = [...twenty, turn("user", "turn-21")];
    const slid = buildTransientTranscript(twentyOne);
    expect(slid.trimmed).toBe(true);
    expect(slid.transcript).toHaveLength(20);
    expect(slid.transcript[0]).toEqual({ role: "assistant", text: "turn-2" });
    expect(slid.transcript[19]).toEqual({ role: "user", text: "turn-21" });
  });

  it("buildTransientTranscript drops oldest turns until total characters are <= 32,000", () => {
    const first = "a".repeat(20_000);
    const second = "b".repeat(10_000);
    const third = "c".repeat(5_000);
    const messages = [
      turn("user", first),
      turn("assistant", second),
      turn("user", third),
    ];
    const res = buildTransientTranscript(messages);
    expect(res.trimmed).toBe(true);
    expect(res.transcript).toEqual([
      { role: "assistant", text: second },
      { role: "user", text: third },
    ]);
    expect(res.transcript.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(MAX_TRANSIENT_CHARS);
  });
  it("buildTransientTranscript skips turns with empty or whitespace-only content and carries role and text only", () => {
    const res = buildTransientTranscript([
      turn("user", "q1"),
      turn("assistant", ""),
      turn("user", "   \n\t  "),
      turn("user", "q2"),
      turn("assistant", "a2"),
    ]);
    expect(res.trimmed).toBe(false);
    expect(res.transcript).toEqual([
      { role: "user", text: "q1" },
      { role: "user", text: "q2" },
      { role: "assistant", text: "a2" },
    ]);
    for (const item of res.transcript) {
      expect(Object.keys(item).sort()).toEqual(["role", "text"]);
      expect(item.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("does not bump transientEpoch on setPage(null) or dismissPage when a saved conversation is open on a drive_file page, and select(null) keeps the page chip undismissed", () => {
    const s = useAiPanelStore.getState();
    s.bindWorkspace("w1");
    s.setPage({ kind: "drive_file", id: "df1", label: "Kế hoạch Q4" });
    s.select("c1");
    expect(useAiPanelStore.getState()).toMatchObject({
      conversationId: "c1",
      pageDismissed: null,
      transientMessages: [],
    });
    const epochBefore = useAiPanelStore.getState().transientEpoch;
    s.dismissPage();
    expect(useAiPanelStore.getState().transientEpoch).toBe(epochBefore);
    s.setPage(null);
    expect(useAiPanelStore.getState().transientEpoch).toBe(epochBefore);

    // Picking a saved conversation and then pressing "Hội thoại mới" (select(null)) preserves the page chip
    s.setPage({ kind: "drive_file", id: "df1", label: "Kế hoạch Q4" });
    s.select("c1");
    s.select(null);
    expect(useAiPanelStore.getState()).toMatchObject({
      conversationId: null,
      page: { kind: "drive_file", id: "df1", label: "Kế hoạch Q4" },
      pageDismissed: null,
    });
  });

  it("bumps transientEpoch when dismissing an active drive_file page chip in a fresh thread, and does not bump when already dismissed or on select(conv_new) / setConversationFromRun afterward", () => {
    const s = useAiPanelStore.getState();
    s.bindWorkspace("w1");
    s.setPage({ kind: "drive_file", id: "df1", label: "Kế hoạch Q4" });
    const epoch0 = useAiPanelStore.getState().transientEpoch;
    s.dismissPage();
    expect(useAiPanelStore.getState()).toMatchObject({
      pageDismissed: "drive_file:df1",
      transientEpoch: epoch0 + 1,
    });
    // Dismissing again when already dismissed does not bump
    s.dismissPage();
    expect(useAiPanelStore.getState()).toMatchObject({
      pageDismissed: "drive_file:df1",
      transientEpoch: epoch0 + 1,
    });
    s.select("conv_new");
    expect(useAiPanelStore.getState()).toMatchObject({
      conversationId: "conv_new",
      transientEpoch: epoch0 + 1,
    });
    s.select(null);
    s.setConversationFromRun("conv_run");
    expect(useAiPanelStore.getState()).toMatchObject({
      conversationId: "conv_run",
      transientEpoch: epoch0 + 1,
    });
  });

  it("clears transient transcript on panel close, focus change, picking a saved conversation, or new conversation", () => {
    const s = useAiPanelStore.getState();
    s.bindWorkspace("w1");
    s.setFocus({ kind: "drive_file", id: "df1", label: "Kế hoạch Q4", accountEmail: "a@gmail.com" });
    s.appendTransientTurn(turn("user", "q1"), turn("assistant", "a1"));
    expect(useAiPanelStore.getState().transientMessages).toHaveLength(2);

    // Changing focus to another file or task clears the transcript
    s.setFocus({ kind: "drive_file", id: "df2", label: "File 2" });
    expect(useAiPanelStore.getState().transientMessages).toEqual([]);

    // Picking a saved conversation clears the transcript AND drops the drive_file focus
    s.appendTransientTurn(turn("user", "q1"), turn("assistant", "a1"));
    s.select("c1");
    expect(useAiPanelStore.getState()).toMatchObject({
      conversationId: "c1",
      focus: null,
      transientMessages: [],
      transientWindowTrimmed: false,
    });

    // Closing the panel clears the transcript and drops drive_file focus
    s.openWithFocus({ kind: "drive_file", id: "df1", label: "Kế hoạch Q4" });
    s.setFocus({ kind: "drive_file", id: "df1", label: "Kế hoạch Q4" });
    s.appendTransientTurn(turn("user", "q1"), turn("assistant", "a1"));
    s.setOpen(false);
    expect(useAiPanelStore.getState()).toMatchObject({
      open: false,
      focus: null,
      transientMessages: [],
    });

    // "Hội thoại mới" (select(null)) clears the transcript and focus
    s.setOpen(true);
    s.setFocus({ kind: "drive_file", id: "df1" });
    s.appendTransientTurn(turn("user", "q1"), turn("assistant", "a1"));
    s.select(null);
    expect(useAiPanelStore.getState()).toMatchObject({
      conversationId: null,
      focus: null,
      transientMessages: [],
    });
  });
});
