import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import type { Document } from "@uniwork/core/types/document";
import { requestMock } from "../../test/api-mock";
import { hasUntitledVersionOneFile, useFirstSaveNaming, type FirstSaveNaming } from "./first-save-naming";

const UNTITLED_DOC = {
  id: "doc-1", organization_id: "org-1", workspace_id: "ws-1", parent_id: "folder-mine",
  kind: "file", title: "Tài liệu chưa đặt tên.docx", revision: "4", current_version: 1,
  file: {
    file_id: "f-1", version_id: "v-1", version: 1, filename: "untitled.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: 12, checksum_sha256: "abc",
  },
} as unknown as Document;

interface MockInit { method?: string; body?: unknown }

/** The PATCH request that renamed the document, as the mocked transport saw it. */
function patchCall(path: string) {
  const calls = requestMock.mock.calls as [string, MockInit | undefined][];
  return calls.find(([p, init]) => p === path && init?.method === "PATCH");
}

/** The PATCH body (JSON on the wire; the mock sees the decoded body either way). */
function patchJson(call: [string, MockInit | undefined] | undefined) {
  const body = call?.[1]?.body;
  return (typeof body === "string" ? JSON.parse(body) : body) as { revision?: string; title?: string };
}

function docWith(file: Partial<NonNullable<Document["file"]>> | null | undefined): Pick<Document, "file"> {
  if (file === undefined) return { file: undefined };
  if (file === null) return { file: null };
  return { file: { ...UNTITLED_DOC.file!, ...file } as NonNullable<Document["file"]> };
}

function setup({ doc = UNTITLED_DOC, module = "docs", onNamed }: { doc?: Document; module?: string; onNamed?: (file: { fileId: string; name: string }) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The dialog element is rebuilt on every hook render: it must be rendered inside the
  // hook's own tree (a captured element keeps its first `open=false` forever).
  const current = { naming: null as null | FirstSaveNaming };
  const holder = { doc };
  function Harness() {
    current.naming = useFirstSaveNaming({ document: holder.doc, module: module as never, wsId: "ws-1", onNamed });
    return current.naming.dialog;
  }
  const tree = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  const view = render(tree());
  const hook = { result: { get current() { return current.naming!; } } };
  /** The page now shows another document (same mounted hook). */
  const switchTo = (next: Document) => { holder.doc = next; view.rerender(tree()); };
  return { hook, view, client, switchTo };
}

afterEach(() => { vi.restoreAllMocks(); requestMock.mockReset(); });

describe("hasUntitledVersionOneFile (UNI-1847 D1)", () => {
  it("is true only for a stored file still named untitled.<office ext> at version 1", () => {
    for (const ext of ["docx", "xlsx", "pptx", "pdf", "md", "html", "DOCX"]) {
      expect(hasUntitledVersionOneFile(docWith({ filename: `untitled.${ext}`, version: 1 })), ext).toBe(true);
    }
    expect(hasUntitledVersionOneFile(docWith({ filename: "untitled.docx", version: 2 }))).toBe(false);
    expect(hasUntitledVersionOneFile(docWith({ filename: "Plan.docx", version: 1 }))).toBe(false);
    expect(hasUntitledVersionOneFile(docWith({ filename: "untitled.txt", version: 1 }))).toBe(false);
    expect(hasUntitledVersionOneFile(docWith({ filename: "my.untitled.docx", version: 1 }))).toBe(false);
    expect(hasUntitledVersionOneFile(docWith(null))).toBe(false);
    expect(hasUntitledVersionOneFile(docWith(undefined))).toBe(false);
  });
});

describe("useFirstSaveNaming: the first-save name dialog (UNI-1847)", () => {
  it("needs a name while the blank is unnamed and stops once it was named this session", async () => {
    const { hook } = setup();
    expect(hook.result.current.needsName()).toBe(true);
    let answer!: Promise<boolean>;
    await act(async () => { answer = hook.result.current.ask(); });
    const dialog = await screen.findByRole("dialog", { name: "Đặt tên tài liệu" });
    expect(dialog).toBeTruthy();
    expect(hook.result.current.needsName()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Cancel names nothing: the next save asks again.
    expect(hook.result.current.needsName()).toBe(true);
  });

  it("asks again for another never-saved blank after the first one was named (document switch)", async () => {
    requestMock.mockImplementation((path: string, init?: MockInit) => {
      if (path === "/api/v1/documents/doc-1" && init?.method === "PATCH") {
        return Promise.resolve({ document: { ...UNTITLED_DOC, title: "Kế hoạch Q4", revision: "5" } });
      }
      if (path === "/api/v1/documents/doc-1") return Promise.resolve({ document: UNTITLED_DOC });
      return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${path}`));
    });
    const { hook, switchTo } = setup();
    await act(async () => { void hook.result.current.ask(); });
    const input = (await screen.findByLabelText("Tên tài liệu")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Kế hoạch Q4" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(hook.result.current.needsName()).toBe(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    switchTo({ ...UNTITLED_DOC, id: "doc-2" } as Document);
    expect(hook.result.current.needsName()).toBe(true);
  });

  it("prefills the document title, PATCHes it on save, then reports the new file name", async () => {
    const named = vi.fn();
    requestMock.mockImplementation((path: string, init?: MockInit) => {
      if (path === "/api/v1/documents/doc-1" && init?.method === "PATCH") {
        return Promise.resolve({ document: { ...UNTITLED_DOC, title: "Kế hoạch Q4", revision: "5" } });
      }
      if (path === "/api/v1/documents/doc-1") return Promise.resolve({ document: UNTITLED_DOC });
      return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${path}`));
    });
    const { hook } = setup({ onNamed: named });
    let answer!: Promise<boolean>;
    await act(async () => { answer = hook.result.current.ask(); });
    const input = (await screen.findByLabelText("Tên tài liệu")) as HTMLInputElement;
    expect(input.value).toBe("Tài liệu chưa đặt tên");
    fireEvent.change(input, { target: { value: "Kế hoạch Q4" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = patchCall("/api/v1/documents/doc-1");
    expect(patch).toBeTruthy();
    expect(patchJson(patch)).toMatchObject({ revision: "4", title: "Kế hoạch Q4" });
    // The frame hears the stored file name: title + the module extension.
    expect(named).toHaveBeenCalledWith({ fileId: "doc-1", name: "Kế hoạch Q4.docx" });
    // Named once this session: saves from here on never ask again.
    expect(hook.result.current.needsName()).toBe(false);
  });

  it("prefills the title without its file extension and opens with the name selected", async () => {
    const { hook } = setup();
    let answer!: Promise<boolean>;
    await act(async () => { answer = hook.result.current.ask(); });
    const input = (await screen.findByLabelText("Tên tài liệu")) as HTMLInputElement;
    // The stored title still carries ".docx", the saved name does not.
    expect(input.value).toBe("Tài liệu chưa đặt tên");
    // Typing replaces the proposal: the whole field is selected on open.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await expect(answer).resolves.toBe(false);
  });

  it("prefills a title without the document's extension untouched (a different suffix stays)", async () => {
    const titled = { ...UNTITLED_DOC, title: "Báo cáo.txt" } as Document;
    const { hook } = setup({ doc: titled });
    await act(async () => { void hook.result.current.ask(); });
    expect(((await screen.findByLabelText("Tên tài liệu")) as HTMLInputElement).value).toBe("Báo cáo.txt");
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
  });

  it("keeps an unchanged name and rejects empty or over-long names inside the dialog", async () => {
    requestMock.mockImplementation((path: string, init?: MockInit) => {
      if (path === "/api/v1/documents/doc-1" && init?.method === "PATCH") {
        return Promise.resolve({ document: { ...UNTITLED_DOC, revision: "5" } });
      }
      if (path === "/api/v1/documents/doc-1") return Promise.resolve({ document: UNTITLED_DOC });
      return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${path}`));
    });
    const { hook } = setup();
    let answer!: Promise<boolean>;
    await act(async () => { answer = hook.result.current.ask(); });
    const input = (await screen.findByLabelText("Tên tài liệu")) as HTMLInputElement;
    // Empty stays in the dialog with the field error; nothing is written.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nhập tên tài liệu.");
    // 501 characters is one over the document limit.
    fireEvent.change(input, { target: { value: "x".repeat(501) } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tên tài liệu tối đa 500 ký tự.");
    expect(patchCall("/api/v1/documents/doc-1")).toBeUndefined();
    // The prefilled name untouched is a valid submit.
    fireEvent.change(input, { target: { value: "Tài liệu chưa đặt tên.docx" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    expect(patchJson(patchCall("/api/v1/documents/doc-1"))).toMatchObject({ title: "Tài liệu chưa đặt tên.docx" });
  });

  it("answers one dialog for every ask while it is open", async () => {
    requestMock.mockImplementation((path: string, init?: MockInit) => {
      if (path === "/api/v1/documents/doc-1" && init?.method === "PATCH") return Promise.resolve({ document: { ...UNTITLED_DOC, revision: "5" } });
      if (path === "/api/v1/documents/doc-1") return Promise.resolve({ document: UNTITLED_DOC });
      return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${path}`));
    });
    const { hook } = setup();
    let a!: Promise<boolean>;
    let b!: Promise<boolean>;
    await act(async () => { a = hook.result.current.ask(); b = hook.result.current.ask(); });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
  });
});

const FOREST = {
  documents: [
    { id: "folder-mine", parent_id: null, title: "Mine", kind: "folder", system_kind: "my_folder", position: 0, children: [] },
    {
      id: "f-contracts", parent_id: null, title: "Hợp đồng", kind: "folder", position: 1,
      children: [{ id: "f-annex", parent_id: "f-contracts", title: "Phụ lục", kind: "folder", position: 0, children: [] }],
    },
    { id: "f-fin", parent_id: null, title: "Tài chính", kind: "folder", position: 2, children: [] },
  ],
};

/** Calls of one method+path, in order, with the position they had among every call. */
function callsTo(method: string, path: string) {
  const calls = requestMock.mock.calls as [string, MockInit | undefined][];
  return calls.flatMap(([p, init], index) => ((init?.method ?? "GET") === method && p === path ? [{ index, init }] : []));
}

/** The documents API of one never-saved blank: detail, rename, tree, and a scripted move. */
function routeDocuments({ move }: { move: () => Promise<unknown> }) {
  let current = { ...UNTITLED_DOC } as Document;
  requestMock.mockImplementation((path: string, init?: MockInit) => {
    const method = init?.method ?? "GET";
    if (path === "/api/v1/documents/doc-1" && method === "PATCH") {
      current = { ...current, title: patchJson([path, init]).title!, revision: String(Number(current.revision) + 1) } as Document;
      return Promise.resolve({ document: current });
    }
    if (path === "/api/v1/documents/doc-1/move" && method === "POST") return move();
    if (path === "/api/v1/documents/doc-1") return Promise.resolve({ document: current });
    if (path.startsWith("/api/v1/workspaces/ws-1/documents/tree")) return Promise.resolve(FOREST);
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
  return () => current;
}

const moved = (parent: string) => () => Promise.resolve({ document: { ...UNTITLED_DOC, parent_id: parent, revision: "6" } });

async function openDialog(hook: { result: { current: FirstSaveNaming } }) {
  let answer!: Promise<boolean>;
  await act(async () => { answer = hook.result.current.ask(); });
  await screen.findByRole("dialog", { name: "Đặt tên tài liệu" });
  return { answer };
}

async function pickFolder(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Đổi" }));
  const picker = await screen.findByRole("dialog", { name: "Chọn nơi lưu" });
  fireEvent.click(within(picker).getByRole("treeitem", { name }));
  fireEvent.click(within(picker).getByRole("button", { name: "Chọn" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Chọn nơi lưu" })).toBeNull());
}

describe("useFirstSaveNaming: where the document is saved (UNI-1960)", () => {
  it("shows the folder the document is in, My Folder by its label, with a Change button", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup();
    void openDialog(hook);
    const dialog = await screen.findByRole("dialog", { name: "Đặt tên tài liệu" });
    expect(dialog).toHaveTextContent("Bạn có thể đổi tên hoặc di chuyển sau.");
    const location = await within(dialog).findByText("Thư mục của tôi");
    expect(location.closest("[data-testid='first-save-location']")).toHaveTextContent("Vị trí");
    expect(within(dialog).getByRole("button", { name: "Đổi" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
  });

  it("shows a subfolder by its path", async () => {
    routeDocuments({ move: moved("f-annex") });
    const { hook } = setup({ doc: { ...UNTITLED_DOC, parent_id: "f-annex" } as Document });
    void openDialog(hook);
    expect(await screen.findByText("Hợp đồng / Phụ lục")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
  });

  it("Change opens the folder picker and the pick becomes the location", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup();
    void openDialog(hook);
    await screen.findByText("Thư mục của tôi");
    await pickFolder("Tài chính");
    const location = screen.getByTestId("first-save-location");
    expect(location).toHaveTextContent("Tài chính");
    expect(callsTo("POST", "/api/v1/documents/doc-1/move")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
  });

  it("moves the document after the title is saved when another folder was picked", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup();
    const { answer } = await openDialog(hook);
    await screen.findByText("Thư mục của tôi");
    await pickFolder("Tài chính");
    fireEvent.change(screen.getByLabelText("Tên tài liệu"), { target: { value: "Kế hoạch Q4" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    const patch = callsTo("PATCH", "/api/v1/documents/doc-1");
    const move = callsTo("POST", "/api/v1/documents/doc-1/move");
    expect(patch).toHaveLength(1);
    expect(move).toHaveLength(1);
    expect(patch[0]!.index).toBeLessThan(move[0]!.index);
    // The move carries the revision the rename left behind, not the stale one.
    const body = move[0]!.init?.body;
    expect(typeof body === "string" ? JSON.parse(body) : body).toMatchObject({ parent_id: "f-fin", revision: "5" });
  });

  it("keeps the dialog, the name and the picked folder when the move is refused, then retries", async () => {
    let refuse = true;
    routeDocuments({
      move: () => refuse
        ? Promise.reject(new ApiError("No permission to create in this folder", "forbidden", 403))
        : moved("f-fin")(),
    });
    const { hook } = setup();
    const { answer } = await openDialog(hook);
    const settled = vi.fn();
    void answer.then(settled);
    await screen.findByText("Thư mục của tôi");
    await pickFolder("Tài chính");
    fireEvent.change(screen.getByLabelText("Tên tài liệu"), { target: { value: "Kế hoạch Q4" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No permission to create in this folder");
    expect(screen.getByRole("dialog", { name: "Đặt tên tài liệu" })).toBeTruthy();
    expect((screen.getByLabelText("Tên tài liệu") as HTMLInputElement).value).toBe("Kế hoạch Q4");
    expect(screen.getByTestId("first-save-location")).toHaveTextContent("Tài chính");
    expect(settled).not.toHaveBeenCalled();
    // The retry moves again without writing the same title twice.
    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    expect(callsTo("PATCH", "/api/v1/documents/doc-1")).toHaveLength(1);
    expect(callsTo("POST", "/api/v1/documents/doc-1/move")).toHaveLength(2);
  });

  it("Cancel after a refused move ends the ask without a save", async () => {
    routeDocuments({ move: () => Promise.reject(new ApiError("refused", "forbidden", 403)) });
    const { hook } = setup();
    const { answer } = await openDialog(hook);
    await screen.findByText("Thư mục của tôi");
    await pickFolder("Tài chính");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await expect(answer).resolves.toBe(false);
  });

  it("sends no move when the folder is unchanged", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup();
    const { answer } = await openDialog(hook);
    await screen.findByText("Thư mục của tôi");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    expect(callsTo("PATCH", "/api/v1/documents/doc-1")).toHaveLength(1);
    expect(callsTo("POST", "/api/v1/documents/doc-1/move")).toHaveLength(0);
  });

  it("starts from where the document is each time the dialog opens", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup();
    let { answer } = await openDialog(hook);
    await screen.findByText("Thư mục của tôi");
    await pickFolder("Tài chính");
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    ({ answer } = await openDialog(hook));
    expect(await screen.findByText("Thư mục của tôi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await expect(answer).resolves.toBe(false);
  });
});

describe("useFirstSaveNaming: share with the workspace (UNI-2038 G4)", () => {
  const MANAGED = { ...UNTITLED_DOC, my_level: "manage", visibility: "restricted" } as Document;

  /** The decoded PATCH bodies, in order. */
  const patchBodies = () => callsTo("PATCH", "/api/v1/documents/doc-1").map(({ init }) => patchJson(["", init]) as Record<string, unknown>);

  it("shows the toggle off by default and saves without a visibility", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup({ doc: MANAGED });
    const { answer } = await openDialog(hook);
    const toggle = await screen.findByRole("switch", { name: "Chia sẻ với workspace" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    const bodies = patchBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("visibility");
  });

  it("turned on, sends ONE PATCH carrying revision, title and visibility", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup({ doc: MANAGED });
    const { answer } = await openDialog(hook);
    fireEvent.click(await screen.findByRole("switch", { name: "Chia sẻ với workspace" }));
    expect(screen.getByText("Mọi người trong workspace có thể xem tài liệu này")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tên tài liệu"), { target: { value: "Kế hoạch Q4" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    expect(patchBodies()).toEqual([{ revision: "4", title: "Kế hoạch Q4", visibility: "workspace" }]);
  });

  it("keeps the dialog open with the error when the PATCH is refused (403), toggle unchanged", async () => {
    requestMock.mockImplementation((path: string, init?: MockInit) => {
      if (path === "/api/v1/documents/doc-1" && init?.method === "PATCH") {
        return Promise.reject(new ApiError("Only people who manage this document can do this.", "forbidden", 403));
      }
      if (path === "/api/v1/documents/doc-1") return Promise.resolve({ document: MANAGED });
      if (path.startsWith("/api/v1/workspaces/ws-1/documents/tree")) return Promise.resolve(FOREST);
      return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${path}`));
    });
    const { hook } = setup({ doc: MANAGED });
    const { answer } = await openDialog(hook);
    const settled = vi.fn();
    void answer.then(settled);
    fireEvent.click(await screen.findByRole("switch", { name: "Chia sẻ với workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only people who manage this document can do this.");
    expect(screen.getByRole("dialog", { name: "Đặt tên tài liệu" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Chia sẻ với workspace" })).toHaveAttribute("aria-checked", "true");
    expect(settled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await expect(answer).resolves.toBe(false);
  });

  it("writes again when the toggle changes after a refused move", async () => {
    let refuse = true;
    routeDocuments({
      move: () => refuse ? Promise.reject(new ApiError("refused", "forbidden", 403)) : moved("f-fin")(),
    });
    const { hook } = setup({ doc: MANAGED });
    const { answer } = await openDialog(hook);
    await screen.findByText("Thư mục của tôi");
    await pickFolder("Tài chính");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await screen.findByRole("alert");
    expect(patchBodies()).toHaveLength(1);
    // The same retry (nothing changed) does not write the PATCH twice.
    refuse = false;
    fireEvent.click(screen.getByRole("switch", { name: "Chia sẻ với workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    const bodies = patchBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ visibility: "workspace" });
  });

  it("does not write again on a retry after a refused move once the share was written (doc now workspace)", async () => {
    let refuse = true;
    routeDocuments({
      move: () => refuse ? Promise.reject(new ApiError("refused", "forbidden", 403)) : moved("f-fin")(),
    });
    const { hook, switchTo } = setup({ doc: MANAGED });
    const { answer } = await openDialog(hook);
    await screen.findByText("Thư mục của tôi");
    fireEvent.click(await screen.findByRole("switch", { name: "Chia sẻ với workspace" }));
    await pickFolder("Tài chính");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await screen.findByRole("alert");
    expect(patchBodies()).toEqual([{ revision: "4", title: "Tài liệu chưa đặt tên", visibility: "workspace" }]);
    // The write put the share on the document: the page now hands the hook a workspace-shared doc.
    act(() => switchTo({ ...MANAGED, visibility: "workspace" } as Document));
    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    expect(patchBodies()).toHaveLength(1);
  });

  it("Cancel and Esc send no PATCH even with the toggle on", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup({ doc: MANAGED });
    let { answer } = await openDialog(hook);
    fireEvent.click(await screen.findByRole("switch", { name: "Chia sẻ với workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    ({ answer } = await openDialog(hook));
    // A reopened dialog starts off again.
    expect(await screen.findByRole("switch", { name: "Chia sẻ với workspace" })).toHaveAttribute("aria-checked", "false");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Đặt tên tài liệu" }), { key: "Escape" });
    await expect(answer).resolves.toBe(false);
    expect(patchBodies()).toHaveLength(0);
  });

  it("shows a document that is already shared as on and aria-disabled, with a hint, and never sends visibility", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup({ doc: { ...MANAGED, visibility: "workspace" } as Document });
    const { answer } = await openDialog(hook);
    const toggle = await screen.findByRole("switch", { name: "Chia sẻ với workspace" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Đã chia sẻ với workspace")).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect(answer).resolves.toBe(true);
    expect(patchBodies()[0]).not.toHaveProperty("visibility");
  });

  it("has no toggle when the person cannot manage the document", async () => {
    routeDocuments({ move: moved("f-fin") });
    const { hook } = setup({ doc: { ...MANAGED, my_level: "edit" } as Document });
    await openDialog(hook);
    await screen.findByText("Thư mục của tôi");
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
  });
});
