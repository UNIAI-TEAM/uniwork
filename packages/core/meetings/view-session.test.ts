import { describe, expect, it, beforeEach } from "vitest";
import { useMeetingViewSessionStore } from "./view-session";

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
});
