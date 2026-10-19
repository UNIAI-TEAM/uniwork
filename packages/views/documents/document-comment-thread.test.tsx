import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentComment } from "@uniwork/core/types/document";
import { DocumentCommentThread, type ThreadContext } from "./document-comment-thread";
import { K } from "./document-comments-keys";

const { t } = initI18n();

const ME = "01J8X4USR0000000000000000A";
const LAN = "01J8X4USR0000000000000000B";

function root(over: Partial<DocumentComment> = {}): DocumentComment {
  return {
    id: "c1", document_id: "d1", author_id: LAN, author_kind: "human", body: "Nội dung", parent_id: null,
    type: "discussion", kind: "discussion", anchor: null, anchor_state: null, revision: 1, resolved_at: null,
    created_at: "2026-10-13T03:00:00Z", updated_at: "2026-10-13T03:00:00Z", display_name: "Lan", avatar_url: "", reactions: [],
    ...over,
  } as DocumentComment;
}

function ctxWithoutDoc(over: Partial<ThreadContext> = {}): ThreadContext {
  return {
    wsId: "ws1", documentId: "d1", orgId: "org1",
    names: new Map(), nameOf: (c) => c.display_name ?? "", nameOfId: (id) => id,
    currentUserId: ME, canWrite: true, canModerate: false, deletedKey: "deleted",
    actions: { reply: vi.fn(), edit: vi.fn(), remove: vi.fn(), setResolved: vi.fn(), reload: vi.fn() },
    ...over,
  } as ThreadContext;
}

// R21 L3: with no document context the thread assumes `view`, the lowest level,
// so it never offers a button the server would refuse.
describe("DocumentCommentThread without a document context", () => {
  it("hides Resolve for a caller who did not write the root", () => {
    render(
      <DocumentCommentThread thread={{ root: root(), replies: [] }} ctx={ctxWithoutDoc()} onFocusHandled={() => {}} />,
    );
    expect(screen.getByTestId("document-thread-c1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t(K.collabResolve) })).toBeNull();
  });
});

describe("editing a comment that mentions someone", () => {
  it("shows @Name in the edit box and saves the token body", async () => {
    const stored = `Nhờ [@Lan](mention://member/${LAN}) xem`;
    const edit = vi.fn(() => Promise.resolve(true));
    const ctx = ctxWithoutDoc({ actions: { ...ctxWithoutDoc().actions, edit } });
    render(
      <DocumentCommentThread
        thread={{ root: root({ author_id: ME, display_name: "Minh", body: stored }), replies: [] }}
        ctx={ctx}
        onFocusHandled={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `${t(K.collabActions)} Minh` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t(K.collabEdit) }));
    const box = screen.getByRole("textbox", { name: t(K.collabEdit) });
    expect(box).toHaveValue("Nhờ @Lan xem");
    fireEvent.change(box, { target: { value: "Nhờ @Lan xem giúp" } });
    fireEvent.click(screen.getByRole("button", { name: t(K.collabSave) }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith("c1", `Nhờ [@Lan](mention://member/${LAN}) xem giúp`));
  });
});
