import { renderHook } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useMeetingViewSessionScope, useMeetingViewSessionStore } from "./view-session";

describe("useMeetingViewSessionStore", () => {
  beforeEach(() => {
    useMeetingViewSessionStore.getState().reset();
  });

  it("pins, hides, and resets session view state", () => {
    const store = useMeetingViewSessionStore.getState();
    store.pinParticipant("a");
    store.toggleHidden("b");
    store.toggleHidden("b");

    expect(useMeetingViewSessionStore.getState().pinnedIdentity).toBe("a");
    expect(useMeetingViewSessionStore.getState().hiddenIdentities).toEqual([]);

    store.toggleHidden("c");
    expect(useMeetingViewSessionStore.getState().isHidden("c")).toBe(true);

    store.reset();
    expect(useMeetingViewSessionStore.getState()).toMatchObject({
      pinnedIdentity: null,
      hiddenIdentities: [],
    });
  });

  it("remembers the presenter's preview choice by share, not by tile", () => {
    const store = useMeetingViewSessionStore.getState();
    store.setSharePreviewHidden("capture-1", true);
    expect(useMeetingViewSessionStore.getState().hiddenSharePreviews).toEqual({ "capture-1": true });
    // Shown on purpose is a choice too: a window share starts hidden.
    store.setSharePreviewHidden("capture-1", false);
    expect(useMeetingViewSessionStore.getState().hiddenSharePreviews).toEqual({ "capture-1": false });
    store.setSharePreviewHidden("capture-2", true);
    store.reset();
    expect(useMeetingViewSessionStore.getState().hiddenSharePreviews).toEqual({});
  });

  it("forgets hides, pins and preview choices when the room is left or another meeting opens", () => {
    const { rerender, unmount } = renderHook(({ id }: { id: string }) => useMeetingViewSessionScope(id), {
      initialProps: { id: "m1" },
    });
    const store = useMeetingViewSessionStore.getState();
    store.toggleHidden("b");
    store.pinParticipant("a");
    store.setSharePreviewHidden("capture-1", true);
    rerender({ id: "m1" });
    expect(useMeetingViewSessionStore.getState().hiddenIdentities).toEqual(["b"]);

    rerender({ id: "m2" });
    expect(useMeetingViewSessionStore.getState()).toMatchObject({
      pinnedIdentity: null,
      hiddenIdentities: [],
      hiddenSharePreviews: {},
    });

    useMeetingViewSessionStore.getState().toggleHidden("c");
    unmount();
    expect(useMeetingViewSessionStore.getState().hiddenIdentities).toEqual([]);
  });
});
