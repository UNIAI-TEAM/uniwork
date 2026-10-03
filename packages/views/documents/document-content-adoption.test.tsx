import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDocument } from "@uniwork/core/documents/hooks";
import { initI18n } from "@uniwork/core/i18n";
import type { Document } from "@uniwork/core/types/document";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentWorkspace } from "./document-workspace";

const { t } = initI18n();
const initial: Document = {
  id: "d1", workspace_id: "ws1", organization_id: "o1", kind: "page", title: "Original",
  revision: "3", visibility: "workspace", my_level: "edit", content_text: "", current_version: 1,
  content: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Before image" }] },
    { type: "paragraph", content: [{ type: "text", text: "After image" }] },
  ] }, position: 0, breadcrumbs: [], created_by: "", created_by_kind: "human",
  updated_by: "", updated_by_kind: "human", created_at: "", updated_at: "",
};
type Options = { method?: string; body?: Record<string, unknown> };

function ReactiveWorkspace() {
  const query = useDocument("ws1", "d1");
  return query.data ? <DocumentWorkspace wsId="ws1" doc={query.data} libraryHref="/acme/doi/documents" refetch={query.refetch} /> : null;
}

beforeEach(() => { requestMock.mockReset(); });

it("keeps a slow image through metadata and sanitized-body ACKs and leaves only after asset content is acknowledged", async () => {
  const assetId = "01J00000000000000000000001";
  let saved = initial;
  let acknowledgeTitle!: () => void;
  let acknowledgeUpload!: () => void;
  let acknowledgeAssetBody!: () => void;
  const writes: Record<string, unknown>[] = [];
  requestMock.mockImplementation((path: string, options?: Options) => {
    if (path.endsWith("/assets") && options?.method === "POST") return new Promise((done) => {
      acknowledgeUpload = () => done({ id: assetId, document_id: "d1", url: `/api/v1/documents/d1/assets/${assetId}`,
        mime_type: "image/png", size_bytes: 5, width: 32, height: 32 });
    });
    if (options?.method === "PATCH") {
      const patch = options.body!;
      writes.push(patch);
      const commit = () => {
        expect(patch.revision).toBe(saved.revision);
        saved = { ...saved, ...patch, revision: String(BigInt(saved.revision) + 1n) } as Document;
        return { document: saved };
      };
      if (patch.title) return new Promise((done) => { acknowledgeTitle = () => done(commit()); });
      if (JSON.stringify(patch.content).includes(`asset://${assetId}`)) return new Promise((done) => {
        acknowledgeAssetBody = () => done(commit());
      });
      return Promise.resolve(commit());
    }
    return Promise.resolve(path === "/api/v1/documents/d1" ? { document: saved }
      : path.endsWith("/members") ? { members: [] } : { comments: [] });
  });
  const push = vi.fn();
  const adapter: NavigationAdapter = {
    push, replace: vi.fn(), back: vi.fn(), pathname: "/acme/doi/documents/d1",
    searchParams: new URLSearchParams(), getShareableUrl: (path) => path,
  };
  render(wrap(<NavigationProvider value={adapter}><ReactiveWorkspace /></NavigationProvider>));
  const body = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
  const title = await screen.findByRole("textbox", { name: t("documents.page_ui.title_label") });
  const editor = (body as HTMLElement & { editor: Editor }).editor;
  fireEvent.change(title, { target: { value: "Image title" } });
  fireEvent.blur(title);
  await waitFor(() => expect(writes).toHaveLength(1));
  await act(async () => { editor.chain().focus().setTextSelection(13).run(); });
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [new File(["image"], "slow.png", { type: "image/png" })], getData: () => "" },
  });
  fireEvent(body, paste);
  await waitFor(() => expect(acknowledgeUpload).toBeDefined());
  const findImage = () => {
    let found: { pos: number; attrs: Record<string, unknown> } | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") found = { pos, attrs: node.attrs };
    });
    return found;
  };
  const pendingImage = findImage();
  expect(pendingImage).toMatchObject({ pos: 13, attrs: { uploading: true } });
  fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
  fireEvent.click(screen.getByRole("button", { name: t("documents.leave.save_and_leave") }));
  await act(async () => acknowledgeTitle());
  // Allow the normal two-second autosave and its placeholder-free body ACK.
  await waitFor(() => expect(writes).toHaveLength(2), { timeout: 8_000 });
  await waitFor(() => expect(saved.revision).toBe("5"));
  expect(findImage()).toMatchObject({ pos: 13, attrs: { uploading: true, uploadId: pendingImage!.attrs.uploadId } });
  expect(JSON.stringify(saved.content)).not.toContain("uploadId");
  expect(push).not.toHaveBeenCalled();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);

  await act(async () => acknowledgeUpload());
  await waitFor(() => expect(writes).toHaveLength(3), { timeout: 8_000 });
  expect(writes[2]).toMatchObject({ revision: "5", content: { type: "doc" } });
  expect(JSON.stringify(writes[2]!.content)).toContain(`asset://${assetId}`);
  expect(JSON.stringify(writes[2]!.content)).not.toMatch(/uploadId|uploading/);
  expect(push).not.toHaveBeenCalled();
  await act(async () => acknowledgeAssetBody());
  await waitFor(() => expect(push).toHaveBeenCalledOnce());
  expect(saved.revision).toBe("6");
  expect(JSON.stringify(saved.content)).toContain(`asset://${assetId}`);
  expect(body).toHaveTextContent("Before image");
  expect(body).toHaveTextContent("After image");
});
