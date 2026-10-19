import { act, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentEditor, type DocumentEditorHandle } from "./document-editor";
import { useMentionDeepLink } from "./use-mention-deeplink";

// UNI-1968 W4: a document opened with ?mention=1 scrolls to the reader's own
// mention, flashes it, and drops the parameter. The mention naming someone
// else does not qualify.

initI18n();

const ME = "01J8X4USR0AAAAAAAAAAAAAAAA";
const OTHER = "01J8X4USR0BBBBBBBBBBBBBBBB";

const content = (mentions: { id: string; label: string; type?: string }[]) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Trước." }] },
    ...mentions.map((m) => ({
      type: "paragraph",
      content: [{ type: "mention", attrs: { id: m.id, label: m.label, type: m.type ?? "member" } }],
    })),
    { type: "paragraph", content: [{ type: "text", text: "Sau." }] },
  ],
});

/** Minimal host: runs the real hook against a fake URL and forwards to the spy. */
function Host({ revealSpy }: { revealSpy: (userId: string) => void }) {
  useMentionDeepLink({ ready: true, reveal: revealSpy });
  return null;
}

const editorView = (editorRef: { current: DocumentEditorHandle | null }, body: unknown, nav = fakeNav()) =>
  wrapWithNav(
    <DocumentEditor ref={(h) => { editorRef.current = h; }} wsId="ws1" documentId="d1"
      initialContent={body} content={body} contentRevision="1" dirty={false}
      editable={false} onChange={vi.fn()} onUploadAsset={vi.fn()} />,
    nav,
  );

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ members: [] });
  resetAuthStoreForTests();
  setSessionUser({ id: ME, display_name: "An", email: "an@example.com" } as User);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAuthStoreForTests();
});

describe("UNI-1968 ?mention=1 deep link", () => {
  it("revealMention selects and flashes the reader's own mention only", async () => {
    const editorRef = { current: null as DocumentEditorHandle | null };
    const body = content([{ id: OTHER, label: "Bình" }, { id: ME, label: "An" }]);
    render(editorView(editorRef, body, fakeNav("/acme/team/documents/d1?mention=1")));
    const mention = await screen.findByText("@An");

    act(() => editorRef.current!.revealMention(ME));

    await waitFor(() => expect(mention).toHaveClass("is-mention-reveal"));
    expect(mention).toHaveAttribute("data-mention-id", ME);
    // The reveal selects the mention node (EditorContent attaches the Editor).
    const editor = (document.querySelector("[contenteditable]") as HTMLElement & { editor?: Editor }).editor;
    const selection = editor?.state.selection;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect(selection && (selection as NodeSelection).node.attrs.id).toBe(ME);
    // The other person's mention is untouched.
    expect(screen.getByText("@Bình")).not.toHaveClass("is-mention-reveal");
  });

  it("revealMention is a no-op when the reader has no mention in the page", async () => {
    const editorRef = { current: null as DocumentEditorHandle | null };
    const body = content([{ id: OTHER, label: "Bình" }]);
    render(editorView(editorRef, body, fakeNav("/acme/team/documents/d1?mention=1")));
    await screen.findByText("@Bình");
    act(() => editorRef.current!.revealMention(ME));
    expect(screen.getByText("@Bình")).not.toHaveClass("is-mention-reveal");
    expect(document.querySelector(".ProseMirror-selectednode")).toBeNull();
  });

  it("drops ?mention=1 after revealing, keeping other parameters", async () => {
    const nav = fakeNav("/acme/team/documents/d1?mention=1&foo=bar");
    const reveal = vi.fn();
    render(wrapWithNav(<Host revealSpy={reveal} />, nav));
    await waitFor(() => expect(reveal).toHaveBeenCalledWith(ME));
    await waitFor(() => expect(nav.searchParams.get("mention")).toBeNull());
    expect(nav.searchParams.get("foo")).toBe("bar");
    expect(nav.pathname).toBe("/acme/team/documents/d1");
  });

  it("drops ?mention even when there is nobody to reveal", async () => {
    const nav = fakeNav("/acme/team/documents/d1?mention=1");
    resetAuthStoreForTests(); // no signed-in user: still consumes the param
    const reveal = vi.fn();
    render(wrapWithNav(<Host revealSpy={reveal} />, nav));
    await waitFor(() => expect(nav.searchParams.get("mention")).toBeNull());
    expect(reveal).not.toHaveBeenCalled();
  });

  it("leaves the URL alone when there is no ?mention parameter", async () => {
    const nav = fakeNav("/acme/team/documents/d1?comment=c1");
    const reveal = vi.fn();
    render(wrapWithNav(<Host revealSpy={reveal} />, nav));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(nav.searchParams.get("comment")).toBe("c1");
    expect(reveal).not.toHaveBeenCalled();
  });
});
