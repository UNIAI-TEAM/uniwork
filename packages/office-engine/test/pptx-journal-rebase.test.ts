// UNI-927 W14 - the save-point rebase both pptx runtimes move their history through.
import { describe, expect, it } from "vitest";
import { rebasePptxJournal, type PptxJournalHistory } from "../src/pptx";

const same = (live: string, saved: unknown) => live === saved;
const history = (): PptxJournalHistory<string> => ({ journal: ["a", "b", "c", "d", "e"], cursor: 4, steps: [1, 3, 4, 5], revision: 4 });

describe("rebasePptxJournal", () => {
  it("drops the saved prefix and shifts cursor, revision, steps and the redo tail", () => {
    const state = history();
    expect(rebasePptxJournal(state, ["a", "b", "c"], same)).toBe(true);
    expect(state).toEqual({ journal: ["d", "e"], cursor: 1, steps: [1, 2], revision: 1 });
  });

  it("is a no-op for an empty saved prefix", () => {
    const state = history();
    expect(rebasePptxJournal(state, [], same)).toBe(true);
    expect(state).toEqual(history());
  });

  it("refuses, untouched, when the live model holds fewer entries than were saved", () => {
    const state = history();
    expect(rebasePptxJournal(state, ["a", "b", "c", "d", "e"], same)).toBe(false);
    expect(state).toEqual(history());
  });

  it("refuses, untouched, when an entry of the saved prefix differs", () => {
    const state = history();
    expect(rebasePptxJournal(state, ["a", "x"], same)).toBe(false);
    expect(state).toEqual(history());
  });
});
