import { afterEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "./store";

describe("ai panel store", () => {
  afterEach(() => {
    useAiPanelStore.setState({ open: false, conversationId: null, pendingFocus: null, workspaceId: null });
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
