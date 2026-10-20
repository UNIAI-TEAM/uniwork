import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("formatting toolbar host (UNI-1955)", () => {
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] };
  const view = (editable: boolean, toolbarHost?: HTMLElement | null) => wrap(<DocumentEditor wsId="ws1" documentId="d1"
    initialContent={content} content={content} contentRevision="1" dirty={false}
    editable={editable} toolbarHost={toolbarHost} onChange={vi.fn()} onUploadAsset={vi.fn()} />);

  it("portals the toolbar and the first-use tip into the host while editable", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    render(view(true, host));
    await screen.findByRole("textbox", { name: t("documents.editor.aria_label") });
    expect(await within(host).findByRole("toolbar", { name: t("documents.page_ui.toolbar.label") })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("documents.page_ui.toolbar.hint.aria") })).toBeInTheDocument();
    host.remove();
  });

  it("shows neither read-only, nor without a host", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const { rerender } = render(view(false, host));
    await screen.findByRole("textbox", { name: t("documents.editor.aria_label") });
    expect(within(host).queryByRole("toolbar")).not.toBeInTheDocument();
    rerender(view(true, null));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: t("documents.page_ui.toolbar.hint.aria") })).not.toBeInTheDocument();
    host.remove();
  });

  it("Xem phím tắt in the tip opens the shortcuts popover", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    render(view(true, host));
    fireEvent.click(await screen.findByRole("button", { name: t("documents.page_ui.toolbar.hint.show_shortcuts") }));
    expect(await screen.findByRole("dialog", { name: t("documents.page_ui.toolbar.help.title") })).toBeInTheDocument();
    host.remove();
  });
});
