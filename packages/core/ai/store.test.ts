import { afterEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "./store";

describe("ai panel store", () => {
  afterEach(() => {
    useAiPanelStore.setState({
      open: false,
      conversationId: null,
      pendingFocus: null,
      focus: null,
      workspaceId: null,
      focusByConversation: {},
      conversationByMeeting: {},
    });
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
});
