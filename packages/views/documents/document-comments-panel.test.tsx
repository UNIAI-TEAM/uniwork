import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import { documentCommentDraftKey, useDocumentCommentDraftStore } from "@uniwork/core/documents/comment-drafts";
import { documentKeys } from "@uniwork/core/documents/keys";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { DocumentSchema, type Document, type DocumentComment } from "@uniwork/core/types/document";
import type { Member, User } from "@uniwork/core/types";
import { localeAdapter } from "../test/api-mock";
import { requestMock } from "../test/request-mock";
import { DocumentCommentsHeaderActions, DocumentCommentsProvider } from "./document-comments-context";
import { DocumentCommentsPanel } from "./document-comments-panel";

// The panel renders the shared composer, which mounts the TipTap editor. The
// suite mocks the editor transport the way the task composer suite does (a
// textarea standing in for TipTap, a `useComposerSubmit` that mirrors the
// real accepted-only-on-success contract) so the panel's own wiring — draft
// keying, permission gating, mutation calls — is what these tests exercise.
// The real editor behaviour is pinned by the editor and task suites.
const editorProbe = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("../editor", () => {
  const ContentEditor = forwardRef(function MockContentEditor(
    props: {
      defaultValue?: string;
      onUpdate?: (md: string) => void;
      onReady?: () => void;
      onSubmit?: () => void;
      placeholder?: string;
      mentionMode?: string;
      mentionContextItems?: unknown[];
    },
    ref,
  ) {
    const { defaultValue = "", onUpdate, onReady, onSubmit, placeholder } = props;
    editorProbe.props = props as unknown as Record<string, unknown>;
    const [value, setValue] = useState(defaultValue);
    useImperativeHandle(ref, () => ({
      focus: () => {},
      getMarkdown: () => value,
      clearContent: () => {
        setValue("");
        onUpdate?.("");
      },
      flushPendingUpdate: () => value,
      hasActiveUploads: () => false,
      uploadFile: () => {},
      focusAtCoords: () => {},
      focusAtAnchor: () => {},
      insertMarkdownAtEnd: () => true,
      insertUploadPlaceholder: () => true,
      settleUploadPlaceholder: () => true,
      adoptContent: () => {},
      blur: () => {},
    }));
    queueMicrotask(() => onReady?.());
    return (
      <textarea
        aria-label={placeholder ?? "editor"}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onUpdate?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit?.();
        }}
      />
    );
  });
  return {
    ContentEditor,
    ReadonlyContent: ({ content }: { content: string }) => <div>{content}</div>,
    useLazyEditor: ({
      editorRef,
      initialActive = false,
    }: {
      editorRef: { current: unknown };
      initialActive?: boolean;
    }) => {
      const [active, setActive] = useState(initialActive);
      const [ready, setReady] = useState(initialActive);
      return {
        active,
        ready,
        activate: () => {
          setActive(true);
          setReady(true);
          void editorRef;
        },
        onReady: () => setReady(true),
        uploadOrQueue: () => {},
      };
    },
    useUploadGate: () => ({
      uploading: false,
      onUploadingChange: () => {},
      isBlocked: () => false,
    }),
    useEditorUpload: () => ({ upload: vi.fn(), uploading: false }),
    useComposerSubmit: ({
      editorRef,
      onSubmit,
      onAccepted,
    }: {
      editorRef: { current: { getMarkdown?: () => string } | null };
      onSubmit: (content: string) => Promise<boolean>;
      onAccepted?: () => void;
    }) => {
      const [submitting, setSubmitting] = useState(false);
      return {
        submitting,
        submit: async () => {
          const md = editorRef.current?.getMarkdown?.() ?? "";
          if (!md.trim() || submitting) return;
          setSubmitting(true);
          try {
            const ok = await onSubmit(md);
            if (ok) onAccepted?.();
          } finally {
            setSubmitting(false);
          }
        },
      };
    },
  };
});

const { t } = initI18n();

const WS = "ws1";
const DOC = "d1";
const ORG = "org1";
const ME = "u1";
const OTHER = "u2";

const me: User = {
  id: ME,
  email: "me@example.com",
  display_name: "Minh",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

function makeDoc(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
    id: DOC,
    workspace_id: WS,
    organization_id: ORG,
    kind: "page",
    title: "Tài liệu",
    revision: "3",
    current_version: 1,
    my_level: "edit",
    ...over,
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
  };
}

function makeComment(over: Partial<DocumentComment> = {}): DocumentComment {
  return {
    id: "c1",
    document_id: DOC,
    author_id: OTHER,
    author_kind: "human",
    body: "Bình luận một",
    parent_id: null,
    type: "comment",
    revision: 1,
    resolved_at: null,
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    display_name: "Lan",
    avatar_url: "",
    reactions: [],
    ...over,
  } as DocumentComment;
}

function makeMember(over: Partial<Member> = {}): Member {
  return {
    workspace_id: WS,
    user_id: OTHER,
    role: "member",
    email: "lan@example.com",
    display_name: "Lan",
    ...over,
  } as Member;
}

type MockInit = { method?: string; body?: unknown; headers?: Record<string, string> };

function installApi(
  opts: {
    comments?: DocumentComment[];
    members?: Member[];
    favorites?: { document_id: string }[];
    extra?: (method: string, path: string, init?: MockInit) => Promise<unknown> | undefined;
  } = {},
) {
  requestMock.mockImplementation((path: string, init?: MockInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const hit = opts.extra?.(method, path, init);
    if (hit !== undefined) return hit;
    if (method === "GET" && path === `/api/v1/workspaces/${WS}/members`) {
      return Promise.resolve({ members: opts.members ?? [] });
    }
    if (method === "GET" && path === `/api/v1/orgs/${ORG}/documents/favorites`) {
      return Promise.resolve({ favorites: opts.favorites ?? [] });
    }
    if (path.startsWith(`/api/v1/documents/${DOC}/comments`)) {
      if (method === "GET") return Promise.resolve({ comments: opts.comments ?? [] });
      if (method === "POST" && path === `/api/v1/documents/${DOC}/comments`) {
        const body = (init?.body ?? {}) as { body?: string; parent_id?: string };
        return Promise.resolve({
          comment: makeComment({
            id: "new1",
            author_id: ME,
            body: body.body ?? "",
            parent_id: body.parent_id ?? null,
          }),
        });
      }
      if (method === "PATCH") return Promise.resolve({ comment: makeComment({ body: "đã sửa" }) });
      if (path.endsWith("/resolve") && method === "POST") {
        return Promise.resolve({ comment: makeComment({ resolved_at: "2026-09-28T04:00:00Z" }) });
      }
      if (path.endsWith("/resolve")) return Promise.resolve({ comment: makeComment() });
      if (path.endsWith("/reactions") && method === "POST") {
        return Promise.resolve({
          reaction: {
            id: "r9",
            comment_id: "c1",
            actor_type: "member",
            actor_id: ME,
            emoji: "👍",
            created_at: "2026-09-28T04:00:00Z",
          },
        });
      }
      if (path.endsWith("/reactions")) return Promise.resolve({ status: "ok" });
      if (method === "DELETE") return Promise.resolve({ status: "ok" });
    }
    if (path === `/api/v1/documents/${DOC}/favorite`) {
      if (method === "POST") return Promise.resolve({ favorite: { document_id: DOC } });
      return Promise.resolve({ status: "ok" });
    }
    return Promise.reject(new ApiError("not found", "not_found", 404));
  });
}

function renderPanel(opts: {
  doc?: Document;
  flag?: boolean;
  onClose?: () => void;
} = {}) {
  const doc = opts.doc ?? makeDoc();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  const service = new FeatureFlagService(
    new StaticProvider({ documents: { default: opts.flag ?? true } }),
  );
  const view = render(
    <QueryClientProvider client={client}>
      <FeatureFlagsProvider service={service}>
        <LocaleAdapterProvider adapter={localeAdapter}>
          <DocumentCommentsProvider wsId={WS} doc={doc}>
            <DocumentCommentsHeaderActions />
            <DocumentCommentsPanel />
          </DocumentCommentsProvider>
        </LocaleAdapterProvider>
      </FeatureFlagsProvider>
    </QueryClientProvider>,
  );
  return { client, doc, ...view };
}

async function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: t("documents.comments.open") }));
  return screen.findByTestId("document-comments-pane");
}

/** The composer is lazy: the stand-in must be clicked before the editor exists. */
async function activateComposer(scope: HTMLElement) {
  const label = new RegExp(t("documents.comments.comment_placeholder"), "i");
  const standIn = within(scope).getByRole("button", { name: label });
  fireEvent.click(standIn);
  return within(scope).findByRole("textbox", { name: label });
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  window.innerWidth = 1400; // desktop rail: the inline pane, no sheet portal
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  useDocumentCommentDraftStore.setState({ drafts: {}, ownerId: null });
  editorProbe.props = null;
});

describe("DocumentCommentsPanel states", () => {
  it("stays behind the documents flag and asks the server nothing", () => {
    installApi();
    renderPanel({ flag: false });
    expect(screen.queryByRole("button", { name: t("documents.comments.open") })).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("shows a skeleton while the thread loads", async () => {
    installApi({ extra: () => new Promise(() => {}) });
    renderPanel();
    await openPanel();
    expect(screen.getByTestId("document-comments-loading")).toHaveAttribute("aria-busy", "true");
  });

  it("offers the load again on a failed read", async () => {
    let fail = true;
    installApi({
      extra: (method, path) =>
        method === "GET" && path === `/api/v1/documents/${DOC}/comments`
          ? fail
            ? Promise.reject(new ApiError("boom", "internal", 500))
            : Promise.resolve({ comments: [] })
          : undefined,
    });
    renderPanel();
    await openPanel();

    expect(await screen.findByTestId("document-comments-error")).toBeInTheDocument();
    expect(screen.getByText(t("documents.comments.error_title"))).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("documents.comments.retry") }));
    expect(await screen.findByTestId("document-comments-empty")).toBeInTheDocument();
  });

  it("hides the thread when read access is revoked while the panel is open", async () => {
    let revoked = false;
    installApi({
      comments: [makeComment()],
      extra: (method, path) =>
        method === "GET" && path === `/api/v1/documents/${DOC}/comments`
          ? revoked
            ? Promise.reject(new ApiError("forbidden", "forbidden", 403))
            : Promise.resolve({ comments: [makeComment()] })
          : undefined,
    });
    const { client } = renderPanel();
    await openPanel();
    expect(await screen.findByTestId("document-comment-c1")).toBeInTheDocument();

    revoked = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: documentKeys.comments(WS, DOC) });
    });

    expect(await screen.findByText(t("documents.comments.revoked_title"))).toBeInTheDocument();
    expect(screen.queryByTestId("document-comment-c1")).toBeNull();
    expect(screen.queryByTestId("document-comment-composer")).toBeNull();
  });

  it("shows the empty state and a composer for editors", async () => {
    installApi();
    renderPanel();
    await openPanel();

    expect(await screen.findByTestId("document-comments-empty")).toBeInTheDocument();
    expect(screen.getByTestId("document-comment-composer")).toBeInTheDocument();
  });

  it("lists threads with replies and the total count", async () => {
    installApi({
      comments: [
        makeComment(),
        makeComment({ id: "c2", parent_id: "c1", body: "Trả lời một", author_id: ME }),
      ],
    });
    renderPanel();
    await openPanel();

    expect(await screen.findByTestId("document-comment-c1")).toBeInTheDocument();
    expect(screen.getByTestId("document-comment-c2")).toBeInTheDocument();
    expect(screen.getByText("Trả lời một")).toBeInTheDocument();
    expect(screen.getByText(t("documents.comments.count", { count: 2 }))).toBeInTheDocument();
  });

  it("keeps a view-only reader read-only: no composer, no actions, plain reaction chips", async () => {
    installApi({
      comments: [
        makeComment({
          reactions: [
            {
              id: "r1",
              comment_id: "c1",
              actor_type: "member",
              actor_id: OTHER,
              emoji: "👍",
              created_at: "2026-09-28T03:01:00Z",
            },
          ],
        }),
      ],
      members: [makeMember()],
    });
    renderPanel({ doc: makeDoc({ my_level: "view" }) });
    await openPanel();

    expect(await screen.findByTestId("document-comment-c1")).toBeInTheDocument();
    // The reaction is still readable, but nothing on the card is a button.
    expect(screen.getByLabelText(/👍 1: Lan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /👍 1: Lan/ })).toBeNull();
    // The actions menu still offers Copy, never a write the server would refuse.
    fireEvent.click(screen.getByRole("button", { name: t("documents.comments.comment_actions") }));
    expect(screen.getByRole("menuitem", { name: t("documents.comments.comment_copy") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.comments.comment_edit") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("common.delete") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.comments.comment_resolve") })).toBeNull();
    expect(screen.queryByTestId("document-comment-composer")).toBeNull();
    expect(screen.queryByTestId("document-reply-composer-c1")).toBeNull();
  });

  it("renders a sheet below the xl breakpoint", async () => {
    window.innerWidth = 800;
    installApi();
    renderPanel();
    await openPanel();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("document-comments-pane")).toBeInTheDocument();
  });
});

describe("DocumentCommentsPanel permissions", () => {
  it("gives an edit-level author edit/delete on their own comment only", async () => {
    installApi({
      comments: [makeComment(), makeComment({ id: "c2", author_id: ME, body: "Của tôi" })],
    });
    renderPanel();
    await openPanel();

    const own = await screen.findByTestId("document-comment-c2");
    fireEvent.click(within(own).getByRole("button", { name: t("documents.comments.comment_actions") }));
    expect(screen.getByRole("menuitem", { name: t("documents.comments.comment_edit") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("common.delete") })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    const other = screen.getByTestId("document-comment-c1");
    fireEvent.click(within(other).getByRole("button", { name: t("documents.comments.comment_actions") }));
    expect(screen.queryByRole("menuitem", { name: t("documents.comments.comment_edit") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("common.delete") })).toBeNull();
    expect(screen.getByRole("menuitem", { name: t("documents.comments.comment_resolve") })).toBeInTheDocument();
  });

  it("lets a manager edit and delete someone else's comment", async () => {
    installApi({ comments: [makeComment()] });
    renderPanel({ doc: makeDoc({ my_level: "manage" }) });
    await openPanel();

    const card = await screen.findByTestId("document-comment-c1");
    fireEvent.click(within(card).getByRole("button", { name: t("documents.comments.comment_actions") }));
    expect(screen.getByRole("menuitem", { name: t("documents.comments.comment_edit") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("common.delete") })).toBeInTheDocument();
  });
});

describe("DocumentCommentsPanel mutations", () => {
  it("creates a root comment with an idempotency key and no parent", async () => {
    installApi({ comments: [] });
    renderPanel();
    await openPanel();
    const root = await screen.findByTestId("document-comment-composer");
    const editor = await activateComposer(root);
    fireEvent.change(editor, { target: { value: "Bình luận mới" } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      const post = requestMock.mock.calls.find(
        ([path, init]) =>
          (init as MockInit)?.method === "POST" && path === `/api/v1/documents/${DOC}/comments`,
      );
      expect(post).toBeTruthy();
      const body = (post?.[1] as MockInit).body as Record<string, unknown>;
      expect(body.body).toBe("Bình luận mới");
      expect(body.parent_id).toBeUndefined();
      expect((post?.[1] as MockInit).headers?.["Idempotency-Key"]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });
  });

  it("sends a reply with the root comment as parent", async () => {
    installApi({ comments: [makeComment()] });
    renderPanel();
    await openPanel();
    const reply = await screen.findByTestId("document-reply-composer-c1");
    const editor = await activateComposer(reply);
    fireEvent.change(editor, { target: { value: "Đồng ý" } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      const post = requestMock.mock.calls.find(
        ([path, init]) =>
          (init as MockInit)?.method === "POST" && path === `/api/v1/documents/${DOC}/comments`,
      );
      expect(post).toBeTruthy();
      expect((post?.[1] as MockInit).body).toMatchObject({ body: "Đồng ý", parent_id: "c1" });
    });
  });

  it("resolves and reopens from the comment menu", async () => {
    installApi({ comments: [makeComment()] });
    renderPanel();
    await openPanel();

    const card = await screen.findByTestId("document-comment-c1");
    fireEvent.click(within(card).getByRole("button", { name: t("documents.comments.comment_actions") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.comments.comment_resolve") }));

    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, init]) =>
            (init as MockInit)?.method === "POST" &&
            path === `/api/v1/documents/${DOC}/comments/c1/resolve`,
        ),
      ).toBe(true),
    );

    // The mutation invalidated the thread key, so the list is re-read.
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, init]) =>
            ((init as MockInit)?.method ?? "GET") === "GET" &&
            path === `/api/v1/documents/${DOC}/comments`,
        ),
      ).toBe(true),
    );
  });

  it("reacts on add and removes when the caller already reacted", async () => {
    installApi({
      comments: [
        makeComment({
          reactions: [
            {
              id: "r1",
              comment_id: "c1",
              actor_type: "member",
              actor_id: ME,
              emoji: "👍",
              created_at: "2026-09-28T03:01:00Z",
            },
          ],
        }),
      ],
      members: [makeMember({ user_id: ME, display_name: "Minh" })],
    });
    renderPanel();
    await openPanel();

    fireEvent.click(await screen.findByRole("button", { name: /👍 1: Minh/ }));
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, init]) =>
            (init as MockInit)?.method === "DELETE" &&
            path === `/api/v1/documents/${DOC}/comments/c1/reactions`,
        ),
      ).toBe(true),
    );
  });

  it("edits the body and keeps the box open when the patch is refused", async () => {
    let patchFails = true;
    installApi({
      comments: [makeComment({ author_id: ME })],
      extra: (method, path) =>
        method === "PATCH" && path.startsWith(`/api/v1/documents/${DOC}/comments/`)
          ? patchFails
            ? Promise.reject(new ApiError("unverifiable", "internal", 500))
            : Promise.resolve({ comment: makeComment({ author_id: ME, body: "đã sửa" }) })
          : undefined,
    });
    renderPanel();
    await openPanel();

    const card = await screen.findByTestId("document-comment-c1");
    fireEvent.click(within(card).getByRole("button", { name: t("documents.comments.comment_actions") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.comments.comment_edit") }));

    const editor = within(card).getByRole("textbox", {
      name: new RegExp(t("documents.comments.comment_edit_placeholder"), "i"),
    });
    fireEvent.change(editor, { target: { value: "đã sửa" } });
    fireEvent.click(within(card).getByRole("button", { name: t("common.save") }));

    await waitFor(() => {
      expect(
        requestMock.mock.calls.some(
          ([path, init]) =>
            (init as MockInit)?.method === "PATCH" &&
            path === `/api/v1/documents/${DOC}/comments/c1`,
        ),
      ).toBe(true);
    });
    // Still editing: the refused write did not close the editor or touch the list.
    await waitFor(() => expect(within(card).getByTestId("document-comment-editor")).toBeInTheDocument());
    expect(screen.getByText("Bình luận một")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting", async () => {
    installApi({ comments: [makeComment({ author_id: ME })] });
    renderPanel();
    await openPanel();

    const card = await screen.findByTestId("document-comment-c1");
    fireEvent.click(within(card).getByRole("button", { name: t("documents.comments.comment_actions") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("common.delete") }));
    expect(
      requestMock.mock.calls.some(([, init]) => (init as MockInit)?.method === "DELETE"),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: t("documents.comments.comment_delete_confirm") }));
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, init]) =>
            (init as MockInit)?.method === "DELETE" &&
            path === `/api/v1/documents/${DOC}/comments/c1`,
        ),
      ).toBe(true),
    );
  });
});

describe("DocumentCommentsPanel mentions and drafts", () => {
  it("feeds the picking to server members only, not a locally invented list", async () => {
    installApi({
      members: [makeMember(), makeMember({ user_id: "u3", display_name: "Bảo" })],
    });
    renderPanel();
    await openPanel();
    const root = await screen.findByTestId("document-comment-composer");
    await activateComposer(root);

    await waitFor(() => expect(editorProbe.props).not.toBeNull());
    // The probe reads the LAST mounted editor; the composer mounts it.
    await waitFor(() =>
      expect(editorProbe.props?.mentionMode).toBe("context"),
    );
    expect(editorProbe.props?.mentionContextItems).toEqual([
      { id: OTHER, label: "Lan", type: "member" },
      { id: "u3", label: "Bảo", type: "member" },
    ]);
  });

  it("never shows another account's draft and keeps the key per document and parent", async () => {
    installApi({ comments: [makeComment()] });
    const accountKey = documentCommentDraftKey({
      accountId: ME,
      orgId: ORG,
      wsId: WS,
      documentId: DOC,
      parentId: null,
    });
    const otherAccountKey = documentCommentDraftKey({
      accountId: "u9",
      orgId: ORG,
      wsId: WS,
      documentId: DOC,
      parentId: null,
    });
    const otherDocKey = documentCommentDraftKey({
      accountId: ME,
      orgId: ORG,
      wsId: WS,
      documentId: "d2",
      parentId: null,
    });
    const replyKey = documentCommentDraftKey({
      accountId: ME,
      orgId: ORG,
      wsId: WS,
      documentId: DOC,
      parentId: "c1",
    });
    useDocumentCommentDraftStore.setState({
      drafts: {
        [accountKey]: "nháp gốc",
        [accountKey.replace("/root", "/c1")]: "nháp trả lời",
        [otherAccountKey]: "nháp người khác",
        [otherDocKey]: "nháp tài liệu khác",
        [replyKey]: "nháp trả lời",
      },
      ownerId: ME,
    });

    renderPanel();
    await openPanel();

    // Root composer: its own draft, not the reply's, not another document's,
    // not another account's.
    const root = await screen.findByTestId("document-comment-composer");
    const rootEditor = within(root).getByRole("textbox", {
      name: new RegExp(t("documents.comments.comment_placeholder"), "i"),
    });
    expect(rootEditor).toHaveValue("nháp gốc");

    const reply = await screen.findByTestId("document-reply-composer-c1");
    const replyEditor = within(reply).getByRole("textbox", {
      name: new RegExp(t("documents.comments.comment_placeholder"), "i"),
    });
    expect(replyEditor).toHaveValue("nháp trả lời");
    // The other account's draft is not even readable for this owner.
    expect(useDocumentCommentDraftStore.getState().draftFor(otherAccountKey)).toBe("");
  });
});

describe("DocumentFavoriteToggle", () => {
  it("reads its state from the server list and removes on click", async () => {
    installApi({ favorites: [{ document_id: DOC }] });
    renderPanel();
    await openPanel();

    const star = await screen.findByRole("button", { name: t("documents.comments.favorite_remove") });
    expect(star).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(star);

    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, init]) =>
            (init as MockInit)?.method === "DELETE" &&
            path === `/api/v1/documents/${DOC}/favorite`,
        ),
      ).toBe(true),
    );
  });

  it("adds when the list does not hold the document", async () => {
    installApi({ favorites: [] });
    renderPanel();
    await openPanel();

    const star = await screen.findByRole("button", { name: t("documents.comments.favorite_add") });
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);

    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, init]) =>
            (init as MockInit)?.method === "POST" &&
            path === `/api/v1/documents/${DOC}/favorite`,
        ),
      ).toBe(true),
    );
  });
});
