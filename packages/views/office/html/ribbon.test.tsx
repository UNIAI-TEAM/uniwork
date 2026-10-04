// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HTML_RIBBON_KEYS, HtmlRibbon, htmlImageUrlAllowed, useHtmlRibbonTabs } from "./ribbon";
import type { HtmlRibbonCommands } from "./ribbon";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

function commands(): Required<HtmlRibbonCommands> {
  return {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onInlineMark: vi.fn(),
    onSetBlock: vi.fn(),
    onInsertList: vi.fn(),
    onInsertImageFile: vi.fn(),
    onInsertImageUrl: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertButton: vi.fn(),
    onInsertSection: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
  };
}

describe("htmlImageUrlAllowed", () => {
  it("accepts only relative or root-absolute asset paths", () => {
    expect(htmlImageUrlAllowed("assets/photo.png")).toBe(true);
    expect(htmlImageUrlAllowed("/assets/photo.png")).toBe(true);
    expect(htmlImageUrlAllowed("./photo.png")).toBe(true);
  });

  it("refuses every URL the preview gate would drop", () => {
    for (const url of ["https://evil.example/x.png", "http://evil.example/x.png", "//evil.example/x.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "<img src=x>", "assets/a b.png", ""]) {
      expect(htmlImageUrlAllowed(url), url).toBe(false);
    }
  });
});

describe("useHtmlRibbonTabs", () => {
  it("declares Home (clipboard, paragraph, inline) and Insert as pure data", () => {
    let tabs: ReturnType<typeof useHtmlRibbonTabs> = [];
    function Probe() {
      tabs = useHtmlRibbonTabs();
      return null;
    }
    render(<Probe />);
    const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab]));
    expect(Object.keys(byId)).toEqual(["home", "insert"]);
    expect(byId.home!.groups.map((group) => group.id)).toEqual(["clipboard", "paragraph", "inline"]);
    expect(byId.insert!.groups.map((group) => group.id)).toEqual(["insert"]);
    for (const tab of tabs) for (const group of tab.groups) expect(typeof group.priority).toBe("number");
    // R2: one large primary per group (undo in Clipboard, bold in Inline).
    expect(byId.home!.groups[0]!.items.find((item) => item.id === "undo")?.size).toBe("large");
    expect(byId.home!.groups[2]!.items.find((item) => item.id === "bold")?.size).toBe("large");
  });
});

describe("HtmlRibbon", () => {
  it("renders the Home groups and executes the inline, block and insert commands", () => {
    const c = commands();
    render(<HtmlRibbon commands={c} state={{ block: "paragraph" }} />);
    expect(screen.getByRole("region", { name: "Insert" })).toBeInTheDocument();
    for (const caption of [HTML_RIBBON_KEYS.clipboard, HTML_RIBBON_KEYS.paragraph, HTML_RIBBON_KEYS.inline]) {
      expect(screen.getByRole("group", { name: caption })).toBeInTheDocument();
    }
    fireEvent.click(within(screen.getByRole("group", { name: HTML_RIBBON_KEYS.inline })).getByRole("button", { name: "Bold" }));
    expect(c.onInlineMark).toHaveBeenCalledWith("bold");
    fireEvent.click(within(screen.getByRole("group", { name: HTML_RIBBON_KEYS.paragraph })).getByRole("button", { name: HTML_RIBBON_KEYS.blockquote }));
    expect(c.onSetBlock).toHaveBeenCalledWith("blockquote");
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Quick access" })).getByRole("button", { name: "Undo" }));
    expect(c.onUndo).toHaveBeenCalledOnce();
  });

  it("switches to the Insert tab and runs an image-from-file and a table size", () => {
    const c = commands();
    render(<HtmlRibbon commands={c} />);
    fireEvent.click(screen.getByRole("tab", { name: HTML_RIBBON_KEYS.insert }));
    const insertGroup = screen.getByRole("group", { name: "Insert" });
    fireEvent.click(within(insertGroup).getByRole("button", { name: "Image from file" }));
    expect(c.onInsertImageFile).toHaveBeenCalledOnce();
    // The grid picker picks rows x columns on click.
    fireEvent.click(within(insertGroup).getByLabelText("3 x 2 table"));
    expect(c.onInsertTable).toHaveBeenCalledWith(3, 2);
  });

  it("refuses an image URL the gate would drop and accepts an asset path", () => {
    const c = commands();
    render(<HtmlRibbon commands={c} />);
    fireEvent.click(screen.getByRole("tab", { name: HTML_RIBBON_KEYS.insert }));
    fireEvent.click(screen.getByRole("button", { name: "Image from URL" }));
    const input = screen.getByLabelText("Paste an image URL");
    const insert = screen.getByRole("button", { name: "office.html.ribbon.imageUrlInsert" });
    fireEvent.change(input, { target: { value: "https://evil.example/x.png" } });
    expect(screen.getByRole("alert")).toHaveTextContent("office.html.ribbon.imageUrlRefused");
    expect(insert).toBeDisabled();
    fireEvent.change(input, { target: { value: "assets/photo.png" } });
    expect(insert).not.toBeDisabled();
    fireEvent.click(insert);
    expect(c.onInsertImageUrl).toHaveBeenCalledWith("assets/photo.png");
  });

  it("disables every control in read-only mode", () => {
    const c = commands();
    render(<HtmlRibbon commands={c} state={{ readOnly: true }} />);
    expect(within(screen.getByRole("group", { name: HTML_RIBBON_KEYS.inline })).getByRole("button", { name: "Bold" })).toHaveAttribute("aria-disabled", "true");
    expect(within(screen.getByRole("toolbar", { name: "Quick access" })).getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});
