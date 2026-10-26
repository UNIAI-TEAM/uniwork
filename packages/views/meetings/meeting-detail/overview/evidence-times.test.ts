import { describe, expect, it } from "vitest";
import { evidenceAtIndex, firstRefAt } from "./evidence-times";

const segments = [
  { id: "s1", spoken_at: "2026-10-22T02:06:31Z" },
  { id: "s2", spoken_at: null },
];
const notes = [{ id: "n1", created_at: "2026-10-22T09:18:54+07:00" }];

describe("evidence times", () => {
  it("maps segments by spoken_at and notes by created_at", () => {
    const index = evidenceAtIndex(segments, notes);
    expect(index.get("segment:s1")).toBe("2026-10-22T02:06:31Z");
    expect(index.get("note:n1")).toBe("2026-10-22T09:18:54+07:00");
    // A line without a time is not guessed.
    expect(index.has("segment:s2")).toBe(false);
  });

  it("times a claim by its first ref only", () => {
    const index = evidenceAtIndex(segments, notes);
    expect(
      firstRefAt(
        [
          { kind: "note", id: "n1" },
          { kind: "segment", id: "s1" },
        ],
        index,
      ),
    ).toBe("2026-10-22T09:18:54+07:00");
  });

  it("leaves a chat ref, an unknown id and no ref to the fallback", () => {
    const index = evidenceAtIndex(segments, notes);
    expect(firstRefAt([{ kind: "chat", id: "s1" }], index)).toBeUndefined();
    expect(firstRefAt([{ kind: "segment", id: "gone" }], index)).toBeUndefined();
    expect(firstRefAt([], index)).toBeUndefined();
  });
});
