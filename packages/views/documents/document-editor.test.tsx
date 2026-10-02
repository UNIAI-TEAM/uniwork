import type { Editor } from "@tiptap/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentEditor } from "./document-editor";

const { t } = initI18n();

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ members: [] });
});

it("changes readonly permission without treating unchanged content as a user edit", async () => {
  const onChange = vi.fn();
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Saved body" }] }] };
  const view = (editable: boolean) => wrap(<DocumentEditor wsId="ws1" documentId="d1"
    initialContent={content} content={content} contentRevision="3" dirty={false}
    editable={editable} onChange={onChange} onUploadAsset={vi.fn()} />);
  const { rerender } = render(view(true));
  const body = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") });
  rerender(view(false));
  await waitFor(() => expect(body).toHaveAttribute("contenteditable", "false"));
  expect(onChange).not.toHaveBeenCalled();
  rerender(view(true));
  await waitFor(() => expect(body).toHaveAttribute("contenteditable", "true"));
  expect(onChange).not.toHaveBeenCalled();
  expect(body).toHaveTextContent("Saved body");
});

it("preserves the body selection for an equivalent revision ACK but adopts changed server content", async () => {
  const onChange = vi.fn();
  const content = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "ABCDEFGHIJKLMNO" }] },
    { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] },
  ] };
  const view = (next: unknown, revision: string) => wrap(<DocumentEditor wsId="ws1" documentId="d1"
    initialContent={content} content={next} contentRevision={revision} dirty={false}
    editable onChange={onChange} onUploadAsset={vi.fn()} />);
  const { rerender } = render(view(content, "3"));
  const body = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") });
  const editor = (body as HTMLElement & { editor: Editor }).editor;
  await act(async () => { editor.chain().focus().setTextSelection({ from: 4, to: 8 }).run(); });
  // The server JSON omits default attrs that exist in the live editor schema.
  rerender(view(structuredClone(content), "4"));
  expect(editor.state.selection.from).toBe(4);
  expect(editor.state.selection.to).toBe(8);
  expect(onChange).not.toHaveBeenCalled();

  rerender(view({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Changed server body" }] }] }, "5"));
  await waitFor(() => expect(body).toHaveTextContent("Changed server body"));
  expect(body).not.toHaveTextContent("ABCDEFGHIJKLMNO");
  expect(onChange).not.toHaveBeenCalled();
});
