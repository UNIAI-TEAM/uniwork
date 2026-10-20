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
    // the approved board order: history, text style, then the groups
    expect(names.slice(0, 3)).toEqual([label("undo"), label("redo"), t("documents.page_ui.toolbar.style_aria", { style: t("documents.page_ui.blocks.paragraph.label") })]);
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
    // undo and redo are disabled on a fresh document, so the Tab stop and the arrows start at the style menu
    const first = within(bar).getAllByRole("button")[2]!;
    expect(stops[0]).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(button("bold"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(button("help_button"));
  });

  it("keeps every tool reachable from the overflow menu", async () => {
    const instance = mount("<p>text</p>", false);
    renderToolbar(instance);
    fireEvent.click(screen.getByRole("button", { name: label("more") }));
    const menu = await screen.findByRole("menu", { name: label("more_title") });
    for (const tool of TOOL_GROUPS.flat()) {
      expect(within(menu).getByRole(tool.isActive ? "menuitemcheckbox" : "menuitem", { name: label(tool.id) })).toBeInTheDocument();
    }
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: label("bulletList") }));
    expect(instance.isActive("bulletList")).toBe(true);
  });

  it("asks to open the help popover through the lifted state", () => {
    const onHelpOpenChange = vi.fn();
    renderToolbar(mount(), { onHelpOpenChange });
    fireEvent.click(button("help_button"));
    expect(onHelpOpenChange.mock.calls[0]?.[0]).toBe(true);
  });
  it("only on/off tools are toggle buttons; actions never announce a pressed state", () => {
    renderToolbar(mount());
    for (const tool of TOOL_GROUPS.flat()) {
      const node = button(tool.id);
      if (tool.isActive) expect(node).toHaveAttribute("aria-pressed");
      else expect(node).not.toHaveAttribute("aria-pressed");
    }
  });

  it("keeps a Tab stop when the focused button becomes disabled", async () => {
    const instance = mount("<p>text</p>", false);
    renderToolbar(instance);
    act(() => { instance.commands.insertContent("x"); });
    await waitFor(() => expect(button("undo")).toBeEnabled());
    fireEvent.focus(button("undo"));
    await waitFor(() => expect(button("undo")).toHaveAttribute("tabindex", "0"));
    fireEvent.click(button("undo"));
    await waitFor(() => expect(button("undo")).toBeDisabled());
    const stops = within(screen.getByRole("toolbar")).getAllByRole("button").filter((node) => node.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).not.toBeDisabled();
  });

  it("disables the table button inside a table", async () => {
    const instance = mount("<p>text</p>", false);
    renderToolbar(instance);
    fireEvent.click(button("table"));
    await waitFor(() => expect(button("table")).toBeDisabled());
  });

  it("does not steal the editor selection on mousedown", () => {
    renderToolbar(mount());
    for (const id of ["bold", "table", "image"]) {
      expect(fireEvent.mouseDown(button(id))).toBe(false);
    }
  });

  it("the link button toggles its popover instead of reopening it after an outside press", async () => {
    renderToolbar(mount());
    fireEvent.click(button("link"));
    await screen.findByRole("textbox", { name: t("editor.bubble_menu.url_aria_label") });
    // Base UI reports the outside press first, then the click lands on the same button.
    fireEvent.pointerDown(button("link"));
    fireEvent.mouseDown(button("link"));
    fireEvent.click(button("link"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: t("editor.bubble_menu.url_aria_label") })).not.toBeInTheDocument());
  });

  it("arrow keys move through the style menu items", async () => {
    renderToolbar(mount("<p>text</p>", false));
    fireEvent.click(screen.getByRole("button", { name: t("documents.page_ui.toolbar.style_aria", { style: t("documents.page_ui.blocks.paragraph.label") }) }));
    const menu = await screen.findByRole("menu", { name: label("style_menu") });
    const items = within(menu).getAllByRole("menuitemradio");
    items[0]!.focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[3]);
  });
});
