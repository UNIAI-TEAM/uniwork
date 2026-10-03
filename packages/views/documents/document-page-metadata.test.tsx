import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { useDocument } from "@uniwork/core/documents/hooks";
import { initI18n } from "@uniwork/core/i18n";
import type { Document } from "@uniwork/core/types/document";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentWorkspace } from "./document-workspace";

const { t } = initI18n();
const doc: Document = {
  id: "d1", workspace_id: "ws1", organization_id: "o1", kind: "page", title: "Original",
  revision: "3", visibility: "workspace", my_level: "edit", content_text: "", current_version: 1,
  content: { type: "doc", content: [{ type: "paragraph" }] }, position: 0, breadcrumbs: [],
  created_by: "", created_by_kind: "human", updated_by: "", updated_by_kind: "human",
  created_at: "", updated_at: "",
};
type Options = { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> };
const patches = () => requestMock.mock.calls.filter(([, options]) => (options as Options)?.method === "PATCH");

function ReactiveWorkspace() {
  const query = useDocument("ws1", "d1");
  return query.data ? <DocumentWorkspace wsId="ws1" doc={query.data} libraryHref="/acme/doi/documents" refetch={query.refetch} /> : null;
}

function mountWorkspace() {
  const push = vi.fn();
  const adapter: NavigationAdapter = {
    push, replace: vi.fn(), back: vi.fn(), pathname: "/acme/doi/documents/d1",
    searchParams: new URLSearchParams(), getShareableUrl: (path) => path,
  };
  return { push, ...render(wrap(<NavigationProvider value={adapter}><ReactiveWorkspace /></NavigationProvider>)) };
}

const findBody = () => screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
const findTitle = async () => {
  await findBody();
  return screen.findByRole("textbox", { name: t("documents.page_ui.title_label") });
};
function pasteText(surface: HTMLElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [], getData: (type: string) => type === "text/plain" ? text : "" },
  });
  fireEvent(surface, event);
}
const back = () => fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
const saveAndLeave = () => fireEvent.click(screen.getByRole("button", { name: t("documents.leave.save_and_leave") }));

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, options?: Options) => {
    if (options?.method === "PATCH") return Promise.resolve({ document: { ...doc, ...options.body, revision: "4" } });
    if (path === "/api/v1/documents/d1") return Promise.resolve({ document: doc });
    return Promise.resolve(path.endsWith("/members") ? { members: [] } : { comments: [] });
  });
});
afterEach(() => vi.useRealTimers());

describe("page metadata lifecycle", () => {
  it("retries the dirty body before failed metadata when both writes fail", async () => {
    let saved = doc;
    let rejectTitle!: (error: unknown) => void;
    let acknowledgeBody!: () => void;
    let acknowledgeTitle!: () => void;
    requestMock.mockImplementation((path: string, options?: Options) => {
      if (options?.method === "PATCH") {
        if (patches().length === 1) return new Promise((_, reject) => { rejectTitle = reject; });
        if (patches().length === 2) return Promise.reject(new ApiError("body failure", "internal", 500));
        return new Promise((done) => {
          const commit = () => {
            saved = { ...saved, ...options.body, revision: options.body?.content ? "4" : "5" } as Document;
            done({ document: saved });
          };
          if (options.body?.content) acknowledgeBody = commit;
          else acknowledgeTitle = commit;
        });
      }
      return Promise.resolve(path === "/api/v1/documents/d1" ? { document: saved } : {});
    });
    const { push } = mountWorkspace();
    const title = await findTitle();
    const body = await findBody();
    fireEvent.change(title, { target: { value: "Retry both writes" } });
    fireEvent.blur(title);
    await waitFor(() => expect(patches()).toHaveLength(1));
    pasteText(body, "Body after both failures");
    await act(async () => rejectTitle(new ApiError("title failure", "internal", 500)));
    await waitFor(() => expect(patches()).toHaveLength(2), { timeout: 8_000 });
    fireEvent.click(await screen.findByRole("button", { name: t("documents.save.retry") }));
    await waitFor(() => expect(patches()).toHaveLength(3));
    const failedBody = patches()[1]?.[1] as Options;
    const replay = patches()[2]?.[1] as Options;
    expect(replay.body).toEqual(failedBody.body);
    expect(replay.headers?.["Idempotency-Key"]).toBeTruthy();
    expect(replay.headers?.["Idempotency-Key"]).toBe(failedBody.headers?.["Idempotency-Key"]);
    expect(replay.body?.revision).toBe("3");
    expect(body).toHaveTextContent("Body after both failures");
    expect(title).toHaveValue("Retry both writes");
    expect(push).not.toHaveBeenCalled();
    await act(async () => acknowledgeBody());
    fireEvent.click(await screen.findByRole("button", { name: t("documents.save.retry") }));
    await waitFor(() => expect(patches()).toHaveLength(4));
    expect(patches()[3]?.[1]).toMatchObject({ body: { revision: "4", title: "Retry both writes" } });
    await act(async () => acknowledgeTitle());
    expect(saved.title).toBe("Retry both writes");
    expect(JSON.stringify(saved.content)).toContain("Body after both failures");
    await waitFor(() => {
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("preserves immediate body input during a title flight and awaits both saves before leaving", async () => {
    let acknowledgeTitle: ((value: unknown) => void) | undefined;
    let acknowledgeBody: ((value: unknown) => void) | undefined;
    let saved = doc;
    requestMock.mockImplementation((path: string, options?: Options) => {
      if (options?.method === "PATCH") return new Promise((done) => {
        if (options.body?.title) acknowledgeTitle = done;
        else acknowledgeBody = done;
      });
      return Promise.resolve(path === "/api/v1/documents/d1" ? { document: saved } : {});
    });
    const { push } = mountWorkspace();
    const title = await findTitle();
    const body = await findBody();
    fireEvent.change(title, { target: { value: "Title before typing" } });
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(() => expect(patches()).toHaveLength(1));
    await waitFor(() => expect(body).toHaveFocus());
    expect(body).toHaveAttribute("contenteditable", "true");
    pasteText(body, "First body words");
    expect(body).toHaveTextContent("First body words");
    back();
    saveAndLeave();
    expect(push).not.toHaveBeenCalled();
    expect(patches()).toHaveLength(1);
    saved = { ...saved, title: "Title before typing", revision: "4" };
    await act(async () => acknowledgeTitle?.({ document: saved }));
    await waitFor(() => expect(patches()).toHaveLength(2), { timeout: 8_000 });
    expect(patches()[1]?.[1]).toMatchObject({ body: { revision: "4", content: { type: "doc" } } });
    const content = (patches()[1]?.[1] as Options).body?.content;
    expect(JSON.stringify(content)).toContain("First body words");
    expect(body).toHaveTextContent("First body words");
    expect(title).toHaveValue("Title before typing");
    expect(push).not.toHaveBeenCalled();
    await act(async () => acknowledgeBody?.({ document: { ...saved, content, revision: "5" } }));
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(patches()).toHaveLength(2);
  });

  it("warns before unloading a title-only edit and clears the warning when reverted", async () => {
    mountWorkspace();
    const title = await findTitle();
    fireEvent.change(title, { target: { value: "Pending title" } });
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    expect(patches()).toHaveLength(0);
    fireEvent.change(title, { target: { value: "Original" } });
    const reverted = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(reverted);
    expect(reverted.defaultPrevented).toBe(false);
  });

  it("saves the newest queued body before a later title on their acknowledged revisions", async () => {
    let acknowledgeTitle: ((value: unknown) => void) | undefined;
    let acknowledgeBody: ((value: unknown) => void) | undefined;
    let saved = doc;
    requestMock.mockImplementation((path: string, options?: Options) => {
      if (options?.method === "PATCH") {
        if (patches().length === 1) return new Promise((done) => { acknowledgeTitle = done; });
        if (options.body?.content) return new Promise((done) => { acknowledgeBody = done; });
        saved = { ...saved, ...options.body, revision: "6" } as Document;
        return Promise.resolve({ document: saved });
      }
      return Promise.resolve(path === "/api/v1/documents/d1" ? { document: saved } : {});
    });
    mountWorkspace();
    const title = await findTitle();
    const body = await findBody();
    fireEvent.change(title, { target: { value: "First title" } });
    fireEvent.blur(title);
    await waitFor(() => expect(patches()).toHaveLength(1));
    pasteText(body, "First words ");
    fireEvent.change(title, { target: { value: "Final title" } });
    fireEvent.blur(title);
    pasteText(body, "latest words");
    saved = { ...saved, title: "First title", revision: "4" };
    await act(async () => acknowledgeTitle?.({ document: saved }));
    await waitFor(() => expect(patches()).toHaveLength(2), { timeout: 8_000 });
    expect(patches()[1]?.[1]).toMatchObject({ body: { revision: "4", content: { type: "doc" } } });
    const content = (patches()[1]?.[1] as Options).body?.content;
    expect(JSON.stringify(content)).toContain("latest words");
    saved = { ...saved, content, revision: "5" } as Document;
    await act(async () => acknowledgeBody?.({ document: saved }));
    await waitFor(() => expect(patches()).toHaveLength(3));
    expect(patches()[2]?.[1]).toMatchObject({ body: { revision: "5", title: "Final title" } });
    expect(body).toHaveTextContent("latest words");
    expect(title).toHaveValue("Final title");
    await waitFor(() => {
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
    });
  });

  it("keeps a failed title for explicit retry after queued body content saves", async () => {
    let rejectTitle: ((error: unknown) => void) | undefined;
    let saved = doc;
    requestMock.mockImplementation((path: string, options?: Options) => {
      if (options?.method === "PATCH") {
        if (patches().length === 1) return new Promise((_, reject) => { rejectTitle = reject; });
        saved = { ...saved, ...options.body, revision: options.body?.content ? "4" : "5" } as Document;
        return Promise.resolve({ document: saved });
      }
      return Promise.resolve(path === "/api/v1/documents/d1" ? { document: saved } : {});
    });
    const { push } = mountWorkspace();
    const title = await findTitle();
    const body = await findBody();
    fireEvent.change(title, { target: { value: "Retry after body" } });
    fireEvent.blur(title);
    await waitFor(() => expect(patches()).toHaveLength(1));
    pasteText(body, "Body survives title failure");
    await act(async () => rejectTitle?.(new ApiError("failed", "internal", 500)));
    await waitFor(() => expect(patches()).toHaveLength(2), { timeout: 8_000 });
    await screen.findByRole("button", { name: t("documents.save.retry") });
    expect(patches()[1]?.[1]).toMatchObject({ body: { revision: "3", content: { type: "doc" } } });
    expect(body).toHaveTextContent("Body survives title failure");
    expect(title).toHaveValue("Retry after body");
    back();
    saveAndLeave();
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(patches()).toHaveLength(3);
    expect(patches()[2]?.[1]).toMatchObject({ body: { revision: "4", title: "Retry after body" } });
  });

  it("waits for the title PATCH acknowledgement before Save and leave permits navigation", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    requestMock.mockImplementation((path: string, options?: Options) => {
      if (options?.method === "PATCH") return new Promise((done) => { resolve = done; });
      return Promise.resolve(path === "/api/v1/documents/d1" ? { document: doc } : {});
    });
    const { push } = mountWorkspace();
    fireEvent.change(await findTitle(), { target: { value: "Title to preserve" } });
    back();
    expect(screen.getByRole("dialog", { name: t("documents.leave.title") })).toBeInTheDocument();
    saveAndLeave();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(push).not.toHaveBeenCalled();
    await act(async () => resolve?.({ document: { ...doc, title: "Title to preserve", revision: "4" } }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/acme/doi/documents"));
    expect(patches()).toHaveLength(1);
  });

  it("discards an unsent title deliberately rather than persisting it on cleanup", async () => {
    const { push, unmount } = mountWorkspace();
    const title = await findTitle();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.change(title, { target: { value: "Discard this title" } });
    back();
    fireEvent.click(screen.getByRole("button", { name: t("documents.leave.discard") }));
    await act(async () => { await Promise.resolve(); });
    expect(push).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(patches()).toHaveLength(0);
  });

  it("uses the latest acknowledged revision when a second title is typed during a PATCH", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    let saved = doc;
    requestMock.mockImplementation((path: string, options?: Options) => {
      if (options?.method === "PATCH") {
        if (patches().length === 1) return new Promise((done) => { resolve = done; });
        saved = { ...saved, ...options.body, revision: "5" } as Document;
        return Promise.resolve({ document: saved });
      }
      return Promise.resolve(path === "/api/v1/documents/d1" ? { document: saved } : {});
    });
    mountWorkspace();
    const title = await findTitle();
    fireEvent.change(title, { target: { value: "First in flight" } });
    fireEvent.blur(title);
    await waitFor(() => expect(patches()).toHaveLength(1));
    fireEvent.change(title, { target: { value: "Second while pending" } });
    fireEvent.blur(title);
    saved = { ...saved, title: "First in flight", revision: "4" };
    await act(async () => resolve?.({ document: saved }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]?.[1]).toMatchObject({ body: { revision: "4", title: "Second while pending" } });
    expect(title).toHaveValue("Second while pending");
  });

  it("keeps failed metadata inside the leave dialog and allows an explicit retry", async () => {
    const { push } = mountWorkspace();
    fireEvent.change(await findTitle(), { target: { value: "Retry this title" } });
    requestMock.mockRejectedValue(new ApiError("failed", "internal", 500));
    back();
    saveAndLeave();
    await waitFor(() => expect(screen.getByRole("button", { name: t("documents.leave.save_and_leave") })).toBeEnabled());
    expect(patches()).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    requestMock.mockResolvedValue({ document: { ...doc, title: "Retry this title", revision: "4" } });
    saveAndLeave();
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(patches()).toHaveLength(2);
  });
});
