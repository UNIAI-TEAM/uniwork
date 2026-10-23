import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type WSMessage } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { PROTOCOL_NS, PROTOCOL_VERSION, checkInitComments, type Envelope, type InitPayload, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import type { User } from "@uniwork/core/types";
import { requestMock } from "../../test/api-mock";
import { useDocsFrameSession } from "./use-docs-frame-session";
import { AVATAR_ROUTE_FRAME_VERSIONS } from "./frame-avatar-url";
import { useFrameComments } from "./use-frame-comments";

// One fake workspace socket for every test: the hook subscribes with onAny. The session's
// new-version source (use-frame-remote-source.ts) subscribes with on/onReconnect; this file is
// about comments, so those stay silent.
const socket = new Set<(message: WSMessage) => void>();
const fakeClient = {
  onAny: (handler: (message: WSMessage) => void) => {
    socket.add(handler);
    return () => { socket.delete(handler); };
  },
  on: () => () => {},
  onReconnect: () => () => {},
};
vi.mock("@uniwork/core/realtime", () => ({ useOptionalWS: () => ({ client: fakeClient }) }));
// The draft key needs IndexedDB; this file is about comments.
vi.mock("@uniwork/core/office/draft-session-key", () => ({
  getOfficeDraftKey: vi.fn(async () => ({}) as CryptoKey),
  officeDraftScope: (user: string, doc: string) => `${user}/${doc}`,
}));

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const OTHER_MINT_PATH = "/api/v1/documents/doc-2/office/frame-token";
const COMMENTS_PATH = "/api/v1/documents/doc-1/comments";
const ME = "01J8X4USR0AAAAAAAAAAAAAAAA";
const WIRE = { id: "c1", document_id: "doc-1", kind: "comment", body: "x", anchor: null, anchor_state: null, deleted_at: null };
// The shared body fixture (contract-collab §3): a mention token + every Markdown-subset part. Copied
// verbatim from the fork's BODY_FIXTURE (web/docs/protocol/test/comments.test.ts in uniwork-office) so
// both sides of the relay pin the same bytes; keep the two in step.
const BODY_FIXTURE =
  "Xem lại [@Nguyễn \\[An\\]](mention://member/01J8X4USR0AAAAAAAAAAAAAAAA) giúp nhé:\n" +
  "**đậm**, *nghiêng*, `code [@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)`,\n" +
  "[liên kết](https://example.com/a?b=1&c=2)  \nxuống dòng — <b>không HTML</b> ✓";

const minted = (canEdit = true) => ({
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: canEdit, module: "docs",
});

interface Props { myLevel?: string | null; revealCommentId?: string | null; documentId?: string; frameVersion?: string }

/** The editor frame on the other side of the wire: records what the host posts, answers `init`, posts requests. */
function setup({ module = "docs" as OfficeModule, canEdit = true, readonly = false, frameComments = true, ...initial }: Props & { module?: OfficeModule; canEdit?: boolean; readonly?: boolean; frameComments?: boolean } = {}) {
  const api = vi.fn<(path: string, opts?: { method?: string; headers?: Record<string, string> }) => Promise<unknown>>((path, opts) => {
    if (path === MINT_PATH) return Promise.resolve({ ...minted(canEdit), module });
    if (path === OTHER_MINT_PATH) return Promise.resolve({ ...minted(canEdit), module, document_id: "doc-2" });
    // Any other document (the avatar tests use a ULID one) mints for itself.
    const mint = /^\/api\/v1\/documents\/([^/]+)\/office\/frame-token$/.exec(String(path));
    if (mint) return Promise.resolve({ ...minted(canEdit), module, document_id: mint[1] });
    // The session reads its upload ceiling from GET /api/v1/config (useDocumentLimits); answer it
    // like use-docs-frame-session.test.tsx does so the query resolves instead of erroring.
    if (String(path).startsWith("/api/v1/config")) return Promise.resolve({ flags: {} });
    return Promise.reject(new Error(`unexpected ${path} ${opts?.method ?? "GET"}`));
  });
  requestMock.mockImplementation(api);
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const win = iframe.contentWindow!;
  const received: Envelope[] = [];
  let seq = 0;
  const post = (data: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin, source: win }));
  });
  const envelope = (kind: Envelope["kind"], type: string, payload: unknown, id = `f${(seq += 1)}`): Envelope =>
    ({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind, type, payload });
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
    const m = message as Envelope;
    received.push(m);
    if (m.kind === "request" && m.type === "init") {
      queueMicrotask(() => { void post(envelope("response", "init", { protocolVersion: 1, capabilities: frameComments ? { comments: true } : {} }, m.id)); });
    }
  });
  const onError = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  // One ref object for every render: the session restarts its endpoint when this identity changes.
  const iframeRef = { current: iframe };
  // Every render's `framePanel`, so a test can prove it never dipped between a detach and the next ack.
  const panels: boolean[] = [];
  const hook = renderHook((props: Props) => {
    const documentId = props.documentId ?? "doc-1";
    const comments = useFrameComments({ wsId: "ws-1", frameVersion: "", ...props, documentId });
    panels.push(comments.framePanel);
    const session = useDocsFrameSession({
      iframeRef, frameOrigin: window.location.origin, module, wsId: "ws-1", fileRef: { kind: "document", id: documentId },
      readonly, locale: "vi", theme: "light", onError, comments: comments.binding,
      api: { open: vi.fn(), save: vi.fn(), recents: vi.fn() } as unknown as DocsFrameApi,
    });
    return { comments, session };
  }, { wrapper, initialProps: initial as Props });
  const sent = (type: string) => received.filter((m) => m.kind === "request" && m.type === type);
  const frame = {
    hook, panels, received, sent, onError, api, client,
    rerender: (props: Props) => hook.rerender(props),
    event: (type: string, payload: unknown) => post(envelope("event", type, payload)),
    respond: (to: Envelope, payload: unknown) => post(envelope("response", to.type, payload, to.id)),
    request: async (type: string, payload: unknown) => {
      const e = envelope("request", type, payload);
      await post(e);
      return e.id;
    },
    answerTo: (id: string) => received.find((m) => m.kind === "response" && m.id === id),
    async answerOf(id: string) {
      await waitFor(() => expect(frame.answerTo(id)).toBeDefined());
      return frame.answerTo(id)!;
    },
    async boot(instanceId = "i-1") {
      await post(envelope("event", "ready", { protocolVersion: 1, capabilities: { comments: frameComments }, module, instanceId }));
      await waitFor(() => expect(hook.result.current.session.status).toBe("ready"));
    },
    commentsRequests: () => api.mock.calls.filter(([path]) => String(path).startsWith(COMMENTS_PATH) || String(path).includes("mention-candidates")),
  };
  return frame;
}

/** The protocol error a failed request answered with (`error` on the response envelope). */
const errorOf = (answer: Envelope) => answer.error;

const wsFrame = (type: string, payload: unknown): WSMessage => ({ type, payload });
const publish = (message: WSMessage) => act(() => { for (const handler of [...socket]) handler(message); });
const initOf = (frame: ReturnType<typeof setup>) => frame.sent("init")[0]!.payload as {
  capabilities: Record<string, unknown>; commentsLevel?: string; user?: { displayName: string; id?: string };
};

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser({ id: ME, display_name: "An" } as User);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  requestMock.mockReset();
  socket.clear();
  document.body.innerHTML = "";
});

describe("useFrameComments: what init advertises (OQ-C12)", () => {
  it("advertises comments, the user id and the document's own level", async () => {
    const frame = setup({ myLevel: "manage" });
    await frame.boot();
    const init = initOf(frame);
    expect(init.capabilities.comments).toBe(true);
    expect(init.commentsLevel).toBe("manage");
    expect(init.user).toEqual({ displayName: "An", id: ME });
    expect(frame.hook.result.current.comments.framePanel).toBe(true);
  });

  it.each([
    ["view", { myLevel: "view" }, "view"],
    ["comment (DOC-05)", { myLevel: "comment" }, "comment"],
    ["edit", { myLevel: "edit" }, "edit"],
    ["manage", { myLevel: "manage" }, "manage"],
    ["a level the client does not know never maps upward", { myLevel: "owner" }, "view"],
    ["an empty level (admin-only caller) is view", { myLevel: "" }, "view"],
    ["a read-only page never gets more than view", { myLevel: "manage", readonly: true }, "view"],
    ["no level and an editor token: edit, never manage", { myLevel: null }, "edit"],
    ["no level and a token that cannot edit (sheets): view", { myLevel: undefined, module: "sheets" as const, canEdit: false }, "view"],
  ])("%s", async (_name, props, level) => {
    const frame = setup(props);
    await frame.boot();
    expect(initOf(frame).commentsLevel).toBe(level);
    expect(initOf(frame).capabilities.comments).toBe(true);
    // The host-side rule of the protocol: a host that grants comments must send a valid level.
    expect(checkInitComments(frame.sent("init")[0]!.payload as InitPayload)).toBeNull();
  });

  it.each([
    ["manage", { myLevel: "manage" }, true],
    ["edit", { myLevel: "edit" }, false],
    ["comment", { myLevel: "comment" }, false],
    ["a read-only page", { myLevel: "manage", readonly: true }, false],
    ["an unknown level", { myLevel: "owner" }, false],
  ])("advertises commentsShareView only to a caller who can share (%s)", async (_name, props, granted) => {
    const frame = setup(props);
    await frame.boot();
    expect(initOf(frame).capabilities.commentsShareView === true).toBe(granted);
    expect(checkInitComments(frame.sent("init")[0]!.payload as InitPayload)).toBeNull();
  });

  it("a frame that predates comments (its ack has none): the page keeps its own panel", async () => {
    const frame = setup({ myLevel: "edit", frameComments: false });
    await frame.boot();
    expect(frame.hook.result.current.comments.framePanel).toBe(false);
  });
});

describe("useFrameComments: a re-key of the same document keeps the frame's claim", () => {
  it("holds the page panel back from the detach to the next ack, never a render without the claim", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot("i-1");
    expect(frame.hook.result.current.comments.framePanel).toBe(true);
    const before = frame.panels.length;

    // A retry re-keys the frame endpoint: detach now, the new instance's ack later.
    await act(async () => { frame.hook.result.current.session.retry(); });
    expect(frame.hook.result.current.comments.framePanel).toBe(true);
    await frame.boot("i-2");

    expect(frame.panels.length).toBeGreaterThan(before);
    expect(frame.panels.slice(before)).not.toContain(false);
    expect(frame.hook.result.current.comments.framePanel).toBe(true);
  });

  it("does not carry the claim to another document", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot("i-1");
    expect(frame.hook.result.current.comments.framePanel).toBe(true);

    await act(async () => { frame.rerender({ myLevel: "edit", documentId: "doc-2" }); });

    expect(frame.hook.result.current.comments.framePanel).toBe(false);
  });
});

describe("useFrameComments: realtime becomes comments.changed", () => {
  it.each([
    "document.comment_added", "document.comment_updated", "document.comment_deleted", "document.comment_resolved",
    "document.comment_unresolved", "document.comment_anchors_updated",
  ])("%s for this document is sent once, with the document id only", async (type) => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    await publish(wsFrame(type, { document_id: "doc-1", workspace_id: "ws-1", comment_id: "c1" }));
    const events = frame.received.filter((m) => m.kind === "event" && m.type === "comments.changed");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ document_id: "doc-1" });
  });

  it("a frame for another document, another workspace or another topic sends nothing", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    await publish(wsFrame("document.comment_added", { document_id: "doc-2", workspace_id: "ws-1" }));
    await publish(wsFrame("document.comment_added", { document_id: "doc-1", workspace_id: "ws-2" }));
    await publish(wsFrame("document.updated", { document_id: "doc-1", workspace_id: "ws-1" }));
    await publish(wsFrame("document.comment_added", "garbage"));
    expect(frame.received.filter((m) => m.type === "comments.changed")).toEqual([]);
  });

  it("a frame without comments is told nothing", async () => {
    const frame = setup({ myLevel: "edit", frameComments: false });
    await frame.boot();
    await publish(wsFrame("document.comment_added", { document_id: "doc-1", workspace_id: "ws-1" }));
    expect(frame.received.filter((m) => m.type === "comments.changed")).toEqual([]);
  });

  it("stops listening when the session ends", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    expect(socket.size).toBe(1);
    frame.hook.unmount();
    expect(socket.size).toBe(0);
  });
});

describe("useFrameComments: the frame's requests go to the D API with the user's session", () => {
  it("lists with kind and since_token, and answers `unchanged` as the token alone", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    frame.api.mockImplementation((path: string) =>
      path.startsWith(COMMENTS_PATH) ? Promise.resolve({ comments: [], mentions: [], list_token: "lt1:aa", unchanged: true }) : Promise.reject(new Error(path)));
    const id = await frame.request("comments.list", { kind: "comment", since_token: "lt1:aa" });
    const answer = await frame.answerOf(id);
    expect(frame.api).toHaveBeenLastCalledWith(`${COMMENTS_PATH}?kind=comment&since_token=lt1%3Aaa`, expect.objectContaining({}));
    expect(answer.payload).toEqual({ comments: [], mentions: [], list_token: "lt1:aa", unchanged: true });
  });

  it("returns the full list with the wire fields the D panel would strip", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    const list = { comments: [{ ...WIRE, anchor: { format: "xlsx", v: 1, sheet: "S1", range: "B7" }, anchor_state: "exact" }], mentions: [], list_token: "lt1:bb", unchanged: false };
    frame.api.mockResolvedValue(list);
    const answer = await frame.answerOf(await frame.request("comments.list", {}));
    expect(answer.payload).toEqual(list);
  });

  it("relays the shared fixture body byte-identical on create and on the list answer (card T1)", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    frame.api.mockResolvedValue({ comment: { ...WIRE, kind: "discussion", body: BODY_FIXTURE } });
    const created = await frame.answerOf(await frame.request("comments.create", { kind: "discussion", body: BODY_FIXTURE }));
    const [, createOpts] = frame.api.mock.calls.at(-1)!;
    expect((createOpts as { body: { body: string } }).body.body).toBe(BODY_FIXTURE);
    expect((created.payload as { comment: { body: string } }).comment.body).toBe(BODY_FIXTURE);
    const list = { comments: [{ ...WIRE, body: BODY_FIXTURE }], mentions: [], list_token: "lt1:cc", unchanged: false };
    frame.api.mockResolvedValue(list);
    const listed = await frame.answerOf(await frame.request("comments.list", {}));
    expect((listed.payload as { comments: Array<{ body: string }> }).comments[0]!.body).toBe(BODY_FIXTURE);
  });

  it("creates with one Idempotency-Key kept across the retries of that Send, and a new one after it succeeded", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    const payload = { kind: "discussion", body: "Xin chào" };
    const keys: Array<string | undefined> = [];
    frame.api.mockImplementation((path: string, opts?: { headers?: Record<string, string> }) => {
      keys.push(opts?.headers?.["Idempotency-Key"]);
      return keys.length === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve({ comment: WIRE });
    });
    const failed = await frame.answerOf(await frame.request("comments.create", payload));
    expect(errorOf(failed)?.code).toBe("network");
    await frame.answerOf(await frame.request("comments.create", payload));
    await frame.answerOf(await frame.request("comments.create", payload));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]); // the retry of the same Send
    expect(keys[2]).not.toBe(keys[1]); // the same text sent again after it went through is a new Send
  });

  it("keeps one Idempotency-Key per pending payload: a second thread sent meanwhile does not take the first one's key", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    const first = { kind: "discussion", body: "một" };
    const second = { kind: "discussion", body: "hai" };
    const keys: Array<string | undefined> = [];
    frame.api.mockImplementation((path: string, opts?: { headers?: Record<string, string> }) => {
      keys.push(opts?.headers?.["Idempotency-Key"]);
      return keys.length === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve({ comment: WIRE });
    });
    await frame.answerOf(await frame.request("comments.create", first)); // fails, stays pending
    await frame.answerOf(await frame.request("comments.create", second)); // goes through
    await frame.answerOf(await frame.request("comments.create", first)); // the retry of the first Send
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });

  it("maps comment_deleted to conflict + details.code with no retry, so the frame keeps its draft", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    frame.api.mockRejectedValue(new ApiError("gone", "comment_deleted", 409));
    const answer = await frame.answerOf(await frame.request("comments.update", { comment_id: "c1", body: "nháp" }));
    expect(errorOf(answer)).toMatchObject({ code: "conflict", retryable: false, details: { code: "comment_deleted" } });
  });

  it.each([
    [400, "anchor_version_invalid", "malformed"],
    [401, "unauthorized", "unauthorized"],
    [403, "forbidden", "forbidden"],
    [404, "not_found", "not_found"],
    [413, "payload_too_large", "too_large"],
    [429, "rate_limited", "rate_limited"],
    [503, "unavailable", "internal"],
  ])("HTTP %i %s becomes %s", async (status, code, expected) => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    frame.api.mockRejectedValue(new ApiError("x", code, status));
    const answer = await frame.answerOf(await frame.request("comments.resolve", { comment_id: "c1" }));
    expect(errorOf(answer)).toMatchObject({ code: expected, status });
  });

  it("a 405 on the anchors route the server now serves is `internal`, not a fabricated `unsupported`", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    // G8-04 merged PUT .../comments/anchors, so the §9 table's only route-less row is gone: a 405
    // is now an anomaly and takes the table default `internal`, never the `unsupported` the frame
    // would read as "this host lacks the capability". 405 is below 500, so retryable stays false.
    frame.api.mockRejectedValue(new ApiError("Method Not Allowed", "internal", 405));
    const answer = await frame.answerOf(
      await frame.request("comments.anchors", { version_id: "v1", anchors: [{ comment_id: "c1", anchor: { format: "docx", v: 1 }, state: "exact" }] }),
    );
    expect(errorOf(answer)).toMatchObject({ code: "internal", status: 405, retryable: false });
  });

  it("a network failure is `network`, retryable", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    frame.api.mockRejectedValue(new TypeError("Failed to fetch"));
    const answer = await frame.answerOf(await frame.request("comments.list", {}));
    expect(errorOf(answer)).toMatchObject({ code: "network", retryable: true });
  });

  it("a 200 that does not match the contract is an `internal` error, never an empty list", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    frame.api.mockResolvedValue({ nope: true });
    const answer = await frame.answerOf(await frame.request("comments.list", {}));
    expect(errorOf(answer)).toMatchObject({ code: "internal" });
  });

  it("delete, resolve, reopen, revisions, anchors and mention search use their routes", async () => {
    const frame = setup({ myLevel: "manage" });
    await frame.boot();
    const calls = (): Array<[string, string]> => frame.commentsRequests()
      .map(([path, opts]) => [(opts as { method?: string } | undefined)?.method ?? "GET", String(path)]);
    frame.api.mockImplementation((path: string) => {
      if (path.endsWith("/revisions")) return Promise.resolve({ revisions: [] });
      if (path.endsWith("/anchors")) return Promise.resolve({ updated: [], skipped: [], list_token: "lt1:z" });
      if (path.includes("mention-candidates")) return Promise.resolve({ candidates: [] });
      if (path.endsWith("/c1") && !path.includes("resolve")) return Promise.resolve({ status: "ok", outcome: "removed" });
      return Promise.resolve({ comment: WIRE });
    });
    for (const [type, payload] of [
      ["comments.delete", { comment_id: "c1" }],
      ["comments.resolve", { comment_id: "c1" }],
      ["comments.reopen", { comment_id: "c1" }],
      ["comments.revisions", { comment_id: "c1" }],
      ["comments.anchors", { version_id: "v2", anchors: [{ comment_id: "c1", anchor: { format: "docx", v: 1 }, state: "exact" }] }],
      ["mentions.search", { q: "ng", limit: 5 }],
    ] as const) {
      const answer = await frame.answerOf(await frame.request(type, payload));
      expect(answer.kind).toBe("response");
    }
    expect(calls()).toEqual([
      ["DELETE", `${COMMENTS_PATH}/c1`],
      ["POST", `${COMMENTS_PATH}/c1/resolve`],
      ["DELETE", `${COMMENTS_PATH}/c1/resolve`],
      ["GET", `${COMMENTS_PATH}/c1/revisions`],
      ["PUT", `${COMMENTS_PATH}/anchors`],
      ["GET", "/api/v1/documents/doc-1/mention-candidates?q=ng&limit=5"],
    ]);
  });
});

describe("useFrameComments: G8-18 comments.shareView and mentions without access", () => {
  const SHARE = { share: { id: "s1", principal_type: "user", principal_id: "u2", level: "view" } };
  const SHARES_PATH = "/api/v1/documents/doc-1/shares";

  it("shares view, and only view, with the named user and answers ok", async () => {
    const frame = setup({ myLevel: "manage" });
    await frame.boot();
    frame.api.mockResolvedValue(SHARE);
    const answer = await frame.answerOf(await frame.request("comments.shareView", { user_id: "u2" }));
    expect(frame.api).toHaveBeenLastCalledWith(
      SHARES_PATH,
      expect.objectContaining({ method: "POST", body: { principal_type: "user", principal_id: "u2", level: "view" } }),
    );
    expect(answer.payload).toEqual({ ok: true });
  });

  it("L9: a share the frame made refreshes the shares list an open share dialog reads", async () => {
    const frame = setup({ myLevel: "manage" });
    await frame.boot();
    const spy = vi.spyOn(frame.client, "invalidateQueries");
    frame.api.mockResolvedValue(SHARE);
    await frame.answerOf(await frame.request("comments.shareView", { user_id: "u2" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: documentKeys.shares("ws-1", "doc-1") });
  });

  it("L9: a refused share does not touch the shares cache", async () => {
    const frame = setup({ myLevel: "manage" });
    await frame.boot();
    const spy = vi.spyOn(frame.client, "invalidateQueries");
    frame.api.mockRejectedValue(new ApiError("x", "forbidden", 403));
    await frame.answerOf(await frame.request("comments.shareView", { user_id: "u2" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses without the capability (a level below manage): forbidden, no share request", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    frame.api.mockResolvedValue(SHARE);
    const answer = await frame.answerOf(await frame.request("comments.shareView", { user_id: "u2" }));
    expect(errorOf(answer)).toMatchObject({ code: "forbidden" });
    expect(frame.api.mock.calls.some(([path]) => path === SHARES_PATH)).toBe(false);
  });

  it.each([
    [403, "forbidden", "forbidden"],
    [403, "break_glass_required", "forbidden"],
    [422, "principal_not_in_organization", "invalid_arg"],
    [409, "document_owned_by_work_product", "conflict"],
    [404, "not_found", "not_found"],
    [401, "unauthorized", "unauthorized"],
    [503, "unavailable", "internal"],
  ])("HTTP %i %s becomes %s", async (status, code, expected) => {
    const frame = setup({ myLevel: "manage" });
    await frame.boot();
    frame.api.mockRejectedValue(new ApiError("x", code, status));
    const answer = await frame.answerOf(await frame.request("comments.shareView", { user_id: "u2" }));
    expect(errorOf(answer)).toMatchObject({ code: expected, status });
    if (status === 403 || status === 409) expect(errorOf(answer)).toMatchObject({ details: { code } });
  });

  it("a malformed share answer is an internal error, never ok", async () => {
    const frame = setup({ myLevel: "manage" });
    await frame.boot();
    frame.api.mockResolvedValue({ nope: true });
    const answer = await frame.answerOf(await frame.request("comments.shareView", { user_id: "u2" }));
    expect(errorOf(answer)).toMatchObject({ code: "internal" });
  });

  it("passes include=no_access through to the mention candidates and hands can_view back untouched", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    const candidates = [{ user_id: "u2", display_name: "Bình", can_view: false }, { user_id: "u3", display_name: "Cường", can_view: true }];
    frame.api.mockResolvedValue({ candidates });
    const answer = await frame.answerOf(await frame.request("mentions.search", { q: "b", limit: 5, include: "no_access" }));
    expect(frame.api).toHaveBeenLastCalledWith("/api/v1/documents/doc-1/mention-candidates?q=b&limit=5&include=no_access", expect.objectContaining({}));
    expect(answer.payload).toEqual({ candidates });
  });

  it("hands mentions_without_access back untouched on create and on the list", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    const comment = { ...WIRE, mentions_without_access: [{ user_id: "u2", display_name: "Bình", can_share: true }, { user_id: "u9", can_share: false }] };
    frame.api.mockResolvedValue({ comment });
    const created = await frame.answerOf(await frame.request("comments.create", { kind: "discussion", body: "hi [@Bình](mention://member/u2)" }));
    expect(created.payload).toEqual({ comment });
    frame.api.mockResolvedValue({ comments: [comment], mentions: [], list_token: "lt1:cc", unchanged: false });
    const listed = await frame.answerOf(await frame.request("comments.list", {}));
    expect(listed.payload).toMatchObject({ comments: [comment] });
  });

  it.each(["comments.list", "comments.create", "comments.resolve", "mentions.search", "comments.shareView"] as const)(
    "403 document_restricted on %s is the frame's forbidden path, with the server code kept",
    async (type) => {
      const frame = setup({ myLevel: "manage" });
      await frame.boot();
      frame.api.mockRejectedValue(new ApiError("restricted", "document_restricted", 403));
      const payload = type === "comments.create" ? { kind: "discussion", body: "x" } : type === "mentions.search" ? { q: "" } : type === "comments.shareView" ? { user_id: "u2" } : type === "comments.resolve" ? { comment_id: "c1" } : {};
      const answer = await frame.answerOf(await frame.request(type, payload));
      expect(errorOf(answer)).toMatchObject({ code: "forbidden", status: 403, retryable: false, details: { code: "document_restricted" } });
    },
  );
});

describe("useFrameComments: a comment deep link (?comment=)", () => {
  const reveals = (frame: ReturnType<typeof setup>) => frame.sent("comments.reveal");

  it("sends comments.reveal after the frame is ready, once, and again when the link changes", async () => {
    const frame = setup({ myLevel: "edit", revealCommentId: "c1" });
    await frame.boot();
    await waitFor(() => expect(reveals(frame)).toHaveLength(1));
    expect(reveals(frame)[0]!.payload).toEqual({ comment_id: "c1" });
    await frame.respond(reveals(frame)[0]!, { revealed: true });
    frame.rerender({ myLevel: "edit", revealCommentId: "c1" });
    expect(reveals(frame)).toHaveLength(1);
    frame.rerender({ myLevel: "edit", revealCommentId: "c2" });
    await waitFor(() => expect(reveals(frame)).toHaveLength(2));
    expect(reveals(frame)[1]!.payload).toEqual({ comment_id: "c2" });
  });

  it("reveals again when the frame reloads (a new open of the document)", async () => {
    const frame = setup({ myLevel: "edit", revealCommentId: "c1" });
    await frame.boot("i-1");
    await waitFor(() => expect(reveals(frame)).toHaveLength(1));
    await frame.respond(reveals(frame)[0]!, { revealed: true });
    await frame.boot("i-2");
    await waitFor(() => expect(reveals(frame)).toHaveLength(2));
  });

  it("a frame without comments gets no reveal and the page keeps the link for its own panel", async () => {
    const frame = setup({ myLevel: "edit", revealCommentId: "c1", frameComments: false });
    await frame.boot();
    await act(async () => { await Promise.resolve(); });
    expect(reveals(frame)).toEqual([]);
    expect(frame.hook.result.current.comments.framePanel).toBe(false);
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("no link, no reveal", async () => {
    const frame = setup({ myLevel: "edit" });
    await frame.boot();
    await act(async () => { await Promise.resolve(); });
    expect(reveals(frame)).toEqual([]);
  });
});

describe("useFrameComments: a frame without comments makes no request", () => {
  it("no comment request, no event, no reveal: init, nothing else", async () => {
    const frame = setup({ myLevel: "edit", revealCommentId: "c1", frameComments: false });
    await frame.boot();
    await publish(wsFrame("document.comment_added", { document_id: "doc-1", workspace_id: "ws-1" }));
    expect(frame.commentsRequests()).toEqual([]);
    expect(frame.received.filter((m) => m.type === "comments.changed" || m.type === "comments.reveal")).toEqual([]);
  });
});

// UNI-1986: the picture of a person reaches the frame as the same-origin avatar route, or as "".
describe("useFrameComments: frame avatars (UNI-1986)", () => {
  const DOC = "01M4KH88167D722JAC9EAPKN33";
  const USER = "01J8X4K2M0N1P2Q3R4S5T6V7W8";
  const AGENT = "01J8X4AGE0N1P2Q3R4S5T6V7W8";
  const ROUTE = `/api/v1/office-frame/documents/${DOC}/avatars/${USER}`;
  const PICTURE = "https://storage.example.test/avatars/an.png?X-Amz-Signature=abc";
  const AVATAR_BUILD = "0.1.0-51e1da4";
  const OLD_BUILD = "0.1.0-b1cbd5d";
  const wire = (over: Record<string, unknown> = {}) => ({
    ...WIRE, id: "c1", document_id: DOC, author_id: USER, author_kind: "human", display_name: "An", avatar_url: PICTURE,
    reactions: [], ...over,
  });
  const mention = { user_id: USER, display_name: "An", avatar_url: PICTURE, state: "ok" };

  it("the avatar build these tests use is the one frame-avatar-url.ts lists", () => {
    expect(AVATAR_ROUTE_FRAME_VERSIONS).toContain(AVATAR_BUILD);
    expect(AVATAR_ROUTE_FRAME_VERSIONS).not.toContain(OLD_BUILD);
  });

  const open = async (props: Props = {}) => {
    const frame = setup({ myLevel: "edit", documentId: DOC, frameVersion: AVATAR_BUILD, ...props });
    await frame.boot();
    return frame;
  };
  const payloadOf = async (frame: Awaited<ReturnType<typeof open>>, type: string, payload: unknown) =>
    (await frame.answerOf(await frame.request(type, payload))).payload as Record<string, any>;

  it("comments.list: a human author and a mention get the route, an agent and a picture-less author get \"\"", async () => {
    const frame = await open();
    const comments = [wire(), wire({ id: "c2", author_kind: "agent", author_id: AGENT }), wire({ id: "c3", avatar_url: "" })];
    frame.api.mockResolvedValue({ comments, mentions: [mention, { user_id: USER, state: "unavailable" }], list_token: "lt1:aa", unchanged: false });
    const out = await payloadOf(frame, "comments.list", {});
    expect(out.comments.map((c: { avatar_url: string }) => c.avatar_url)).toEqual([ROUTE, "", ""]);
    expect(out.mentions[0]).toEqual({ ...mention, avatar_url: ROUTE });
    expect(out.mentions[1]).toEqual({ user_id: USER, state: "unavailable" });
    // No other field of a comment moves.
    expect({ ...out.comments[0], avatar_url: PICTURE }).toEqual(comments[0]);
    expect(out.list_token).toBe("lt1:aa");
  });

  it("comments.list `unchanged` stays the token alone", async () => {
    const frame = await open();
    frame.api.mockResolvedValue({ comments: [], mentions: [], list_token: "lt1:aa", unchanged: true });
    expect(await payloadOf(frame, "comments.list", { since_token: "lt1:aa" })).toEqual({ comments: [], mentions: [], list_token: "lt1:aa", unchanged: true });
  });

  it.each([
    ["comments.create", { kind: "discussion", body: "x" }],
    ["comments.update", { comment_id: "c1", body: "x" }],
    ["comments.resolve", { comment_id: "c1" }],
    ["comments.reopen", { comment_id: "c1" }],
  ] as const)("%s answers the comment with the route and every other key as the server sent it", async (type, payload) => {
    const frame = await open();
    const answer = { comment: wire({ body: "x", resolved_at: null, mentions_without_access: [{ user_id: "u2", can_share: true }] }) };
    frame.api.mockResolvedValue(answer);
    const out = await payloadOf(frame, type, payload);
    expect(out.comment.avatar_url).toBe(ROUTE);
    expect(out).toEqual({ ...answer, comment: { ...answer.comment, avatar_url: ROUTE } });
  });

  it("mentions.search candidates get the route (a person with a picture) or \"\"; can_view and email stay", async () => {
    const frame = await open();
    const candidates = [
      { user_id: USER, display_name: "An", avatar_url: PICTURE, can_view: false, email: "an@example.test" },
      { user_id: "01J8X4K2M0BBBBBBBBBBBBBBBB", display_name: "Bình", avatar_url: "" },
      { user_id: "01J8X4K2M0CCCCCCCCCCCCCCCC", display_name: "Cường" },
    ];
    frame.api.mockResolvedValue({ candidates });
    const out = await payloadOf(frame, "mentions.search", { q: "", include: "no_access" });
    expect(out.candidates).toEqual([{ ...candidates[0], avatar_url: ROUTE }, candidates[1], candidates[2]]);
  });

  it("revisions, anchors and delete answers are not touched", async () => {
    const frame = await open();
    const revisions = { revisions: [{ id: "r1", revision: 1, body: "x", created_by_id: USER, created_by_kind: "human", created_at: "t", avatar_url: PICTURE }] };
    frame.api.mockResolvedValue(revisions);
    expect(await payloadOf(frame, "comments.revisions", { comment_id: "c1" })).toEqual(revisions);
  });

  it("a frame build that does not know the route gets \"\" everywhere and no absolute URL", async () => {
    const frame = await open({ frameVersion: OLD_BUILD });
    frame.api.mockResolvedValue({ comments: [wire()], mentions: [mention], list_token: "lt1:aa", unchanged: false });
    const listed = await payloadOf(frame, "comments.list", {});
    expect(listed.comments[0].avatar_url).toBe("");
    expect(listed.mentions[0].avatar_url).toBe("");
    frame.api.mockResolvedValue({ comment: wire() });
    expect((await payloadOf(frame, "comments.create", { kind: "discussion", body: "x" })).comment.avatar_url).toBe("");
    frame.api.mockResolvedValue({ candidates: [{ user_id: USER, display_name: "An", avatar_url: PICTURE }] });
    expect((await payloadOf(frame, "mentions.search", { q: "" })).candidates[0].avatar_url).toBe("");
    expect(JSON.stringify(frame.received.filter((m) => m.kind === "response"))).not.toContain("https://storage.example.test");
  });

  it("a page with no pinned frame version (not installed) sends \"\"", async () => {
    const frame = await open({ frameVersion: "" });
    frame.api.mockResolvedValue({ comment: wire() });
    expect((await payloadOf(frame, "comments.create", { kind: "discussion", body: "x" })).comment.avatar_url).toBe("");
  });
});
