import { describe, expect, it } from "vitest";
import type { DocxEdit } from "@uniwork/office-engine/docx";
import { reconcileDocxPlan, type DocxEditPort } from "./docx-reconcile";
import type { DesiredItem } from "./docx-doc-convert";

function fakePort(): { port: DocxEditPort; calls: DocxEdit[] } {
  const calls: DocxEdit[] = [];
  return {
    calls,
    port: {
      edit: (_ref: string, edit: DocxEdit) => {
        calls.push(edit);
        return { applied: true as const, revision: calls.length };
      },
    },
  };
}

describe("reconcileDocxPlan", () => {
  it("emits nothing for an all-passthrough desired list", () => {
    const { port, calls } = fakePort();
    const desired: DesiredItem[] = [
      { kind: "passthrough", docxIndex: 0 },
      { kind: "passthrough", docxIndex: 1 },
    ];
    reconcileDocxPlan(port, "ref", [0, 1], desired);
    expect(calls).toEqual([]);
  });

  it("removes every original missing from the desired list, including a trailing one", () => {
    const { port, calls } = fakePort();
    const desired: DesiredItem[] = [{ kind: "passthrough", docxIndex: 0 }];
    reconcileDocxPlan(port, "ref", [0, 1, 2], desired);
    expect(calls).toEqual([
      { op: "remove_block", docxIndex: 1 },
      { op: "remove_block", docxIndex: 2 },
    ]);
  });

  it("emits set_paragraph_text only for the changed original", () => {
    const { port, calls } = fakePort();
    const desired: DesiredItem[] = [
      { kind: "passthrough", docxIndex: 0 },
      { kind: "text-edit", docxIndex: 1, runs: [{ text: "EDITED" }] },
    ];
    reconcileDocxPlan(port, "ref", [0, 1], desired);
    expect(calls).toEqual([{ op: "set_paragraph_text", docxIndex: 1, runs: [{ text: "EDITED" }] }]);
  });

  it("restyle removes the original and inserts the replacement at the same gap", () => {
    const { port, calls } = fakePort();
    const desired: DesiredItem[] = [
      { kind: "restyle", docxIndex: 0, block: { type: "paragraph", runs: [{ text: "Spec" }] } },
      { kind: "passthrough", docxIndex: 1 },
    ];
    reconcileDocxPlan(port, "ref", [0, 1], desired);
    expect(calls).toEqual([
      { op: "remove_block", docxIndex: 0 },
      { op: "insert_generated", index: 0, block: { type: "paragraph", runs: [{ text: "Spec" }] } },
    ]);
  });

  it("inserts new content at the right plan position relative to originals", () => {
    const { port, calls } = fakePort();
    const desired: DesiredItem[] = [
      { kind: "insert", block: { type: "paragraph", runs: [{ text: "NEW-FIRST" }] } },
      { kind: "passthrough", docxIndex: 0 },
      { kind: "insert", block: { type: "paragraph", runs: [{ text: "NEW-MIDDLE" }] } },
      { kind: "passthrough", docxIndex: 1 },
    ];
    reconcileDocxPlan(port, "ref", [0, 1], desired);
    expect(calls).toEqual([
      { op: "insert_generated", index: 0, block: { type: "paragraph", runs: [{ text: "NEW-FIRST" }] } },
      { op: "insert_generated", index: 2, block: { type: "paragraph", runs: [{ text: "NEW-MIDDLE" }] } },
    ]);
  });

  it("handles a removal in the middle followed by a surviving later original", () => {
    const { port, calls } = fakePort();
    // docxIndex 1 was deleted; 0 and 2 survive untouched.
    const desired: DesiredItem[] = [
      { kind: "passthrough", docxIndex: 0 },
      { kind: "passthrough", docxIndex: 2 },
    ];
    reconcileDocxPlan(port, "ref", [0, 1, 2], desired);
    expect(calls).toEqual([{ op: "remove_block", docxIndex: 1 }]);
  });
});
