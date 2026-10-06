import type { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentEditor } from "./document-editor";

const { t } = initI18n();
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const content = { type: "doc", content: [{ type: "taskList", content: [
  { type: "taskItem", attrs: { checked: false }, content: [paragraph("Parent"),
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("Child")] }] },
  ] },
] }, { type: "paragraph" }] };
beforeEach(() => { requestMock.mockReset().mockResolvedValue({ members: [] }); });

it.each([true, false])("keeps nested task lists semantic with editable=%s", async (editable) => {
  const onChange = vi.fn();
  render(wrap(<DocumentEditor wsId="ws1" documentId="d1" initialContent={content} content={content}
    contentRevision="3" dirty={false} editable={editable} onChange={onChange} onUploadAsset={vi.fn()} />));
  await screen.findByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) });
  document.querySelectorAll('ul[data-type="taskList"]').forEach((list) => {
    expect(Array.from(list.children).map((child) => child.tagName)).toEqual(["LI"]);
  });
  expect(screen.getByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) })).toBeChecked();
  if (!editable) {
    const checkbox = screen.getByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) });
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  }
});

it("toggles the existing task checked attribute through the shared checkbox", async () => {
  const onChange = vi.fn();
  render(wrap(<DocumentEditor wsId="ws1" documentId="d1" initialContent={content} content={content}
    contentRevision="3" dirty={false} editable onChange={onChange} onUploadAsset={vi.fn()} />));
  fireEvent.click(await screen.findByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.lastCall?.[0].content[0]).toMatchObject({ content: [{ content: [
    paragraph("Parent"), { type: "taskList", content: [{ attrs: { checked: false } }] },
  ] }] });
});

it("refreshes live task permissions without changing content, selection, history or save state", async () => {
  const onChange = vi.fn();
  const view = (editable: boolean) => wrap(<DocumentEditor wsId="ws1" documentId="d1"
    initialContent={content} content={content} contentRevision="3" dirty={false}
    editable={editable} onChange={onChange} onUploadAsset={vi.fn()} />);
  const { rerender } = render(view(true));
  const child = await screen.findByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) });
  const body = screen.getByRole("textbox", { name: t("documents.editor.aria_label") });
  const editor = (body as HTMLElement & { editor: Editor }).editor;
  fireEvent.click(child);
  await waitFor(() => expect(child).not.toBeChecked());
  await act(async () => { editor.commands.setTextSelection({ from: 4, to: 7 }); });
  const snapshot = editor.getJSON();
  const selection = editor.state.selection.toJSON();
  const history = undoDepth(editor.state);
  expect(history).toBeGreaterThan(0);
  onChange.mockClear();

  rerender(view(false));
  await waitFor(() => expect(body).toHaveAttribute("contenteditable", "false"));
  await waitFor(() => screen.getAllByRole("checkbox").forEach((checkbox) => {
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
  }));
  fireEvent.click(child);
  fireEvent.keyDown(child, { key: " ", code: "Space" });
  expect(editor.getJSON()).toEqual(snapshot);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(undoDepth(editor.state)).toBe(history);
  expect(onChange).not.toHaveBeenCalled();

  rerender(view(true));
  await waitFor(() => screen.getAllByRole("checkbox").forEach((checkbox) => {
    expect(checkbox).not.toHaveAttribute("aria-disabled", "true");
  }));
  expect(editor.getJSON()).toEqual(snapshot);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(undoDepth(editor.state)).toBe(history);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(child);
  await waitFor(() => expect(child).toBeChecked());
  expect(onChange).toHaveBeenCalledTimes(1);
});
