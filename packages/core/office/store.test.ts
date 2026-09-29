import { describe, expect, it } from "vitest";
import { useOfficeStore } from "./store";

describe("office session store", () => {
  it("stores session references and UI state without document payload", () => {
    useOfficeStore.getState().reset();
    useOfficeStore.getState().setIdentity({
      deploymentId: "dep-1",
      accountId: "acct-1",
      organizationId: "org-1",
      workspaceId: "ws-1",
      documentId: "doc-1",
      generation: 1,
      baseVersionId: "version-1",
      baseRevision: "1",
    });
    useOfficeStore.getState().setTab("tab-1");
    useOfficeStore.getState().setSelection("A1");
    useOfficeStore.getState().setDirtyGeneration(2);
    expect(useOfficeStore.getState()).toMatchObject({
      tabId: "tab-1",
      selection: "A1",
      dirtyGeneration: 2,
      saveState: "dirty",
      identity: { documentId: "doc-1", baseRevision: "1" },
    });
    expect("content" in useOfficeStore.getState()).toBe(false);
  });

  it("keeps a conflict or blocked banner visible when a new edit arrives", () => {
    useOfficeStore.getState().reset();
    useOfficeStore.getState().setSaveState("conflict");
    useOfficeStore.getState().setDirtyGeneration(3);
    expect(useOfficeStore.getState()).toMatchObject({ saveState: "conflict", dirtyGeneration: 3 });
    useOfficeStore.getState().setSaveState("blocked");
    useOfficeStore.getState().setDirtyGeneration(4);
    expect(useOfficeStore.getState()).toMatchObject({ saveState: "blocked", dirtyGeneration: 4 });
    useOfficeStore.getState().setSaveState("saved");
    useOfficeStore.getState().setDirtyGeneration(5);
    expect(useOfficeStore.getState()).toMatchObject({ saveState: "dirty", dirtyGeneration: 5 });
  });
});

