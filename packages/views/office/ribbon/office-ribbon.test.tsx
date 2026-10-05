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

  it("keeps a large item's face label on one non-shrinking line with the full text on hover", () => {
    // jsdom has no layout, so this pins the classes that stop the large face's
    // flex column from shrinking the label below its line box (visual r6 M-2:
    // clientHeight 6px vs scrollHeight 15-30px, so the caption was clipped
    // mid-glyph). The label is a single truncated line and carries the full
    // text in `title` instead.
    const { tabs } = ribbonFixture();
    render(<OfficeRibbon tabs={tabs} scope="docx" />);
    const paste = within(group("Clipboard")).getByRole("button", { name: "Paste" });
    expect(paste).toHaveAttribute("data-ribbon-size", "large");
    // F4 (UNI-933): a large split is Word's Paste - icon on top, the label
    // with its ▾ underneath as the menu trigger; the label never shrinks.
    const label = paste.closest("[role=group]")?.querySelector("[data-ribbon-split-menu] span") as HTMLElement;
    expect(label).toHaveTextContent("Paste");
    expect(label.className).toContain("truncate");
  });
});

describe("ribbon band", () => {
  it("is one grey band: root owns the bottom border, tab row and body add none", () => {
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    const root = screen.getByRole("region");
    expect(root).toHaveAttribute("data-office-ribbon", "docx");
    expect(root).toHaveClass("bg-office-band", "border-b");
    expect(root.querySelector("[data-ribbon-tab-row]")?.className).not.toContain("border-b");
    expect(screen.getByRole("tabpanel").className).not.toContain("border");
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

  it("keeps the folded group caption inside its button instead of shrinking it below its line box", () => {
    // jsdom has no layout, so this pins the classes that stop the flex column
    // from shrinking the caption below its line box (visual r5 M-2).
    stubRibbonWidth(120);
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    const button = within(group("Clipboard")).getByRole("button", { name: /Clipboard/ });
    expect(button).toHaveAttribute("data-ribbon-group-button", "clipboard");
    expect(button.className).toContain("justify-center");
    const label = button.querySelector("span") as HTMLElement;
    expect(label).toHaveTextContent("Clipboard");
    expect(label).toHaveAttribute("title", "Clipboard");
    expect(label.className).toContain("shrink-0");
    expect(label.className).not.toContain("line-clamp");
  });

  it("does not cap the folded group caption at a width that clips long labels (F11)", () => {
    // visual-r2 F11: at 1440 the folded group captions vanished after the
    // first three groups and clipped in vi because the folded button's label
    // was hard-capped at max-w-28 (112px) - too narrow for "Row and column
    // size" / "Kich thuoc dong, cot". The cap must leave room for those.
    stubRibbonWidth(120);
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    const button = within(group("Clipboard")).getByRole("button", { name: /Clipboard/ });
    const label = button.querySelector("span") as HTMLElement;
    expect(label.className).not.toContain("max-w-28");
  });

  it("lets an in-ribbon group caption keep its full line instead of truncating (F11)", () => {
    // visual-r2 F11: the in-ribbon caption row truncated at the group's item
    // width. The caption must render untruncated and the group may widen.
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    const groupEl = group("Clipboard");
    const caption = Array.from(groupEl.querySelectorAll("span")).find((el) => el.textContent === "Clipboard") as HTMLElement;
    expect(caption.className).toContain("whitespace-nowrap");
    expect(caption.className).not.toContain("truncate");
    expect(groupEl.className).toContain("min-w-fit");
  });

  it("lets an in-panel gallery wrap instead of keeping its max-content width", async () => {
    // jsdom has no layout, so this pins the classes that let the in-panel
    // gallery row shrink and wrap inside the GroupPanel cap (visual r6 M-4:
    // the row kept ~max-content width and spilled off a narrow window). The
    // off-panel row keeps `h-full shrink-0` so the ribbon body does not
    // reflow it.
    stubRibbonWidth(120);
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    fireEvent.click(within(group("Styles")).getByRole("button", { name: /Styles/ }));
    const inPanel = (await screen.findByRole("dialog", { name: "Lệnh Styles" })).querySelector("[data-ribbon-panel='styles']") as HTMLElement;
    const row = inPanel.querySelector("[data-ribbon-item='style-gallery']") as HTMLElement;
    expect(row.className).toContain("min-w-0");
    expect(row.className).toContain("flex-wrap");
    expect(row.className).not.toContain("shrink-0");

    // The panel sizes to the wrapped rows: a viewport max-height plus internal
    // scroll keeps the frame inside the window instead of spilling below its
    // border (visual r6b M-4). jsdom has no layout, so this pins the classes.
    const panel = screen.getByRole("dialog", { name: "Lệnh Styles" });
    expect(panel.className).toContain("max-h-[calc(100dvh-4rem)]");
    expect(panel.className).toContain("overflow-y-auto");

    // In a wrapping row `h-full` is degenerate, so the card carries a definite
    // height and renders its preview line instead of collapsing to nothing.
    const card = row.querySelector("button") as HTMLElement;
    expect(card.className).toContain("h-14");
    expect(card.className).not.toContain("h-full");
    expect(card).toHaveAttribute("aria-label", expect.stringMatching(/normal/i));
    // Specimen line on top, the card's own name underneath - both rendered.
    const [specimen, name] = Array.from(card.querySelectorAll("span"));
    expect(specimen).toHaveTextContent("AaBbCcDd");
    expect(name).toHaveTextContent(/normal/i);

    // The caption row stays the last child, below the cards, not overlapped.
    expect(inPanel.lastElementChild).toHaveTextContent("Styles");
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

describe("narrow-width tab row", () => {
  it("reserves the trailing controls: at 390px no tab can render behind Find", () => {
    // Visual r4 F-10: at 390px the Find button and the collapse toggle sat on
    // top of the third tab. jsdom has no layout, so this pins the structure
    // that keeps the scroll region and the trailing cluster disjoint: the
    // tablist is the only flexible child and carries a right inset, and the
    // trailing cluster and collapse toggle are shrink-0, opaque siblings after
    // it, stacked above it.
    window.innerWidth = 390;
    // Five fixed tabs, like the PDF tab row; the fixture's third tab is
    // contextual (hidden until selected) so it is not reused here.
    const base = ribbonFixture().tabs.filter((tab) => !tab.contextual);
    const tabs = [0, 1, 2, 3, 4].map((index) => {
      const source = base[index % base.length]!;
      return { ...source, id: `${source.id}-${index}`, labelKey: `${source.labelKey} ${index}` };
    });
    render(<OfficeRibbon tabs={tabs} scope="pdf" trailing={<button type="button">Find</button>} />);
    const tabRow = document.querySelector("[data-ribbon-tab-row]") as HTMLElement;
    const tablist = within(tabRow).getByRole("tablist");

    // The scroll region is the one flexible child and reserves a right inset.
    expect(tablist.className).toContain("flex-1");
    expect(tablist.className).toContain("min-w-0");
    expect(tablist.className).toContain("overflow-x-auto");
    expect(tablist.className).toContain("pr-1");
    const flexible = (Array.from(tabRow.children) as HTMLElement[]).filter((node) => node.className.includes("flex-1"));
    expect(flexible).toEqual([tablist]);

    // Every tab stays in the scroll region and reachable, never inside the
    // trailing cluster.
    expect(within(tablist).getAllByRole("tab")).toHaveLength(5);

    // The trailing cluster and the collapse toggle are non-shrinking
    // siblings that follow the scroll region, so a tab cannot sit under Find.
    const trailing = tabRow.querySelector("[data-ribbon-trailing]") as HTMLElement;
    expect(trailing.className).toContain("shrink-0");
    expect(trailing.contains(tablist)).toBe(false);
    expect(tablist.contains(trailing)).toBe(false);
    expect(tablist.compareDocumentPosition(trailing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(trailing).getByRole("button", { name: "Find" })).toBeInTheDocument();

    const toggle = tabRow.querySelector("[data-ribbon-collapse-toggle]") as HTMLElement;
    expect(toggle.parentElement?.className).toContain("shrink-0");
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

describe("OfficeRibbon tab row overflow", () => {
  it("scrolls horizontally and keeps the collapse toggle outside the scroller", () => {
    const { tabs } = ribbonFixture();
    render(<OfficeRibbon tabs={tabs} scope="docx" />);
    const tablist = screen.getByRole("tablist", { name: "Các thẻ dải lệnh" });
    expect(tablist.className).toContain("overflow-x-auto");
    expect(tablist.className).toContain("min-w-0");
    expect(tablist).not.toContainElement(document.querySelector("[data-ribbon-collapse-toggle]"));
  });

  it("brings the selected tab into view when selection changes", () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      const { tabs } = ribbonFixture();
      render(<OfficeRibbon tabs={tabs} scope="docx" />);
      scrollIntoView.mockClear();
      fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
