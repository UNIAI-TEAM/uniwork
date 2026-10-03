import type { Editor } from "@tiptap/core";
import type { PluginKey } from "@tiptap/pm/state";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { sanitizePageContent } from "@uniwork/core/documents/schema";
import { insertPageBlock } from "../editor/extensions/page-blocks";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentEditor } from "./document-editor";

const { t } = initI18n();
const memberId = "01JAAAAAAAAAAAAAAAAAAAAAAA";
beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ members: [{ workspace_id: "ws1", user_id: memberId,
    role: "member", email: "alice@example.test", display_name: "Alice" }] });
});

async function mount(text = "") {
  const content = { type: "doc", content: [{ type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}) }] };
  render(wrap(<DocumentEditor wsId="ws1" documentId="mention-page"
    initialContent={content} content={content} contentRevision="1" dirty={false}
    editable onChange={vi.fn()} onUploadAsset={vi.fn()} />));
  const body = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") });
  const editor = (body as HTMLElement & { editor: Editor }).editor;
  await act(async () => { editor.commands.focus("end"); });
  return editor;
}

function mentionSuggestion(editor: Editor) {
  const mention = editor.extensionManager.extensions.find((extension) => extension.name === "mention")!;
  return mention.options.suggestion;
}

function mentionState(editor: Editor) {
  const key = mentionSuggestion(editor).pluginKey as PluginKey;
  return key.getState(editor.state) as { active: boolean; range: { from: number; to: number } };
}

function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (fn) =>
      fn(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

function paste(editor: Editor, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [],
    getData: (format: string) => format === "text/plain" ? text : "" } });
  editor.view.dom.dispatchEvent(event);
}

it("keeps pasted mention-like text literal and leaves Enter available for a paragraph", async () => {
  const editor = await mount();
  await act(async () => { paste(editor, "check with @Alice"); });
  expect(editor.getText()).toBe("check with @Alice");
  expect(mentionState(editor).active).toBe(false);
  await act(async () => { editor.commands.enter(); });
  expect(editor.getJSON().content).toHaveLength(2);
  expect(editor.getJSON().content?.[0]?.content?.every((node) => node.type === "text")).toBe(true);
});

it("does not reopen mentions from server-loaded text or undo after leaving the trigger", async () => {
  const editor = await mount("@Alice");
  expect(mentionState(editor).active).toBe(false);
  await act(async () => { editor.commands.insertContent(" "); });
  await act(async () => { editor.commands.undo(); });
  expect(editor.getText()).toBe("@Alice");
  expect(mentionState(editor).active).toBe(false);
});

it("opens typed mentions, keeps a pasted query active and inserts schema-safe member content", async () => {
  const editor = await mount();
  await act(async () => { type(editor, "@"); });
  expect(mentionState(editor).active).toBe(true);
  await act(async () => { paste(editor, "Alice"); });
  expect(mentionState(editor).active).toBe(true);
  await waitFor(() => expect(mentionSuggestion(editor).items({ query: "Alice" }))
    .toEqual([{ id: memberId, label: "Alice", type: "member" }]));
  await act(async () => { mentionSuggestion(editor).command({ editor,
    range: mentionState(editor).range, props: { id: memberId, label: "Alice", type: "member" } }); });
  const json = editor.getJSON();
  expect(json.content?.[0]?.content?.[0]).toMatchObject({ type: "mention", attrs: { id: memberId, kind: "user" } });
  expect(sanitizePageContent(json).content).toMatchObject({ content: [{ content: [
    { type: "mention", attrs: { id: memberId, kind: "user", label: "Alice" } }, { type: "text", text: " " },
  ] }] });
});

it("hands a deliberately typed slash over to the existing member picker", async () => {
  const editor = await mount();
  await act(async () => { type(editor, "/"); });
  await act(async () => { insertPageBlock(editor, { from: 1, to: 2 }, "mention"); });
  expect(editor.getText()).toBe("@");
  expect(mentionState(editor).active).toBe(true);
  await waitFor(() => expect(mentionSuggestion(editor).items({ query: "Alice" }))
    .toEqual([{ id: memberId, label: "Alice", type: "member" }]));
});
