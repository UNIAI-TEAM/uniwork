import { describe, expect, it } from "vitest";
import { notesCommitAllowed, notesPaneMode, notesStatus } from "./notes-pane-state";

describe("notesPaneMode", () => {
  it("reports unbound before every other state", () => {
    expect(notesPaneMode({ slideIndex: null, loading: true, unbound: true })).toBe("unbound");
    expect(notesPaneMode({ slideIndex: 0, loading: false, unbound: true })).toBe("unbound");
  });

  it("asks for a slide when none is selected", () => {
    expect(notesPaneMode({ slideIndex: null, loading: false, unbound: false })).toBe("no_slide");
    expect(notesPaneMode({ slideIndex: -1, loading: false, unbound: false })).toBe("no_slide");
    expect(notesPaneMode({ slideIndex: 0.5, loading: false, unbound: false })).toBe("no_slide");
  });

  it("resolves an unread baseline to unbound, after the slide and loading checks", () => {
    expect(notesPaneMode({ slideIndex: 0, loading: false, unbound: false, unread: true })).toBe("unbound");
    expect(notesPaneMode({ slideIndex: null, loading: false, unbound: false, unread: true })).toBe("no_slide");
    expect(notesPaneMode({ slideIndex: 0, loading: true, unbound: false, unread: true })).toBe("loading");
    expect(notesPaneMode({ slideIndex: 0, loading: false, unbound: false, unread: false })).toBe("ready");
  });

  it("reports loading before ready", () => {
    expect(notesPaneMode({ slideIndex: 2, loading: true, unbound: false })).toBe("loading");
    expect(notesPaneMode({ slideIndex: 2, loading: false, unbound: false })).toBe("ready");
    expect(notesPaneMode({ slideIndex: 0, loading: false, unbound: false })).toBe("ready");
  });
});

describe("notesStatus", () => {
  it("lets a pending commit outrank a dirty draft", () => {
    expect(notesStatus({ dirty: true, pending: true })).toBe("pending");
    expect(notesStatus({ dirty: false, pending: true })).toBe("pending");
    expect(notesStatus({ dirty: true, pending: false })).toBe("dirty");
    expect(notesStatus({ dirty: false, pending: false })).toBe("saved");
  });
});

describe("notesCommitAllowed", () => {
  const base = { bound: "old", draft: "new", pending: false, readonly: false, boundPort: true };

  it("allows a real change with a bound port and a loaded baseline", () => {
    expect(notesCommitAllowed(base)).toBe(true);
  });

  it("refuses when nothing changed", () => {
    expect(notesCommitAllowed({ ...base, draft: "old" })).toBe(false);
  });

  it("refuses without a bound port, while readonly or while pending", () => {
    expect(notesCommitAllowed({ ...base, boundPort: false })).toBe(false);
    expect(notesCommitAllowed({ ...base, readonly: true })).toBe(false);
    expect(notesCommitAllowed({ ...base, pending: true })).toBe(false);
  });

  it("refuses while the baseline has not loaded (bound null)", () => {
    expect(notesCommitAllowed({ ...base, bound: null, draft: "new" })).toBe(false);
  });

  it("allows clearing the notes with an empty draft (the engine accepts an empty string)", () => {
    expect(notesCommitAllowed({ ...base, bound: "old", draft: "" })).toBe(true);
  });
});
