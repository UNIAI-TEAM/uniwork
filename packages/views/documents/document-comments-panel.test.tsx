import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { useDocumentCommentDraftStore } from "@uniwork/core/documents/comment-drafts";
import { documentKeys } from "@uniwork/core/documents/keys";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { DocumentSchema, type Document, type DocumentComment } from "@uniwork/core/types/document";
import type { User } from "@uniwork/core/types";
import { NavigationProvider } from "../navigation";
import { fakeNav, localeAdapter } from "../test/api-mock";
import { requestMock } from "../test/request-mock";
import { DocumentCommentsHeaderActions, DocumentCommentsProvider } from "./document-comments-context";
import { K } from "./document-comments-keys";
import { DocumentCommentsPanel } from "./document-comments-panel";
import { useDocumentCommentsPanel } from "./use-document-comments-panel";

// The web panel (G8-10) against EXPERIENCE-G8 S12/S13: the transport is
// mocked, the real schemas, hooks and i18n run. Each `describe` is one block
// of the state table; the test names say which row they pin.

const { t } = initI18n();

const WS = "ws1";
const DOC = "d1";
const ME = "01J8X4USR0000000000000000A";
const LAN = "01J8X4USR0000000000000000B";
const BINH = "01J8X4USR0000000000000000C";

const me: User = {
  id: ME,
  email: "me@example.com",
  display_name: "Minh",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const DOCX = { file_id: "f1", version_id: "v1", version: 1, filename: "Plan.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 10, checksum_sha256: "a" };

function makeDoc(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
    id: DOC, workspace_id: WS, organization_id: "org1", kind: "page", title: "Tài liệu",
    revision: "3", current_version: 1, my_level: "edit", ...over,
  });
  return { ...parsed, kind: parsed.kind as Document["kind"], visibility: parsed.visibility as Document["visibility"], my_level: parsed.my_level as Document["my_level"], via: parsed.via as Document["via"], owner_kind: parsed.owner_kind as Document["owner_kind"] };
}
const docxDoc = (over: Record<string, unknown> = {}) => makeDoc({ kind: "file", title: "Plan.docx", file: DOCX, ...over });

function row(over: Partial<DocumentComment> & { id: string }): DocumentComment {
  return {
    document_id: DOC, author_id: LAN, author_kind: "human", body: "Nội dung", parent_id: null,
    type: "discussion", kind: "discussion", anchor: null, anchor_state: null, revision: 1, resolved_at: null,
    created_at: "2026-10-13T03:00:00Z", updated_at: "2026-10-13T03:00:00Z", display_name: "Lan", avatar_url: "", reactions: [],
    ...over,
  } as DocumentComment;
}

type Init = { method?: string; body?: unknown };
type Answer = (method: string, path: string, init?: Init) => Promise<unknown> | undefined;

/** Answers the panel's routes; `extra` wins. Every list is the G8 full shape. */
function installApi(state: { comments: DocumentComment[]; mentions?: unknown[] }, extra?: Answer) {
  requestMock.mockImplementation((path: string, init?: Init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const hit = extra?.(method, path, init);
    if (hit !== undefined) return hit;
    if (path.startsWith(`/api/v1/orgs/`)) return Promise.resolve({ favorites: [] });
    if (method === "GET" && path === `/api/v1/documents/${DOC}/comments`) {
      return Promise.resolve({ comments: state.comments, mentions: state.mentions ?? [], list_token: "lt1:x" });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC}/comments`) {
      const body = (init?.body ?? {}) as { body: string; parent_id?: string };
      const created = row({ id: `n${state.comments.length}`, author_id: ME, display_name: "Minh", body: body.body, parent_id: body.parent_id ?? null });
      state.comments = [...state.comments, created];
      return Promise.resolve({ comment: created });
    }
    if (path.endsWith("/resolve")) {
      const id = path.split("/").at(-2)!;
      state.comments = state.comments.map((c) => (c.id === id ? { ...c, resolved_at: method === "POST" ? "2026-10-13T05:00:00Z" : null } : c));
      return Promise.resolve({ comment: state.comments.find((c) => c.id === id) });
    }
    if (method === "PATCH") {
      const id = path.split("/").at(-1)!;
      const body = (init?.body as { body: string }).body;
      state.comments = state.comments.map((c) => (c.id === id ? { ...c, body, revision: c.revision + 1 } : c));
      return Promise.resolve({ comment: state.comments.find((c) => c.id === id) });
    }
    if (method === "DELETE") {
      const id = path.split("/").at(-1)!;
      const hasReplies = state.comments.some((c) => c.parent_id === id);
      state.comments = hasReplies
        ? state.comments.map((c) => (c.id === id ? { ...c, body: "", deleted_at: "2026-10-13T06:00:00Z" } : c))
        : state.comments.filter((c) => c.id !== id);
      return Promise.resolve({ status: "ok", outcome: hasReplies ? "tombstoned" : "removed" });
    }
    return Promise.reject(new ApiError("not found", "not_found", 404));
  });
}

function renderPanel(opts: { doc?: Document; search?: string } = {}) {
  const doc = opts.doc ?? makeDoc();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  const nav = fakeNav(`/acme/doi/documents/${DOC}`);
  nav.searchParams = new URLSearchParams(opts.search ?? "");
  const view = render(
    <QueryClientProvider client={client}>
      <FeatureFlagsProvider service={service}>
        <LocaleAdapterProvider adapter={localeAdapter}>
          <NavigationProvider value={nav}>
            <DocumentCommentsProvider wsId={WS} doc={doc}>
              <DocumentCommentsHeaderActions />
              <DocumentCommentsPanel />
            </DocumentCommentsProvider>
          </NavigationProvider>
        </LocaleAdapterProvider>
      </FeatureFlagsProvider>
    </QueryClientProvider>,
  );
  return { client, doc, ...view };
}

async function openPanel(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByTestId("document-comments-pane");
}

const thread = (id: string) => screen.getByTestId(`document-thread-${id}`);
const discussionTitle = () => t(K.collabDiscussion);
const commentsTitle = () => t(K.collabComments);

beforeEach(() => {
  window.innerWidth = 1400; // desktop rail: the inline pane, no sheet portal
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  useDocumentCommentDraftStore.setState({ drafts: {}, ownerId: null });
});

describe("panel per host and tabs (Foundation G8)", () => {
  it("gives a page the Discussion alone: no tablist, the composer at the bottom", async () => {
    installApi({ comments: [] });
    renderPanel();
    const pane = await openPanel(discussionTitle());
    expect(within(pane).getByRole("heading", { name: discussionTitle() })).toBeInTheDocument();
    expect(await within(pane).findByText(t(K.collabEmptyDiscussion))).toBeInTheDocument();
    expect(within(pane).queryByRole("tablist")).toBeNull();
    expect(within(pane).getByRole("textbox", { name: t(K.collabComposerDiscussion) })).toBeInTheDocument();
    expect(within(pane).getByRole("button", { name: t(K.collabClosePanel, { panel: discussionTitle() }) })).toBeInTheDocument();
  });

  it("gives a docx two tabs; the Comments tab explains anchored comments and has no composer", async () => {
    installApi({ comments: [] });
    renderPanel({ doc: docxDoc() });
    const pane = await openPanel(commentsTitle());
    const tabs = await within(pane).findByRole("tablist");
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([commentsTitle(), discussionTitle()]);
    expect(await within(pane).findByText(t(K.collabEmptyCommentsNoEditor))).toBeInTheDocument();
    // The web never starts a comment thread: a comment root needs the editor's anchor.
    expect(within(pane).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(tabs).getByRole("tab", { name: discussionTitle() }));
    expect(await within(pane).findByRole("textbox", { name: t(K.collabComposerDiscussion) })).toBeInTheDocument();
  });

  it("closes from the panel and hands focus back to the trigger", async () => {
    installApi({ comments: [] });
    renderPanel();
    const pane = await openPanel(discussionTitle());
    fireEvent.click(within(pane).getByRole("button", { name: t(K.collabClosePanel, { panel: discussionTitle() }) }));
    await waitFor(() => expect(screen.queryByTestId("document-comments-pane")).toBeNull());
    expect(screen.getByRole("button", { name: discussionTitle() })).toHaveFocus();
  });
});

describe("S12/S13 load states", () => {
  it("shows a skeleton with a screen-reader line while the first load runs", async () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    const pane = await openPanel(discussionTitle());
    expect(within(pane).getByTestId("document-comments-loading")).toHaveTextContent(t(K.collabLoading));
    expect(within(pane).queryByRole("textbox")).toBeNull();
  });

  it("replaces the list with the error and Retry when the first load fails, without a composer", async () => {
    let fail = true;
    installApi({ comments: [row({ id: "a" })] }, (method, path) =>
      fail && method === "GET" && path.endsWith("/comments") ? Promise.reject(new ApiError("boom", "internal", 500)) : undefined,
    );
    renderPanel();
    const pane = await openPanel(discussionTitle());
    const error = await within(pane).findByTestId("document-comments-error");
    expect(error).toHaveTextContent(t(K.collabLoadError));
    expect(error).toHaveTextContent(t(K.collabLoadErrorBody));
    expect(within(pane).queryByRole("textbox")).toBeNull();
    fail = false;
    fireEvent.click(within(error).getByRole("button", { name: t(K.collabRetry) }));
    expect(await screen.findByTestId("document-thread-a")).toBeInTheDocument();
  });

  it("hides everything behind the no-access message when the read is refused", async () => {
    installApi({ comments: [] }, (method, path) =>
      method === "GET" && path.endsWith("/comments") ? Promise.reject(new ApiError("no", "forbidden", 403)) : undefined,
    );
    renderPanel();
    const pane = await openPanel(discussionTitle());
    const error = await within(pane).findByTestId("document-comments-error");
    expect(error).toHaveTextContent(t(K.collabNoAccess));
    expect(error).toHaveTextContent(t(K.collabNoAccessBody));
    expect(within(error).queryByRole("button")).toBeNull();
    expect(within(pane).queryByRole("textbox")).toBeNull();
  });

  it("keeps the loaded list readable and blocks Send when a reload cannot reach the server", async () => {
    const state = { comments: [row({ id: "a" })] };
    let offline = false;
    installApi(state, (method, path) =>
      offline && method === "GET" && path.endsWith("/comments") ? Promise.reject(new TypeError("Failed to fetch")) : undefined,
    );
    const { client } = renderPanel();
    const pane = await openPanel(discussionTitle());
    await screen.findByTestId("document-thread-a");
    offline = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: documentKeys.comments(WS, DOC) });
    });
    const status = await within(pane).findByTestId("document-comments-status");
    expect(status).toHaveTextContent(t(K.collabOffline));
    expect(thread("a")).toBeInTheDocument();
    const box = within(pane).getByRole("textbox", { name: t(K.collabComposerDiscussion) });
    fireEvent.change(box, { target: { value: "vẫn giữ" } });
    const send = within(pane).getByTestId("document-discussion-composer-send");
    expect(send).toHaveAttribute("aria-disabled", "true");
    expect(box.getAttribute("aria-describedby")).toContain(status.id);
  });

  it("says the session ended after a write answers 401, and keeps the draft", async () => {
    installApi({ comments: [] }, (method) =>
      method === "POST" ? Promise.reject(new ApiError("gone", "unauthorized", 401)) : undefined,
    );
    renderPanel();
    const pane = await openPanel(discussionTitle());
    const box = await within(pane).findByRole("textbox", { name: t(K.collabComposerDiscussion) });
    fireEvent.change(box, { target: { value: "Bài mới" } });
    fireEvent.click(within(pane).getByTestId("document-discussion-composer-send"));
    expect(await within(pane).findByTestId("document-comments-status")).toHaveTextContent(t(K.collabSignedOut));
    expect(box).toHaveValue("Bài mới");
  });
});

describe("S12 anchored comments", () => {
  it("labels each anchor by format and says stale and lost in words", async () => {
    installApi({
      comments: [
        row({ id: "ok", kind: "comment", type: "comment", anchor: { format: "docx", v: 1, path: [1], start: 0, end: 4, quote: "doanh thu", prefix: "", suffix: "" }, anchor_state: "exact" }),
        row({ id: "st", kind: "comment", type: "comment", anchor: { format: "docx", v: 1, path: [2], start: 0, end: 4, quote: "chi phí", prefix: "", suffix: "" }, anchor_state: "stale" }),
        row({ id: "lo", kind: "comment", type: "comment", anchor: { format: "docx", v: 1, path: [0], start: 0, end: 4, quote: "lợi nhuận", prefix: "", suffix: "" }, anchor_state: "lost" }),
      ],
    });
    renderPanel({ doc: docxDoc() });
    const pane = await openPanel(commentsTitle());
    await within(pane).findByTestId("document-thread-ok");
    const items = within(within(pane).getByTestId("document-comment-threads")).getAllByRole("listitem").filter((li) => li.dataset.testid?.startsWith("document-thread-"));
    // Document order, the lost anchor last.
    expect(items.map((li) => li.dataset.testid)).toEqual(["document-thread-ok", "document-thread-st", "document-thread-lo"]);
    expect(thread("ok")).toHaveTextContent(t(K.collabAnchorDocx, { quote: "doanh thu" }));
    expect(thread("ok")).not.toHaveTextContent(t(K.collabAnchorStale));
    expect(thread("st")).toHaveTextContent(t(K.collabAnchorStale));
    expect(thread("lo")).toHaveTextContent(t(K.collabAnchorLost));
    // The thread's name is author + anchor + state, joined by reference, not by a composed string.
    expect(thread("st")).toHaveAccessibleName(`Lan ${t(K.collabAnchorDocx, { quote: "chi phí" })} ${t(K.collabAnchorStale)}`);
    // A lost anchor is still a live thread: reply and resolve stay.
    expect(within(thread("lo")).getByRole("button", { name: t(K.collabReply) })).toBeInTheDocument();
  });

  it("names cell, slide and page anchors with their own keys", async () => {
    installApi({
      comments: [row({ id: "x", kind: "comment", type: "comment", anchor: { format: "pptx", v: 1, slide_id: "257", slide_index: 2 }, anchor_state: "exact" })],
    });
    renderPanel({ doc: docxDoc({ file: { ...DOCX, filename: "Deck.pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" } }) });
    const pane = await openPanel(commentsTitle());
    expect(await within(pane).findByText(t(K.collabAnchorSlide, { slide: "3" }))).toBeInTheDocument();
  });

  it("opens on the tab and thread a ?comment= link names, and focuses that thread", async () => {
    installApi({
      comments: [
        row({ id: "c1", kind: "comment", type: "comment", anchor: { format: "docx", v: 1, path: [0], start: 0, end: 1, quote: "q", prefix: "", suffix: "" }, anchor_state: "exact" }),
        row({ id: "d1x", body: "Bài thảo luận", resolved_at: "2026-10-13T04:00:00Z" }),
      ],
    });
    renderPanel({ doc: docxDoc(), search: "comment=d1x" });
    const pane = await screen.findByTestId("document-comments-pane");
    await waitFor(() => expect(within(pane).getByRole("tab", { name: discussionTitle() })).toHaveAttribute("aria-selected", "true"));
    // The resolved group opens so the thread is there to focus.
    await waitFor(() => expect(within(thread("d1x")).getByRole("heading")).toHaveFocus());
  });

  it("says a deep-linked comment is gone when the list no longer has it", async () => {
    installApi({ comments: [] });
    renderPanel({ doc: docxDoc(), search: "comment=gone" });
    const message = await screen.findByTestId("document-comments-reveal");
    expect(message).toHaveTextContent(t(K.collabCommentDeleted));
    await waitFor(() => expect(message).toHaveFocus());
  });
});

describe("thread actions (S12/S13)", () => {
  it("shows the deleted frame with live replies, and no reply on that thread", async () => {
    installApi({
      comments: [
        row({ id: "root", body: "", deleted_at: "2026-10-13T06:00:00Z" }),
        row({ id: "r1", parent_id: "root", body: "Trả lời còn sống" }),
      ],
    });
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-root");
    expect(within(item).getByText(t(K.collabDeleted))).toBeInTheDocument();
    expect(within(item).getByText("Trả lời còn sống")).toBeInTheDocument();
    expect(within(item).queryByRole("button", { name: t(K.collabReply) })).toBeNull();
    expect(within(item).queryByRole("button", { name: t(K.collabResolve) })).toBeNull();
  });

  it("deletes a post with replies after one confirmation and leaves the frame", async () => {
    const state = { comments: [row({ id: "mine", author_id: ME, display_name: "Minh", body: "Của tôi" }), row({ id: "rep", parent_id: "mine", body: "Đáp" })] };
    installApi(state);
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-mine");
    fireEvent.click(within(item).getAllByRole("button", { name: `${t(K.collabActions)} Minh` })[0]!);
    fireEvent.click(await screen.findByRole("menuitem", { name: t(K.collabDelete) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t(K.collabDeleteBody));
    fireEvent.click(within(dialog).getByRole("button", { name: t(K.collabDeleteConfirm) }));
    await waitFor(() => expect(within(thread("mine")).getByText(t(K.collabDeleted))).toBeInTheDocument());
    expect(within(thread("mine")).getByText("Đáp")).toBeInTheDocument();
  });

  it("names each post's actions button after its author (N4)", async () => {
    installApi({ comments: [row({ id: "a" }), row({ id: "b", parent_id: "a", author_id: BINH, display_name: "Bình" })] });
    renderPanel();
    await openPanel(discussionTitle());
    await screen.findByTestId("document-thread-a");
    expect(screen.getByRole("button", { name: `${t(K.collabActions)} Lan` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${t(K.collabActions)} Bình` })).toBeInTheDocument();
  });

  it("resolves into the folded group and reopens back, focus staying on the button", async () => {
    installApi({ comments: [row({ id: "a" })] });
    renderPanel();
    await openPanel(discussionTitle());
    fireEvent.click(within(await screen.findByTestId("document-thread-a")).getByRole("button", { name: t(K.collabResolve) }));
    const fold = await screen.findByRole("button", { name: t(K.collabLabelCount, { label: t(K.collabResolved), count: 1 }) });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fold);
    const reopen = await within(thread("a")).findByRole("button", { name: t(K.collabReopen) });
    expect(thread("a")).toHaveTextContent(t(K.collabResolved));
    fireEvent.click(reopen);
    // The thread remounts in the open list; focus follows it to the button that now reads Resolve.
    await waitFor(() => expect(within(thread("a")).getByRole("button", { name: t(K.collabResolve) })).toHaveFocus());
  });

  it("replies under the thread and clears the reply box once the server has it", async () => {
    const state = { comments: [row({ id: "a" })] };
    installApi(state);
    renderPanel();
    await openPanel(discussionTitle());
    fireEvent.click(within(await screen.findByTestId("document-thread-a")).getByRole("button", { name: t(K.collabReply) }));
    const box = within(thread("a")).getByRole("textbox", { name: t(K.collabComposerReply) });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: "Đồng ý" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(within(thread("a")).getByText("Đồng ý")).toBeInTheDocument());
    const post = requestMock.mock.calls.find(([, init]) => (init as Init | undefined)?.method === "POST");
    expect((post?.[1] as Init).body).toMatchObject({ body: "Đồng ý", parent_id: "a" });
    expect(within(thread("a")).queryByRole("textbox")).toBeNull();
  });

  it("edits a post and shows the edit history, newest first under the current text", async () => {
    installApi(
      { comments: [row({ id: "a", author_id: ME, display_name: "Minh", body: "Bản 3", revision: 3, updated_at: "2026-10-13T04:00:00Z" })] },
      (method, path) =>
        method === "GET" && path.endsWith("/a/revisions")
          ? Promise.resolve({ revisions: [
              { id: "v2", revision: 2, body: "Bản 2", created_by_id: ME, created_at: "2026-10-13T03:30:00Z" },
              { id: "v1", revision: 1, body: "Bản 1", created_by_id: ME, created_at: "2026-10-13T03:00:00Z" },
            ] })
          : undefined,
    );
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-a");
    const edited = within(item).getByRole("button", { expanded: false, name: new RegExp(t(K.collabEdited, { time: "" }).trim().split(" ")[0]!) });
    fireEvent.click(edited);
    const history = await within(item).findByTestId("document-comment-history-a");
    await within(history).findByText("Bản 2");
    const texts = within(history).getAllByTestId("document-comment-body").map((b) => b.textContent);
    expect(texts).toEqual(["Bản 3", "Bản 2", "Bản 1"]);
    expect(history).toHaveTextContent(t(K.collabHistoryCurrent));
    fireEvent.click(edited);
    await waitFor(() => expect(edited).toHaveFocus());

    fireEvent.click(within(item).getByRole("button", { name: `${t(K.collabActions)} Minh` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t(K.collabEdit) }));
    const editBox = within(item).getByRole("textbox", { name: t(K.collabEdit) });
    fireEvent.change(editBox, { target: { value: "Bản 4" } });
    fireEvent.click(within(item).getByRole("button", { name: t(K.collabSave) }));
    await waitFor(() => expect(within(thread("a")).getByText("Bản 4")).toBeInTheDocument());
  });

  it("says when the history is empty or cannot load", async () => {
    let broken = false;
    installApi({ comments: [row({ id: "a" })] }, (method, path) => {
      if (method !== "GET" || !path.endsWith("/a/revisions")) return undefined;
      return broken ? Promise.reject(new ApiError("x", "internal", 500)) : Promise.resolve({ revisions: [] });
    });
    const { client } = renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-a");
    fireEvent.click(within(item).getByRole("button", { name: `${t(K.collabActions)} Lan` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t(K.collabHistory) }));
    expect(await within(item).findByText(t(K.collabHistoryEmpty))).toBeInTheDocument();
    broken = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: [...documentKeys.comments(WS, DOC), "revisions", "a"] });
    });
    expect(await within(item).findByText(t(K.collabHistoryError))).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: t(K.collabRetry) })).toBeInTheDocument();
  });
});

describe("view only (commentsLevel view)", () => {
  it("reads everything, writes nothing: no composer, no reply or resolve, badge and status line", async () => {
    installApi(
      { comments: [row({ id: "a", body: "Đọc được" }), row({ id: "r", parent_id: "a", body: "Trả lời" })] },
      (method, path) => (method === "GET" && path.endsWith("/revisions") ? Promise.resolve({ revisions: [] }) : undefined),
    );
    renderPanel({ doc: makeDoc({ my_level: "view" }) });
    const pane = await openPanel(discussionTitle());
    const item = await within(pane).findByTestId("document-thread-a");
    expect(within(item).getByText("Đọc được")).toBeInTheDocument();
    expect(within(pane).getByTestId("document-comments-view-only")).toHaveTextContent(t(K.collabViewOnlyBadge));
    expect(within(pane).getByTestId("document-comments-status")).toHaveTextContent(t(K.collabViewOnly));
    expect(within(pane).queryByRole("textbox")).toBeNull();
    expect(within(item).queryByRole("button", { name: t(K.collabReply) })).toBeNull();
    expect(within(item).queryByRole("button", { name: t(K.collabResolve) })).toBeNull();
    fireEvent.click(within(item).getAllByRole("button", { name: `${t(K.collabActions)} Lan` })[0]!);
    expect(await screen.findByRole("menuitem", { name: t(K.collabHistory) })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t(K.collabEdit) })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t(K.collabDelete) })).toBeNull();
  });

  it("turns view-only when a write is refused with 403", async () => {
    installApi({ comments: [row({ id: "a" })] }, (method) =>
      method === "POST" ? Promise.reject(new ApiError("no", "forbidden", 403)) : undefined,
    );
    renderPanel();
    const pane = await openPanel(discussionTitle());
    const box = await within(pane).findByRole("textbox", { name: t(K.collabComposerDiscussion) });
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.click(within(pane).getByTestId("document-discussion-composer-send"));
    await waitFor(() => expect(within(pane).queryByRole("textbox")).toBeNull());
    expect(within(pane).getByTestId("document-comments-status")).toHaveTextContent(t(K.collabViewOnly));
  });
});

describe("live region and old rows", () => {
  it("announces once, politely, when a reload changes the list, without moving focus", async () => {
    const state = { comments: [row({ id: "a" })] };
    installApi(state);
    const { client } = renderPanel();
    const pane = await openPanel(discussionTitle());
    await screen.findByTestId("document-thread-a");
    const live = within(pane).getByTestId("document-comments-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("");
    const box = within(pane).getByRole("textbox", { name: t(K.collabComposerDiscussion) });
    box.focus();
    state.comments = [...state.comments, row({ id: "b", body: "Mới đến", created_at: "2026-10-13T07:00:00Z" })];
    await act(async () => {
      await client.refetchQueries({ queryKey: documentKeys.comments(WS, DOC) });
    });
    await screen.findByTestId("document-thread-b");
    expect(live).toHaveTextContent(t(K.collabUpdatedAnnounce));
    expect(box).toHaveFocus();
  });

  it("shows a pre-G8 row (type discussion, no kind) in the Discussion unchanged", async () => {
    requestMock.mockImplementation((path: string) =>
      path === `/api/v1/documents/${DOC}/comments`
        ? Promise.resolve({ comments: [{ id: "old", document_id: DOC, body: "Bình luận cũ", type: "discussion", display_name: "Lan", created_at: "2026-09-01T00:00:00Z" }] })
        : Promise.resolve({ favorites: [] }),
    );
    renderPanel({ doc: docxDoc() });
    const pane = await openPanel(commentsTitle());
    fireEvent.click(await within(pane).findByRole("tab", { name: discussionTitle() }));
    expect(await within(pane).findByText("Bình luận cũ")).toBeInTheDocument();
  });

  it("draws mention chips by the current name and falls back to the token label", async () => {
    installApi({
      comments: [row({ id: "a", body: `Nhờ [@Bình cũ](mention://member/${BINH}) và [@Ai đó](mention://member/${LAN}) xem **gấp**` })],
      mentions: [{ user_id: BINH, display_name: "Bình Mới", state: "ok" }, { user_id: LAN, state: "unavailable" }],
    });
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-a");
    expect(within(item).getByText("@Bình Mới")).toHaveAttribute("data-mention-state", "ok");
    expect(within(item).getByText("@Ai đó")).toHaveAttribute("data-mention-state", "unavailable");
    expect(within(item).getByText("gấp").tagName).toBe("STRONG");
  });

  it("names an author the server no longer names a former member", async () => {
    installApi({ comments: [row({ id: "a", display_name: "", author: undefined })] });
    renderPanel();
    await openPanel(discussionTitle());
    expect(within(await screen.findByTestId("document-thread-a")).getByText(t(K.collabFormerMember))).toBeInTheDocument();
  });
});

describe("a failed write never locks Send (V5 F1)", () => {
  async function failThenRecover(failure: () => Error) {
    const state = { comments: [] as DocumentComment[] };
    let failing = true;
    installApi(state, (method, path) =>
      failing && method === "POST" && path.endsWith("/comments") ? Promise.reject(failure()) : undefined,
    );
    renderPanel();
    const pane = await openPanel(discussionTitle());
    const box = await within(pane).findByRole("textbox", { name: t(K.collabComposerDiscussion) });
    fireEvent.change(box, { target: { value: "Gửi lại được" } });
    const send = within(pane).getByTestId("document-discussion-composer-send");
    fireEvent.click(send);
    return { pane, box, send, recover: () => { failing = false; } };
  }

  it("keeps Send live after a 5xx, says so, and the retry goes through once the server answers", async () => {
    const { pane, box, send, recover } = await failThenRecover(() => new ApiError("boom", "internal", 503));
    expect(await within(pane).findByTestId("document-comments-status")).toHaveTextContent(t(K.collabServerError));
    expect(await within(pane).findByTestId("document-discussion-composer-problem")).toHaveTextContent(t(K.collabSendFailed));
    expect(box).toHaveValue("Gửi lại được");
    expect(send).not.toHaveAttribute("aria-disabled");
    recover();
    fireEvent.click(send);
    expect(await within(pane).findByText("Gửi lại được", { selector: "p" })).toBeInTheDocument();
    await waitFor(() => expect(within(pane).queryByTestId("document-comments-status")).toBeNull());
    expect(box).toHaveValue("");
  });

  it("does the same after a network failure: offline sentence, Send stays live, Ctrl+Enter retries", async () => {
    const { pane, box, send, recover } = await failThenRecover(() => new TypeError("Failed to fetch"));
    expect(await within(pane).findByTestId("document-comments-status")).toHaveTextContent(t(K.collabOffline));
    expect(send).not.toHaveAttribute("aria-disabled");
    recover();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(within(pane).queryByTestId("document-comments-status")).toBeNull());
    expect(await within(pane).findByText("Gửi lại được", { selector: "p" })).toBeInTheDocument();
  });

  it("clears the previous write's sentence when a new attempt starts", async () => {
    const { pane, send, recover } = await failThenRecover(() => new ApiError("boom", "internal", 500));
    await within(pane).findByTestId("document-comments-status");
    recover();
    fireEvent.click(send);
    await waitFor(() => expect(within(pane).queryByTestId("document-comments-status")).toBeNull());
  });
});

describe("a failed write ends with the next good read, and a refusal follows the level (R7-2)", () => {
  it("drops the session-ended sentence once a list reload succeeds, and Send works again", async () => {
    let failing = true;
    installApi({ comments: [] }, (method, path) =>
      failing && method === "POST" && path.endsWith("/comments") ? Promise.reject(new ApiError("gone", "unauthorized", 401)) : undefined,
    );
    const { client } = renderPanel();
    const pane = await openPanel(discussionTitle());
    const box = await within(pane).findByRole("textbox", { name: t(K.collabComposerDiscussion) });
    fireEvent.change(box, { target: { value: "Sau khi đăng nhập lại" } });
    const send = within(pane).getByTestId("document-discussion-composer-send");
    fireEvent.click(send);
    expect(await within(pane).findByTestId("document-comments-status")).toHaveTextContent(t(K.collabSignedOut));
    expect(send).toHaveAttribute("aria-disabled", "true");
    failing = false;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await act(async () => {
      await client.refetchQueries({ queryKey: documentKeys.comments(WS, DOC) });
    });
    await waitFor(() => expect(within(pane).queryByTestId("document-comments-status")).toBeNull());
    expect(send).not.toHaveAttribute("aria-disabled");
  });

  it("writes again when the document's level changes after a refusal, instead of staying read-only for good", async () => {
    installApi({ comments: [] }, (method, path) =>
      method === "POST" && path.endsWith("/comments") ? Promise.reject(new ApiError("no", "forbidden", 403)) : undefined,
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ doc }) => useDocumentCommentsPanel(WS, doc), { wrapper, initialProps: { doc: makeDoc() } });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.canWrite).toBe(true);
    await act(async () => {
      await result.current.send("x");
    });
    expect(result.current.canWrite).toBe(false);
    rerender({ doc: makeDoc({ my_level: "view" }) });
    expect(result.current.canWrite).toBe(false);
    rerender({ doc: makeDoc({ my_level: "edit" }) });
    await waitFor(() => expect(result.current.canWrite).toBe(true));
  });
});

describe("S12/S13 rows the first pass left unproven (T4 F-01)", () => {
  it("says UniWork is having trouble when a reload answers 5xx after data, keeping the list and blocking Send", async () => {
    let broken = false;
    installApi({ comments: [row({ id: "a" })] }, (method, path) =>
      broken && method === "GET" && path.endsWith("/comments") ? Promise.reject(new ApiError("boom", "internal", 502)) : undefined,
    );
    const { client } = renderPanel();
    const pane = await openPanel(discussionTitle());
    await screen.findByTestId("document-thread-a");
    broken = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: documentKeys.comments(WS, DOC) });
    });
    expect(await within(pane).findByTestId("document-comments-status")).toHaveTextContent(t(K.collabServerError));
    expect(thread("a")).toBeInTheDocument();
    const box = within(pane).getByRole("textbox", { name: t(K.collabComposerDiscussion) });
    fireEvent.change(box, { target: { value: "chờ" } });
    expect(within(pane).getByTestId("document-discussion-composer-send")).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the Sending state while the server has not answered yet, then clears the box", async () => {
    let answer: () => void = () => {};
    const state = { comments: [] as DocumentComment[] };
    installApi(state, (method, path) =>
      method === "POST" && path.endsWith("/comments")
        ? new Promise((resolve) => {
            answer = () => {
              const created = row({ id: "n1", author_id: ME, display_name: "Minh", body: "Chờ máy chủ" });
              state.comments = [created];
              resolve({ comment: created });
            };
          })
        : undefined,
    );
    renderPanel();
    const pane = await openPanel(discussionTitle());
    const box = await within(pane).findByRole("textbox", { name: t(K.collabComposerDiscussion) });
    fireEvent.change(box, { target: { value: "Chờ máy chủ" } });
    const send = within(pane).getByTestId("document-discussion-composer-send");
    fireEvent.click(send);
    await waitFor(() => expect(send).toHaveTextContent(t(K.collabSending)));
    expect(send).toHaveAttribute("aria-disabled", "true");
    // No optimistic row: the post appears only when the server has it.
    expect(within(pane).queryByText("Chờ máy chủ", { selector: "p" })).toBeNull();
    await act(async () => answer());
    expect(await within(pane).findByText("Chờ máy chủ", { selector: "p" })).toBeInTheDocument();
    expect(send).toHaveTextContent(t(K.collabSend));
  });

  it("says the action did not go through under the thread, and leaves the thread as it was", async () => {
    installApi({ comments: [row({ id: "a" })] }, (method, path) =>
      method === "POST" && path.endsWith("/resolve") ? Promise.reject(new ApiError("boom", "internal", 500)) : undefined,
    );
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-a");
    fireEvent.click(within(item).getByRole("button", { name: t(K.collabResolve) }));
    expect(await within(item).findByRole("alert")).toHaveTextContent(t(K.collabActionFailed));
    expect(within(item).getByRole("button", { name: t(K.collabResolve) })).toBeInTheDocument();
    expect(item).not.toHaveTextContent(t(K.collabResolved));
  });

  it("reloads and shows the deleted frame when a reply lands on a post that was just deleted", async () => {
    const state = { comments: [row({ id: "a" })] };
    let listReads = 0;
    installApi(state, (method, path) => {
      if (method === "GET" && path === `/api/v1/documents/${DOC}/comments`) listReads += 1;
      if (method === "POST" && path.endsWith("/comments")) {
        state.comments = [row({ id: "a", body: "", deleted_at: "2026-10-13T06:00:00Z" }), row({ id: "keep", parent_id: "a", body: "Đáp còn sống" })];
        return Promise.reject(new ApiError("gone", "comment_deleted", 409));
      }
      return undefined;
    });
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-a");
    fireEvent.click(within(item).getByRole("button", { name: t(K.collabReply) }));
    const box = within(item).getByRole("textbox", { name: t(K.collabComposerReply) });
    fireEvent.change(box, { target: { value: "Đáp muộn" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    // The composer keeps the words and offers to copy them; the panel reloads the list.
    expect(await within(item).findByTestId("document-reply-composer-a-problem")).toHaveTextContent(t(K.collabDiscussionDeleted));
    await waitFor(() => expect(within(thread("a")).getByText(t(K.collabDeleted))).toBeInTheDocument());
    expect(listReads).toBeGreaterThanOrEqual(2);
    expect(within(thread("a")).getByText("Đáp còn sống")).toBeInTheDocument();
    expect(within(thread("a")).queryByRole("button", { name: t(K.collabReply) })).toBeNull();
  });

  it("reloads and drops the history when it answers that the post was deleted", async () => {
    const state = { comments: [row({ id: "a", author_id: ME, display_name: "Minh", revision: 2 }), row({ id: "r", parent_id: "a", body: "Đáp" })] };
    let listReads = 0;
    installApi(state, (method, path) => {
      if (method === "GET" && path === `/api/v1/documents/${DOC}/comments`) listReads += 1;
      if (method === "GET" && path.endsWith("/a/revisions")) {
        state.comments = [row({ id: "a", body: "", deleted_at: "2026-10-13T06:00:00Z" }), state.comments[1]!];
        return Promise.reject(new ApiError("gone", "comment_deleted", 409));
      }
      return undefined;
    });
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-a");
    fireEvent.click(within(item).getByRole("button", { name: `${t(K.collabActions)} Minh` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t(K.collabHistory) }));
    await waitFor(() => expect(within(thread("a")).getByText(t(K.collabDeleted))).toBeInTheDocument());
    expect(screen.queryByTestId("document-comment-history-a")).toBeNull();
    expect(listReads).toBeGreaterThanOrEqual(2);
  });

  it("removes a thread with no replies outright when it is deleted", async () => {
    installApi({ comments: [row({ id: "solo", author_id: ME, display_name: "Minh", body: "Một mình" }), row({ id: "other", body: "Còn lại" })] });
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-solo");
    fireEvent.click(within(item).getByRole("button", { name: `${t(K.collabActions)} Minh` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t(K.collabDelete) }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: t(K.collabDeleteConfirm) }));
    await waitFor(() => expect(screen.queryByTestId("document-thread-solo")).toBeNull());
    expect(screen.getByTestId("document-thread-other")).toBeInTheDocument();
    expect(screen.queryByText(t(K.collabDeleted))).toBeNull();
  });

  it("opens a deep link to a deleted frame with a reveal line and focuses the frame", async () => {
    installApi({
      comments: [row({ id: "root", body: "", deleted_at: "2026-10-13T06:00:00Z" }), row({ id: "r1", parent_id: "root", body: "Còn sống" })],
    });
    renderPanel({ search: "comment=root" });
    const pane = await screen.findByTestId("document-comments-pane");
    expect(await within(pane).findByTestId("document-comments-reveal")).toHaveTextContent(t(K.collabDiscussionDeleted));
    await waitFor(() => expect(within(thread("root")).getByText(t(K.collabDeleted))).toHaveFocus());
  });

  it("sends a new Discussion root without a kind, so the server's default applies (OQ-C2)", async () => {
    installApi({ comments: [] });
    renderPanel();
    const pane = await openPanel(discussionTitle());
    const box = await within(pane).findByRole("textbox", { name: t(K.collabComposerDiscussion) });
    fireEvent.change(box, { target: { value: "Gốc mới" } });
    fireEvent.click(within(pane).getByTestId("document-discussion-composer-send"));
    await within(pane).findByText("Gốc mới", { selector: "p" });
    const post = requestMock.mock.calls.find(([, init]) => (init as Init | undefined)?.method === "POST");
    const sent = (post?.[1] as Init).body as Record<string, unknown>;
    expect(sent).toMatchObject({ body: "Gốc mới" });
    expect(sent).not.toHaveProperty("kind");
    expect(sent.parent_id).toBeUndefined();
  });
});

describe("panel chrome (V5 F3, F4, F6)", () => {
  it("is a full-width sheet on a phone: the right-side width override wins over the primitive's 3/4", async () => {
    window.innerWidth = 390;
    installApi({ comments: [] });
    renderPanel();
    const pane = await openPanel(discussionTitle());
    const sheet = pane.closest('[data-slot="sheet-content"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.className).toContain("data-[side=right]:w-full");
    expect(sheet!.className).not.toMatch(/(?<![\w:\]-])w-3\/4/);
  });

  it("gives the Edited toggle a 24px target, 44px on touch", async () => {
    installApi({ comments: [row({ id: "a", revision: 2, updated_at: "2026-10-13T04:00:00Z" })] });
    renderPanel();
    await openPanel(discussionTitle());
    const item = await screen.findByTestId("document-thread-a");
    const toggle = within(item).getByRole("button", { expanded: false, name: new RegExp(t(K.collabEdited, { time: "" }).trim().split(" ")[0]!) });
    expect(toggle.className).toContain("min-h-6");
    expect(toggle.className).toContain("pointer-coarse:min-h-11");
  });

  it("tints the whole deep-linked thread, and names the panel after the tab it shows", async () => {
    installApi({
      comments: [
        row({ id: "c1", kind: "comment", type: "comment", anchor: { format: "docx", v: 1, path: [0], start: 0, end: 1, quote: "q", prefix: "", suffix: "" }, anchor_state: "exact" }),
        row({ id: "d1x", body: "Bài thảo luận" }),
        row({ id: "d2x", body: "Bài khác" }),
      ],
    });
    renderPanel({ doc: docxDoc(), search: "comment=d1x" });
    const pane = await screen.findByTestId("document-comments-pane");
    await waitFor(() => expect(thread("d1x")).toHaveAttribute("data-highlighted", "true"));
    expect(thread("d2x")).not.toHaveAttribute("data-highlighted");
    expect(within(pane).getByRole("heading", { level: 2 })).toHaveTextContent(discussionTitle());
    fireEvent.click(within(pane).getByRole("tab", { name: commentsTitle() }));
    expect(within(pane).getByRole("heading", { level: 2 })).toHaveTextContent(commentsTitle());
    expect(within(pane).getByRole("button", { name: t(K.collabClosePanel, { panel: commentsTitle() }) })).toBeInTheDocument();
  });
});
