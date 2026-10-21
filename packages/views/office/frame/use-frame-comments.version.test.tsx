import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import type { InitAck, InitPayload } from "@uniwork/core/office/docs-frame-protocol";
import { requestMock } from "../../test/api-mock";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { useFrameComments } from "./use-frame-comments";

// UNI-2033: the Inbox landing (?comment= on a lost comment switches to ?version=N once per open)
// and the host's answer to the frame's comments.viewVersion.

vi.mock("@uniwork/core/realtime", () => ({ useOptionalWS: () => null }));

const PATH = "/o/w/documents/doc-1";
const ACK = { capabilities: { comments: true } } as unknown as InitAck;
const SIGNAL = { signal: new AbortController().signal };

function setup(props: { revealCommentId?: string | null; viewVersion?: number; landOnLost?: boolean; openVersion?: number } = {}) {
  const navigation = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: PATH, searchParams: new URLSearchParams(),
    getShareableUrl: (path: string) => path,
  } as unknown as NavigationAdapter;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><NavigationProvider value={navigation}>{children}</NavigationProvider></QueryClientProvider>
  );
  const hook = renderHook(() => useFrameComments({ wsId: "ws-1", frameVersion: "", documentId: "doc-1", ...props }), { wrapper });
  const attach = () => act(() => { hook.result.current.binding.attach({ revealComment: vi.fn(async () => ({ revealed: true })) } as unknown as DocsFrameHost, ACK, () => "doc-1"); });
  const commentsList = hook.result.current.binding.api["comments.list"];
  const list = (comments: Record<string, unknown>[]) => {
    requestMock.mockResolvedValueOnce({ comments: comments.map((c) => ({ document_id: "doc-1", kind: "comment", body: "x", ...c })), mentions: [], list_token: "lt1:aa", unchanged: false });
    return commentsList?.({}, SIGNAL);
  };
  return { navigation, hook, attach, list };
}

const lost = (over: Record<string, unknown> = {}) => ({ id: "c1", anchor_state: "lost", anchor_version_id: "v2", anchor_version_no: 2, ...over });

afterEach(() => { requestMock.mockReset(); vi.restoreAllMocks(); });

describe("useFrameComments: Inbox landing on a lost comment (UNI-2033)", () => {
  it("replaces ?comment= with ?version=N&comment= once per open when the first list shows it lost", async () => {
    const frame = setup({ revealCommentId: "c1" });
    frame.attach();
    await frame.list([lost()]);
    expect(frame.navigation.replace).toHaveBeenCalledTimes(1);
    expect(frame.navigation.replace).toHaveBeenCalledWith(`${PATH}?version=2&comment=c1`);
    // A later list of the same open never switches again.
    await frame.list([lost()]);
    expect(frame.navigation.replace).toHaveBeenCalledTimes(1);
    expect(frame.navigation.push).not.toHaveBeenCalled();
  });

  it("does not switch again once the page has left the version view and is back on ?comment= (landOnLost off)", async () => {
    const frame = setup({ revealCommentId: "c1" });
    frame.attach();
    await frame.list([lost()]);
    expect(frame.navigation.replace).toHaveBeenCalledTimes(1);
    // "Về bản hiện tại" remounts the frame: a fresh hook on head, the host now says the landing is spent.
    const back = setup({ revealCommentId: "c1", landOnLost: false });
    back.attach();
    await back.list([lost()]);
    expect(back.navigation.replace).not.toHaveBeenCalled();
  });

  it("does not land when the lost comment's version is the open one", async () => {
    const frame = setup({ revealCommentId: "c1", openVersion: 2 });
    frame.attach();
    await frame.list([lost({ anchor_version_no: 2 })]);
    expect(frame.navigation.replace).not.toHaveBeenCalled();
    const older = setup({ revealCommentId: "c1", openVersion: 3 });
    older.attach();
    await older.list([lost({ anchor_version_no: 2 })]);
    expect(older.navigation.replace).toHaveBeenCalledWith(`${PATH}?version=2&comment=c1`);
  });

  it("does nothing when a version is already open, there is no link, or the data is missing", async () => {
    const inVersion = setup({ revealCommentId: "c1", viewVersion: 2 });
    inVersion.attach();
    await inVersion.list([lost()]);
    const noLink = setup({ revealCommentId: null });
    noLink.attach();
    await noLink.list([lost()]);
    const notLost = setup({ revealCommentId: "c1" });
    notLost.attach();
    await notLost.list([lost({ anchor_state: "stale" })]);
    const noNumber = setup({ revealCommentId: "c1" });
    noNumber.attach();
    await noNumber.list([lost({ anchor_version_no: null })]);
    const otherComment = setup({ revealCommentId: "c9" });
    otherComment.attach();
    await otherComment.list([lost()]);
    for (const frame of [inVersion, noLink, notLost, noNumber, otherComment]) {
      expect(frame.navigation.replace).not.toHaveBeenCalled();
    }
  });

  it("only the first list of an open decides: a later list that turns lost does not switch", async () => {
    const frame = setup({ revealCommentId: "c1" });
    frame.attach();
    await frame.list([lost({ anchor_state: "exact" })]);
    await frame.list([lost()]);
    expect(frame.navigation.replace).not.toHaveBeenCalled();
  });
});

describe("useFrameComments: the landing waits for the list that carries the comment (UNI-2033)", () => {
  // The docs frame asks for two kinds (the anchored "comment" panel and "discussion"); the first answer of an open
  // can be a list that does not hold the linked comment, which must not spend the landing.
  it("skips a first list that does not name the comment, then lands on the one that does", async () => {
    const frame = setup({ revealCommentId: "c1" });
    frame.attach();
    await frame.list([{ id: "d1", kind: "discussion" }]);
    expect(frame.navigation.replace).not.toHaveBeenCalled();
    await frame.list([lost()]);
    expect(frame.navigation.replace).toHaveBeenCalledTimes(1);
    expect(frame.navigation.replace).toHaveBeenCalledWith(`${PATH}?version=2&comment=c1`);
    await frame.list([lost()]);
    expect(frame.navigation.replace).toHaveBeenCalledTimes(1);
  });

  it("skips an unchanged first answer too", async () => {
    const frame = setup({ revealCommentId: "c1" });
    frame.attach();
    requestMock.mockResolvedValueOnce({ unchanged: true, list_token: "lt1:aa" });
    await frame.hook.result.current.binding.api["comments.list"]?.({ since_token: "lt1:aa" }, SIGNAL);
    expect(frame.navigation.replace).not.toHaveBeenCalled();
    await frame.list([lost()]);
    expect(frame.navigation.replace).toHaveBeenCalledWith(`${PATH}?version=2&comment=c1`);
  });
});

describe("useFrameComments: comments.viewVersion (UNI-2033)", () => {
  it("pushes the version URL with the comment and answers opened", () => {
    const frame = setup();
    const viewVersion = frame.hook.result.current.binding.api["comments.viewVersion"];
    expect(viewVersion?.({ comment_id: "c2", version_no: 4 }, SIGNAL)).toEqual({ opened: true });
    expect(frame.navigation.push).toHaveBeenCalledWith(`${PATH}?version=4&comment=c2`);
  });

  it("is never granted inside a version view", () => {
    const init = { documentId: "doc-1", token: "t", capabilities: {} } as unknown as InitPayload;
    const grant = (hook: ReturnType<typeof setup>["hook"]) =>
      hook.result.current.binding.augmentInit(init, { canEdit: true, readonly: false }).capabilities["commentsViewVersion"];
    expect(grant(setup().hook)).toBe(true);
    expect(grant(setup({ viewVersion: 2 }).hook)).toBeUndefined();
  });
});
