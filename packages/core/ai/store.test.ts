import { afterEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "./store";

describe("ai panel store", () => {
  afterEach(() => {
    useAiPanelStore.setState({ view: "thread", composerPrefill: null, open: false, conversationId: null, pendingFocus: null, focus: null, workspaceId: null });
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
    s.select("c1");
    s.bindWorkspace("w1");
    expect(useAiPanelStore.getState().conversationId).toBe("c1");
    s.bindWorkspace("w2");
    expect(useAiPanelStore.getState()).toMatchObject({ workspaceId: "w2", conversationId: null, pendingFocus: null });
  });

  it("the first bind keeps what was selected", () => {
    useAiPanelStore.getState().select("c1");
    useAiPanelStore.getState().bindWorkspace("w1");
    expect(useAiPanelStore.getState()).toMatchObject({ workspaceId: "w1", conversationId: "c1" });
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
    s.setView("memory-import");
    s.bindWorkspace("w1");
    expect(useAiPanelStore.getState().view).toBe("memory-import");
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

  it("composerPrefill is set and cleared", () => {
    const s = useAiPanelStore.getState();
    s.setComposerPrefill("Cập nhật bộ nhớ của tôi: ");
    expect(useAiPanelStore.getState().composerPrefill).toBe("Cập nhật bộ nhớ của tôi: ");
    s.setComposerPrefill(null);
    expect(useAiPanelStore.getState().composerPrefill).toBeNull();
  });
});
