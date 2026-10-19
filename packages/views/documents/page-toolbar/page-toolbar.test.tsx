import { Editor, Extension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Plugin } from "@tiptap/pm/state";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { createPageDocumentExtensions } from "../../editor/extensions";
import { wrap } from "../../test/api-mock";
import { PageToolbar } from "./page-toolbar";
import { TOOL_GROUPS } from "./page-toolbar-model";

const { t } = initI18n();
const label = (key: string) => t(`documents.page_ui.toolbar.${key}`);
let editor: Editor | undefined;
let typed: string[] = [];

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  typed = [];
});

function mount(content = "<p>text</p>", selectAll = true) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const spy = Extension.create({
    name: "typedSpy",
    addProseMirrorPlugins: () => [new Plugin({ props: { handleTextInput: (_v, _f, _t, text) => { typed.push(text); return false; } } })],
  });
  editor = new Editor({
    element: host,
    extensions: [...createPageDocumentExtensions({ image: Image, assetUpload: Extension.create({ name: "testUpload" }) }), spy],
    content,
  });
  if (selectAll) editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  else editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}

function renderToolbar(instance: Editor, props: { chooseImage?: () => void; helpOpen?: boolean; onHelpOpenChange?: (open: boolean) => void } = {}) {
  return render(wrap(
    <PageToolbar editor={instance} chooseImage={props.chooseImage ?? vi.fn()}
      helpOpen={props.helpOpen ?? false} onHelpOpenChange={props.onHelpOpenChange ?? vi.fn()} />,
  ));
}

const button = (key: string) => screen.getByRole("button", { name: label(key) });

describe("PageToolbar", () => {
  it("is one labelled toolbar with the groups left to right", () => {
    renderToolbar(mount());
    const bar = screen.getByRole("toolbar", { name: label("label") });
    const names = within(bar).getAllByRole("button").map((node) => node.getAttribute("aria-label"));
    expect(names.slice(0, 3)).toEqual([t("documents.page_ui.toolbar.style_aria", { style: t("documents.page_ui.blocks.paragraph.label") }), label("undo"), label("redo")]);
    for (const tool of TOOL_GROUPS.flat()) expect(names).toContain(label(tool.id));
    expect(names.at(-1)).toBe(label("help_button"));
  });

  it.each([
    ["bold", (e: Editor) => e.isActive("bold")],
    ["italic", (e: Editor) => e.isActive("italic")],
    ["strikethrough", (e: Editor) => e.isActive("strike")],
    ["code", (e: Editor) => e.isActive("code")],
    ["bulletList", (e: Editor) => e.isActive("bulletList")],
    ["orderedList", (e: Editor) => e.isActive("orderedList")],
    ["taskList", (e: Editor) => e.isActive("taskList")],
    ["blockquote", (e: Editor) => e.isActive("blockquote")],
    ["codeBlock", (e: Editor) => e.isActive("codeBlock")],
  ])("%s runs its command and shows it pressed", async (id, active) => {
    const instance = mount();
    renderToolbar(instance);
    expect(button(id)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button(id));
    expect(active(instance)).toBe(true);
    await waitFor(() => expect(button(id)).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(button(id));
    expect(active(instance)).toBe(false);
  });

  it("inserts a divider, a table and asks for an image", () => {
    const instance = mount("<p>text</p>", false);
    const chooseImage = vi.fn();
    renderToolbar(instance, { chooseImage });
    fireEvent.click(button("horizontalRule"));
    expect(instance.getJSON().content?.some((node) => node.type === "horizontalRule")).toBe(true);
    fireEvent.click(button("table"));
    expect(instance.getJSON().content?.some((node) => node.type === "table")).toBe(true);
    fireEvent.click(button("image"));
    expect(chooseImage).toHaveBeenCalledTimes(1);
  });

  it("types @ as a real keystroke so the mention picker can arm", () => {
    const instance = mount("<p></p>", false);
    renderToolbar(instance);
    fireEvent.click(button("mention"));
    expect(instance.getText()).toBe("@");
    expect(typed).toEqual(["@"]);
  });

  it("undo and redo follow the history", async () => {
    const instance = mount("<p>text</p>", false);
    renderToolbar(instance);
    expect(button("undo")).toBeDisabled();
    act(() => { instance.commands.insertContent("x"); });
    await waitFor(() => expect(button("undo")).toBeEnabled());
    fireEvent.click(button("undo"));
    expect(instance.getText()).toBe("text");
    await waitFor(() => expect(button("redo")).toBeEnabled());
    fireEvent.click(button("redo"));
    expect(instance.getText()).toBe("textx");
  });

  it("applies a link through the popover and reports it pressed", async () => {
    const instance = mount();
    renderToolbar(instance);
    fireEvent.click(button("link"));
    const input = await screen.findByRole("textbox", { name: t("editor.bubble_menu.url_aria_label") });
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(instance.isActive("link", { href: "https://example.com" })).toBe(true);
    await waitFor(() => expect(button("link")).toHaveAttribute("aria-pressed", "true"));
  });

  it("the style menu names the block under the caret and switches it", async () => {
    const instance = mount("<h2>text</h2>", false);
    renderToolbar(instance);
    const trigger = screen.getByRole("button", { name: t("documents.page_ui.toolbar.style_aria", { style: t("documents.page_ui.blocks.heading2.label") }) });
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu", { name: label("style_menu") });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false"]);
    fireEvent.click(items[3]!);
    expect(instance.isActive("heading", { level: 3 })).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: t("documents.page_ui.toolbar.style_aria", { style: t("documents.page_ui.blocks.heading3.label") }) })).toBeInTheDocument());
  });

  it("is one Tab stop and the arrow keys move between buttons", () => {
    renderToolbar(mount());
    const bar = screen.getByRole("toolbar");
    const stops = within(bar).getAllByRole("button").filter((node) => node.tabIndex === 0);
    expect(stops).toHaveLength(1);
    const first = within(bar).getAllByRole("button")[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    // undo and redo are disabled on a fresh document, so the arrow skips them
    expect(document.activeElement).toBe(button("bold"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(button("help_button"));
  });

  it("keeps every tool reachable from the overflow menu", async () => {
    const instance = mount("<p>text</p>", false);
    renderToolbar(instance);
    fireEvent.click(screen.getByRole("button", { name: label("more") }));
    const menu = await screen.findByRole("menu", { name: label("more_title") });
    for (const tool of TOOL_GROUPS.flat()) expect(within(menu).getByRole("menuitem", { name: label(tool.id) })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: label("bulletList") }));
    expect(instance.isActive("bulletList")).toBe(true);
  });

  it("asks to open the help popover through the lifted state", () => {
    const onHelpOpenChange = vi.fn();
    renderToolbar(mount(), { onHelpOpenChange });
    fireEvent.click(button("help_button"));
    expect(onHelpOpenChange.mock.calls[0]?.[0]).toBe(true);
  });
});
