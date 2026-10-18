import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(input.value).toBe("Tài liệu chưa đặt tên.docx");
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
