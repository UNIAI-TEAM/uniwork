import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type WSMessage } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { PROTOCOL_NS, PROTOCOL_VERSION, checkInitComments, type Envelope, type InitPayload, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import type { User } from "@uniwork/core/types";
import { requestMock } from "../../test/api-mock";
import { useDocsFrameSession } from "./use-docs-frame-session";
import { useFrameComments } from "./use-frame-comments";

// One fake workspace socket for every test: the hook subscribes with onAny.
const socket = new Set<(message: WSMessage) => void>();
const fakeClient = {
  onAny: (handler: (message: WSMessage) => void) => {
    socket.add(handler);
    return () => { socket.delete(handler); };
  },
};
vi.mock("@uniwork/core/realtime", () => ({ useOptionalWS: () => ({ client: fakeClient }) }));
// The draft key needs IndexedDB; this file is about comments.
vi.mock("@uniwork/core/office/draft-session-key", () => ({
  getOfficeDraftKey: vi.fn(async () => ({}) as CryptoKey),
  officeDraftScope: (user: string, doc: string) => `${user}/${doc}`,
}));

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const COMMENTS_PATH = "/api/v1/documents/doc-1/comments";
const ME = "01J8X4USR0AAAAAAAAAAAAAAAA";
const WIRE = { id: "c1", document_id: "doc-1", kind: "comment", body: "x", anchor: null, anchor_state: null, deleted_at: null };
const minted = (canEdit = true) => ({
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: canEdit, module: "docs",
});

interface Props { myLevel?: string | null; revealCommentId?: string | null }

/** The editor frame on the other side of the wire: records what the host posts, answers `init`, posts requests. */
function setup({ module = "docs" as OfficeModule, canEdit = true, readonly = false, frameComments = true, ...initial }: Props & { module?: OfficeModule; canEdit?: boolean; readonly?: boolean; frameComments?: boolean } = {}) {
  const api = vi.fn<(path: string, opts?: { method?: string; headers?: Record<string, string> }) => Promise<unknown>>((path, opts) => {
    if (path === MINT_PATH) return Promise.resolve({ ...minted(canEdit), module });
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
  const hook = renderHook((props: Props) => {
    const comments = useFrameComments({ wsId: "ws-1", ...props });
    const session = useDocsFrameSession({
      iframeRef, frameOrigin: window.location.origin, module, wsId: "ws-1", documentId: "doc-1",
      readonly, locale: "vi", theme: "light", onError, comments: comments.binding,
      api: { open: vi.fn(), save: vi.fn(), recents: vi.fn() } as unknown as DocsFrameApi,
    });
    return { comments, session };
  }, { wrapper, initialProps: initial as Props });
  const sent = (type: string) => received.filter((m) => m.kind === "request" && m.type === type);
  const frame = {
    hook, received, sent, onError, api,
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
    ["edit", { myLevel: "edit" }, "edit"],
    ["manage", { myLevel: "manage" }, "manage"],
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

  it("a frame that predates comments (its ack has none): the page keeps its own panel", async () => {
    const frame = setup({ myLevel: "edit", frameComments: false });
    await frame.boot();
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
    const calls = (): Array<[string, string]> => frame.api.mock.calls
      .filter(([path]) => String(path) !== MINT_PATH)
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
