import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { OfficeRibbon } from "./office-ribbon";
import { ribbonFixture, stubRibbonWidth } from "./test/fixtures";

beforeEach(() => {
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function group(name: string) {
  return screen.getByRole("group", { name });
}

describe("OfficeRibbon rendering", () => {
  it("renders the tab row, labelled groups and item sizes", () => {
    const { tabs, actions } = ribbonFixture();
    render(<OfficeRibbon tabs={tabs} scope="docx" quickAccess={<button type="button">Undo</button>} trailing={<button type="button">Find</button>} />);
    expect(screen.getByRole("region", { name: "Dải lệnh" })).toBeInTheDocument();
    const tablist = screen.getByRole("tablist", { name: "Các thẻ dải lệnh" });
    expect(within(tablist).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Home", "Insert"]);
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("toolbar", { name: "Truy cập nhanh" })).toContainElement(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", screen.getByRole("tab", { name: "Home" }).id);

    for (const caption of ["Clipboard", "Font", "Paragraph", "Styles", "Editing"]) {
      expect(group(caption)).toHaveAttribute("data-ribbon-stage", "0");
    }
    expect(within(group("Clipboard")).getByRole("button", { name: "Paste" })).toHaveAttribute("data-ribbon-size", "large");
    expect(within(group("Clipboard")).getByRole("button", { name: "Cut" })).toHaveAttribute("data-ribbon-size", "small");
    expect(within(group("Clipboard")).getByRole("button", { name: "Copy" })).toHaveAttribute("aria-disabled", "true");
    const bold = within(group("Font")).getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("data-ribbon-size", "icon");
    expect(bold).toHaveAttribute("aria-pressed", "true");
    expect(within(group("Font")).getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(bold);
    expect(actions.bold).toHaveBeenCalledOnce();
    fireEvent.click(within(group("Clipboard")).getByRole("button", { name: "Copy" }));
    expect(actions.copy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Font settings" }));
    expect(actions.fontDialog).toHaveBeenCalledOnce();
  });

  it("switches tabs and renders that tab's groups", () => {
    const { tabs, actions } = ribbonFixture();
    const onActiveTabChange = vi.fn();
    render(<OfficeRibbon tabs={tabs} scope="docx" onActiveTabChange={onActiveTabChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(onActiveTabChange).toHaveBeenCalledWith("insert");
    expect(screen.queryByRole("group", { name: "Font" })).not.toBeInTheDocument();
    fireEvent.click(within(group("Tables")).getByRole("button", { name: "Table" }));
    expect(actions.table).toHaveBeenCalledOnce();
  });

  it("opens split and dropdown menus and runs the chosen entry", async () => {
    const { tabs, actions } = ribbonFixture();
    render(<OfficeRibbon tabs={tabs} scope="docx" />);
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(actions.paste).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Tùy chọn Paste" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Paste special" }));
    expect(actions.pasteSpecial).toHaveBeenCalledOnce();

    fireEvent.click(within(group("Paragraph")).getByRole("button", { name: /Bullets/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disc" }));
    expect(actions.bullets).toHaveBeenCalledOnce();
  });

  it("renders a gallery with its cards and a More menu holding every card", async () => {
    const { tabs, actions } = ribbonFixture();
    render(<OfficeRibbon tabs={tabs} scope="docx" />);
    const styles = group("Styles");
    expect(within(styles).getByRole("button", { name: "normal" })).toHaveAttribute("aria-pressed", "true");
    expect(within(styles).queryByRole("button", { name: "title" })).not.toBeInTheDocument();
    fireEvent.click(within(styles).getByRole("button", { name: "h2" }));
    expect(actions.style).toHaveBeenCalledWith("h2");
    fireEvent.click(within(styles).getByRole("button", { name: "Thêm Styles" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "title" }));
    expect(actions.style).toHaveBeenCalledWith("title");
  });

  it("renders a combo as a labelled select", () => {
    const { tabs } = ribbonFixture();
    render(<OfficeRibbon tabs={tabs} scope="docx" />);
    expect(within(group("Font")).getByRole("combobox", { name: "Font family" })).toHaveTextContent("Calibri");
  });
});

describe("contextual tabs", () => {
  it("hides a contextual tab until its object is selected, then shows it last with its accent", () => {
    const { tabs } = ribbonFixture();
    const { rerender } = render(<OfficeRibbon tabs={tabs} scope="docx" />);
    expect(screen.queryByRole("tab", { name: "Table Design" })).not.toBeInTheDocument();

    const selected = ribbonFixture({ tableSelected: true }).tabs;
    rerender(<OfficeRibbon tabs={[selected[2]!, ...selected.slice(0, 2)]} scope="docx" />);
    const names = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(names).toEqual(["Home", "Insert", "Table Design"]);
    const contextual = screen.getByRole("tab", { name: "Table Design" });
    expect(contextual).toHaveAttribute("data-ribbon-contextual", "info");
    expect(contextual.className).toContain("border-t-info");
    // Selecting the object does not force-switch tabs (Word default).
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(contextual);
    expect(screen.getByTestId("custom-size")).toHaveTextContent("small");
    rerender(<OfficeRibbon tabs={tabs} scope="docx" />);
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("adaptive collapse", () => {
  it("keeps every group full on a wide body", () => {
    stubRibbonWidth(4000);
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    expect(screen.getAllByRole("group").filter((node) => node.dataset.ribbonStage === "0")).toHaveLength(5);
  });

  it("collapses low-priority groups first at a medium width", () => {
    stubRibbonWidth(560);
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    expect(group("Editing")).toHaveAttribute("data-ribbon-stage", "3");
    expect(group("Clipboard")).toHaveAttribute("data-ribbon-stage", "0");
    expect(within(group("Clipboard")).getByRole("button", { name: "Paste" })).toHaveAttribute("data-ribbon-size", "large");
  });

  it("takes more steps while the rendered row still overflows the estimate", () => {
    stubRibbonWidth(4000);
    // Pretend the row overflows for as long as the Clipboard group is still full.
    const restore = [
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
        return this.querySelector("[data-ribbon-group='clipboard'][data-ribbon-stage='0']") ? 5000 : 100;
      }),
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400),
    ];
    try {
      render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
      expect(group("Editing")).toHaveAttribute("data-ribbon-stage", "3");
      expect(group("Clipboard").dataset.ribbonStage).not.toBe("0");
    } finally {
      restore.forEach((spy) => spy.mockRestore());
    }
  });

  it("renders the full body with groups, captions and items when the width is zero", () => {
    // Electron can report a 0 body width before the first layout pass. The
    // ribbon must lay out at declared sizes then, not collapse to an empty body
    // (U3): a zero (and an unmeasured) width is treated as "no measurement yet".
    stubRibbonWidth(0);
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    expect(group("Clipboard")).toHaveAttribute("data-ribbon-stage", "0");
    expect(within(group("Clipboard")).getByRole("button", { name: "Paste" })).toHaveAttribute("data-ribbon-size", "large");
    expect(group("Font")).toHaveAttribute("data-ribbon-stage", "0");
    expect(within(group("Font")).getByRole("combobox", { name: "Font family" })).toBeInTheDocument();
  });

  it("renders the full body when no ResizeObserver ever reports a width", () => {
    // jsdom's default stub never calls back; that is the "unmeasured" case.
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    expect(group("Clipboard")).toHaveAttribute("data-ribbon-stage", "0");
    expect(within(group("Clipboard")).getByRole("button", { name: "Paste" })).toHaveAttribute("data-ribbon-size", "large");
  });

  it("still collapses when a real width is measured", () => {
    stubRibbonWidth(560);
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    expect(group("Editing")).toHaveAttribute("data-ribbon-stage", "3");
    expect(group("Clipboard")).toHaveAttribute("data-ribbon-stage", "0");
  });

  it("folds every group into one button at a tiny width and opens it as a panel", async () => {
    stubRibbonWidth(120);
    const { actions } = ((fixture) => {
      render(<OfficeRibbon tabs={fixture.tabs} scope="docx" />);
      return fixture;
    })(ribbonFixture());
    for (const caption of ["Clipboard", "Font", "Paragraph", "Styles", "Editing"]) {
      expect(group(caption)).toHaveAttribute("data-ribbon-stage", "3");
    }
    fireEvent.click(within(group("Clipboard")).getByRole("button", { name: /Clipboard/ }));
    await screen.findByRole("dialog", { name: "Lệnh Clipboard" });
    const inPanel = document.querySelector("[data-ribbon-panel='clipboard']") as HTMLElement;
    expect(inPanel).toHaveAttribute("aria-label", "Clipboard");
    // Inside the panel the group shows its full sizes again.
    expect(within(inPanel).getByRole("button", { name: "Paste" })).toHaveAttribute("data-ribbon-size", "large");
    fireEvent.click(within(inPanel).getByRole("button", { name: "Cut" }));
    expect(actions.cut).toHaveBeenCalledOnce();
  });
});

describe("collapse affordance", () => {
  it("renders a labelled ribbon-panel toggle, never a bare up/down chevron pair", () => {
    // U5: the collapse control must read as a proper UniWork control. A bare
    // ChevronUp/ChevronDown next to Find looked like a stray spinner.
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" trailing={<button type="button">Find</button>} />);
    const toggle = screen.getByRole("button", { name: "Thu gọn dải lệnh" });
    expect(toggle).toHaveAttribute("data-ribbon-collapse-toggle", "");
    expect(toggle).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
    // The trailing slot carries only the caller's controls (Find); the collapse
    // toggle lives in its own sibling, so no stray icon sits inside the
    // trailing cluster next to Find.
    const trailing = document.querySelector("[data-ribbon-trailing]") as HTMLElement;
    expect(within(trailing).getAllByRole("button").map((node) => node.textContent)).toEqual(["Find"]);
    expect(trailing.contains(toggle)).toBe(false);
    expect(trailing.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("collapse to tabs only", () => {
  it("toggles with the button, persists, and peeks the body as an overlay on a tab click", () => {
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    const body = screen.getByRole("tabpanel", { hidden: true });
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn dải lệnh" }));
    expect(body).not.toBeVisible();
    expect(useOfficeRibbonPreferencesStore.getState().collapsed.docx).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(body).toBeVisible();
    expect(body).toHaveAttribute("data-ribbon-peek", "true");
    expect(screen.getByRole("button", { name: "Ghim dải lệnh" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(body).not.toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.pointerDown(document.body);
    expect(body).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Hiện dải lệnh" }));
    expect(body).toBeVisible();
    expect(body).not.toHaveAttribute("data-ribbon-peek");
  });

  it("toggles with Ctrl+F1 and with a double-click on a tab", () => {
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="xlsx" />);
    const root = screen.getByRole("region");
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true });
    expect(root).toHaveAttribute("data-ribbon-collapsed", "true");
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true, repeat: true });
    expect(root).toHaveAttribute("data-ribbon-collapsed", "true");
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true });
    expect(root).toHaveAttribute("data-ribbon-collapsed", "false");
    fireEvent.doubleClick(screen.getByRole("tab", { name: "Home" }));
    expect(root).toHaveAttribute("data-ribbon-collapsed", "true");
  });

  it("starts collapsed when the stored preference says so", () => {
    act(() => useOfficeRibbonPreferencesStore.getState().setCollapsed("pptx", true));
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="pptx" />);
    expect(screen.getByRole("tabpanel", { hidden: true })).not.toBeVisible();
  });
});
