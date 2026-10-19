import { act, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import type { Document } from "@uniwork/core/types/document";
import { useBodyMentionDeepLink } from "./document-body-mention-gate";
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

    await waitFor(() => expect(mention.closest(".node-mention")).toHaveClass("is-mention-reveal"));
    expect(mention).toHaveAttribute("data-mention-id", ME);
    // The reveal selects the mention node (EditorContent attaches the Editor).
    const editor = (document.querySelector("[contenteditable]") as HTMLElement & { editor?: Editor }).editor;
    const selection = editor?.state.selection;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect(selection && (selection as NodeSelection).node.attrs.id).toBe(ME);
    // The other person's mention is untouched.
    expect(screen.getByText("@Bình").closest(".node-mention")).not.toHaveClass("is-mention-reveal");
  });

  it("the workspace wiring reveals on the element the e2e asserts (RFM e2e r2)", async () => {
    // The real page flow: the gate hook consumes ?mention=1 once the editor
    // reports ready, with the document's content already in the editor.
    function Page({ body }: { body: unknown }) {
      const editorRef = useRef<DocumentEditorHandle | null>(null);
      const { onEditorReady } = useBodyMentionDeepLink({ doc: { kind: "page" } as Document, editorRef });
      return (
        <DocumentEditor ref={editorRef} wsId="ws1" documentId="d1" initialContent={body} content={body}
          contentRevision="1" dirty={false} editable={false} onChange={vi.fn()} onUploadAsset={vi.fn()}
          onReady={onEditorReady} />
      );
    }
    const nav = fakeNav("/acme/team/documents/d1?mention=1");
    const body = content([{ id: OTHER, label: "Bình" }, { id: ME, label: "An" }]);
    render(wrapWithNav(<Page body={body} />, nav));

    // TipTap marks the selected node on the node view's OUTER element (the
    // renderer's span.node-mention), never on the inner [data-node-view-wrapper].
    const selected = `.ProseMirror-selectednode .mention[data-mention-id="${ME}"]`;
    await waitFor(() => expect(document.querySelectorAll(selected)).toHaveLength(1));
    expect(document.querySelectorAll(".ProseMirror-selectednode")).toHaveLength(1);
    expect(document.querySelector(".ProseMirror-selectednode")).toHaveClass("node-mention");
    expect(document.querySelector("[data-node-view-wrapper].ProseMirror-selectednode")).toBeNull();
    await waitFor(() => expect(nav.searchParams.get("mention")).toBeNull());
  });

  it("scrolls the mention element itself and flashes it as soon as the editor is ready (visual r1 F-01)", async () => {
    // ProseMirror's own scrollIntoView starts from the DOM selection, which
    // sits outside an unfocused read-only editor, so it never reaches the page
    // scroller: the reveal must scroll the mention's DOM node. jsdom has no
    // layout, so the spy proves the call and its target.
    const scrolled: { el: Element; arg: unknown }[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element, arg?: unknown) {
      scrolled.push({ el: this, arg });
    };
    function Page({ body }: { body: unknown }) {
      const editorRef = useRef<DocumentEditorHandle | null>(null);
      const { onEditorReady } = useBodyMentionDeepLink({ doc: { kind: "page" } as Document, editorRef });
      return (
        <DocumentEditor ref={editorRef} wsId="ws1" documentId="d1" initialContent={body} content={body}
          contentRevision="1" dirty={false} editable={false} onChange={vi.fn()} onUploadAsset={vi.fn()}
          onReady={onEditorReady} />
      );
    }
    const nav = fakeNav("/acme/team/documents/d1?mention=1");
    render(wrapWithNav(<Page body={content([{ id: OTHER, label: "Bình" }, { id: ME, label: "An" }])} />, nav));

    await waitFor(() => expect(nav.searchParams.get("mention")).toBeNull());
    // No waiting for the chip to appear: the flash has to be on the node the
    // editor selected the moment the reveal ran, even before its node view paints.
    const selected = document.querySelector(".ProseMirror-selectednode");
    expect(selected).not.toBeNull();
    expect(selected).toHaveClass("is-mention-reveal");
    expect(scrolled.map((s) => s.el)).toContain(selected);
    expect(scrolled.find((s) => s.el === selected)?.arg).toMatchObject({ block: "center" });
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("revealMention is a no-op when the reader has no mention in the page", async () => {
    const editorRef = { current: null as DocumentEditorHandle | null };
    const body = content([{ id: OTHER, label: "Bình" }]);
    render(editorView(editorRef, body, fakeNav("/acme/team/documents/d1?mention=1")));
    await screen.findByText("@Bình");
    act(() => editorRef.current!.revealMention(ME));
    expect(document.querySelector(".is-mention-reveal")).toBeNull();
    expect(document.querySelector(".ProseMirror-selectednode")).toBeNull();
  });

  it("revealMention skips an agent mention that carries the reader's id", async () => {
    const editorRef = { current: null as DocumentEditorHandle | null };
    // An agent mention naming the reader is a notification target, not a
    // person — the deep link must not reveal it.
    const body = content([{ id: ME, label: "An", type: "agent" }]);
    render(editorView(editorRef, body, fakeNav("/acme/team/documents/d1?mention=1")));
    await screen.findByText("@An");
    act(() => editorRef.current!.revealMention(ME));
    expect(document.querySelector(".is-mention-reveal")).toBeNull();
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
