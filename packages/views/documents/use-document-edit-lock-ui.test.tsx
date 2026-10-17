import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";
import { wrapWithNav } from "../test/api-mock";
import { useDocumentEditLockUi } from "./use-document-edit-lock-ui";

// CFE-3-1: the "handle this 423 once" guard is per document. The save machine is rebuilt for a new
// document and counts sends from 0, so a component that stays mounted across a document switch must
// not swallow the new document's refusal because it carries the same send number.

const markLost = vi.fn();
const LOCK_ID = "lock-1";
const SEND_SEQ = 3;

vi.mock("@uniwork/core/documents/hooks-edit-lock", () => ({
  useDocumentEditLock: () => lockFor,
}));
vi.mock("@uniwork/core/documents/hooks", () => ({
  useDocumentSave: (_wsId: string, documentId: string) => saveFor(documentId),
}));

const lockFor = {
  editLockId: LOCK_ID,
  markLost,
  state: { phase: "mine", lostReason: null, lostBy: null, holder: null, lock: null, slow: false },
  lockState: { data: undefined },
};

// One stable object per document, as the save hook's memo gives while nothing changes.
const saves = new Map<string, unknown>();
function saveFor(documentId: string) {
  if (!saves.has(documentId)) {
    saves.set(documentId, {
      state: {
        phase: "locked", revision: "3", sendSeq: SEND_SEQ, sentEditLockId: LOCK_ID,
        errorFields: { holder_id: "u2", holder_name: "An", held_by_me: false },
      },
      lockRestored: vi.fn(),
    });
  }
  return saves.get(documentId);
}

const doc = (id: string) => ({ id, kind: "page", revision: "3" }) as unknown as Document;

describe("useDocumentEditLockUi 423 guard", () => {
  it("a refusal on the next document at the same send number still ends the hold", () => {
    markLost.mockClear();
    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useDocumentEditLockUi({
          wsId: "ws1", doc: doc(id), canEdit: true, active: true, hasUnsavedWork: () => false,
          refetch: async () => ({ data: null }), editorRef: { current: null }, title: "T",
        }),
      { initialProps: { id: "dA" }, wrapper: ({ children }: { children: ReactNode }) => wrapWithNav(<>{children}</>) },
    );
    expect(markLost).toHaveBeenCalledTimes(1);
    expect(markLost).toHaveBeenLastCalledWith("taken_over", { id: "u2", name: "An" });

    rerender({ id: "dB" });
    expect(markLost).toHaveBeenCalledTimes(2);
  });
});
