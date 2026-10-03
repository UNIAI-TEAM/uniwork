import { Editor, Mark } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { afterEach, describe, expect, it } from "vitest";
import { createLinksCommands } from "../commands/links";
import { applyLink, getActiveLink, isValidLinkHref, readLinkSeed, removeLink } from "./index";

const LinkMark = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes() {
    return { href: { default: "" }, rId: { default: null }, tooltip: { default: null } };
  },
  renderHTML({ mark }) {
    return ["a", { href: mark.attrs.href }, 0];
  },
});

const editors: Editor[] = [];

function editorWith(content: string): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, LinkMark], content });
  editors.push(editor);
  return editor;
}

function linkAt(editor: Editor, pos: number) {
  return editor.state.doc.nodeAt(pos)?.marks.find((mark) => mark.type.name === "link");
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("isValidLinkHref", () => {
  it("accepts http, https and mailto with a payload", () => {
    expect(isValidLinkHref("https://uniwork.vn")).toBe(true);
    expect(isValidLinkHref("http://localhost:3000/doc")).toBe(true);
    expect(isValidLinkHref("HTTPS://UNIWORK.VN")).toBe(true);
    expect(isValidLinkHref("mailto:hello@uniwork.vn")).toBe(true);
    expect(isValidLinkHref("  https://uniwork.vn  ")).toBe(true);
  });

  it("rejects empty, other schemes and targets with whitespace", () => {
    expect(isValidLinkHref("")).toBe(false);
    expect(isValidLinkHref("   ")).toBe(false);
    expect(isValidLinkHref("https://")).toBe(false);
    expect(isValidLinkHref("mailto:")).toBe(false);
    expect(isValidLinkHref("ftp://uniwork.vn")).toBe(false);
    expect(isValidLinkHref("uniwork.vn")).toBe(false);
    expect(isValidLinkHref("https://uni work.vn")).toBe(false);
    expect(isValidLinkHref("javascript:alert(1)")).toBe(false);
    expect(isValidLinkHref("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isValidLinkHref("file:///etc/passwd")).toBe(false);
    expect(isValidLinkHref("vbscript:msgbox(1)")).toBe(false);
  });
});

describe("getActiveLink / readLinkSeed", () => {
  it("returns null when the caret is plain text", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection(3);
    expect(getActiveLink(editor)).toBeNull();
    expect(readLinkSeed(editor)).toEqual({ link: null, selectionText: "" });
  });

  it("returns the link covering the caret and the text of a selection", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, { href: "https://uniwork.vn", tooltip: "UniWork" });
    editor.commands.setTextSelection(3);
    expect(getActiveLink(editor)).toEqual({
      from: 1,
      to: 6,
      href: "https://uniwork.vn",
      rId: null,
      text: "hello",
      tooltip: "UniWork",
    });
    editor.commands.setTextSelection({ from: 7, to: 12 });
    expect(readLinkSeed(editor)).toEqual({ link: null, selectionText: "world" });
  });

  it("does not treat a selection reaching outside the link as an edit target", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, { href: "https://uniwork.vn" });
    editor.commands.setTextSelection({ from: 3, to: 9 });
    expect(getActiveLink(editor)).toBeNull();
  });
});

describe("applyLink", () => {
  it("marks the selected text in place, keeping the surrounding runs", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(applyLink(editor, { href: "https://uniwork.vn" })).toBe(true);
    expect(editor.state.doc.textBetween(1, 12)).toBe("hello world");
    expect(linkAt(editor, 1)?.attrs.href).toBe("https://uniwork.vn");
    expect(linkAt(editor, 1)?.attrs.rId).toBeNull();
    expect(linkAt(editor, 1)?.attrs.tooltip).toBeNull();
    expect(linkAt(editor, 7)).toBeUndefined();
  });

  it("replaces the selection when the display text changed", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, { href: "https://uniwork.vn", text: "site" });
    expect(editor.state.doc.textBetween(1, 11)).toBe("site world");
    expect(linkAt(editor, 1)?.attrs.href).toBe("https://uniwork.vn");
    expect(linkAt(editor, 1)?.attrs.tooltip).toBeNull();
  });

  it("inserts the link text when there is no selection and no text", () => {
    const editor = editorWith("<p>hello</p>");
    editor.commands.setTextSelection(1);
    applyLink(editor, { href: "https://uniwork.vn" });
    expect(editor.state.doc.textBetween(1, 19)).toBe("https://uniwork.vn");
    expect(linkAt(editor, 1)?.attrs.href).toBe("https://uniwork.vn");
  });

  it("refuses an invalid href or a read-only editor", () => {
    const editor = editorWith("<p>hello</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(applyLink(editor, { href: "ftp://uniwork.vn" })).toBe(false);
    expect(applyLink(editor, { href: "" })).toBe(false);
    expect(linkAt(editor, 1)).toBeUndefined();
    editor.setEditable(false);
    expect(applyLink(editor, { href: "https://uniwork.vn" })).toBe(false);
    expect(linkAt(editor, 1)).toBeUndefined();
  });

  it("edits href, display text and ScreenTip of the link at the caret", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, { href: "https://a.test", tooltip: "first" });
    editor.commands.setTextSelection(3);

    // Address-only change keeps the run and the stored ScreenTip by default.
    applyLink(editor, { href: "https://b.test" });
    expect(linkAt(editor, 1)?.attrs.href).toBe("https://b.test");
    expect(linkAt(editor, 1)?.attrs.tooltip).toBe("first");

    // An emptied ScreenTip field clears it.
    applyLink(editor, { href: "https://b.test", tooltip: null });
    expect(linkAt(editor, 1)?.attrs.tooltip).toBeNull();

    // A changed display text replaces the run.
    editor.commands.setTextSelection(3);
    applyLink(editor, { href: "https://c.test", text: "hi", tooltip: "second" });
    expect(editor.state.doc.textBetween(1, 3)).toBe("hi");
    expect(linkAt(editor, 1)?.attrs.href).toBe("https://c.test");
    expect(linkAt(editor, 1)?.attrs.tooltip).toBe("second");
  });

  it("preserves the imported rId on an address-unchanged edit and drops it when the target changes", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    // An imported relationship-backed hyperlink, as parse.ts:3960 builds it.
    editor.commands.setMark("link", { href: "https://a.test", rId: "rId7", tooltip: null });
    editor.commands.setTextSelection(3);
    expect(getActiveLink(editor)).toMatchObject({ href: "https://a.test", rId: "rId7" });

    // Same address, new ScreenTip: the relationship stays.
    applyLink(editor, { href: "https://a.test", tooltip: "tip" });
    expect(linkAt(editor, 1)?.attrs.rId).toBe("rId7");
    expect(linkAt(editor, 1)?.attrs.tooltip).toBe("tip");

    // Changed address: drop the stale relationship; the writer mints one for the
    // new href (generate.ts:2357 prefers rId over href).
    applyLink(editor, { href: "https://b.test" });
    expect(linkAt(editor, 1)?.attrs.href).toBe("https://b.test");
    expect(linkAt(editor, 1)?.attrs.rId).toBeNull();
  });
});

describe("removeLink", () => {
  it("removes the mark and keeps the text", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, { href: "https://uniwork.vn" });
    editor.commands.setTextSelection(3);
    expect(removeLink(editor)).toBe(true);
    expect(editor.state.doc.textBetween(1, 12)).toBe("hello world");
    expect(linkAt(editor, 1)).toBeUndefined();
  });

  it("does nothing away from a link or on a read-only editor", () => {
    const editor = editorWith("<p>hello world</p>");
    editor.commands.setTextSelection(3);
    expect(removeLink(editor)).toBe(false);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, { href: "https://uniwork.vn" });
    editor.setEditable(false);
    editor.commands.setTextSelection(3);
    expect(getActiveLink(editor)?.href).toBe("https://uniwork.vn");
    expect(removeLink(editor)).toBe(false);
  });
});

describe("createLinksCommands", () => {
  it("exposes the same behaviour through the command seam", () => {
    const editor = editorWith("<p>hello world</p>");
    const area = createLinksCommands({ getEditor: () => editor });
    expect(area.readState(editor)).toEqual({ activeLink: null });

    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(area.commands.applyLink({ href: "https://uniwork.vn" })).toBe(true);
    expect(area.readState(editor)).toEqual({
      activeLink: { from: 1, to: 6, href: "https://uniwork.vn", rId: null, text: "hello", tooltip: null },
    });
    expect(area.commands.linkSeed()).toEqual({
      link: { from: 1, to: 6, href: "https://uniwork.vn", rId: null, text: "hello", tooltip: null },
      selectionText: "hello",
    });
    expect(area.commands.removeLink()).toBe(true);
    expect(area.readState(editor)).toEqual({ activeLink: null });
  });

  it("answers empty results while no editor is open", () => {
    const area = createLinksCommands({ getEditor: () => null });
    expect(area.commands.linkSeed()).toEqual({ link: null, selectionText: "" });
    expect(area.commands.applyLink({ href: "https://uniwork.vn" })).toBe(false);
    expect(area.commands.removeLink()).toBe(false);
    expect(area.readState(null)).toEqual({ activeLink: null });
  });
});
