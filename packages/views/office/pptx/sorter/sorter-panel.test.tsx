import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { PptxSectionInfo } from "@uniwork/office-engine/pptx";
import { PPTX_SORTER_MESSAGES, pptxSorterI18nResources } from "./sorter-i18n";
import { PptxSorterPanel, type PptxSorterPanelProps } from "./sorter-panel";

// dnd-kit's context is replaced so a test can drive onDragEnd directly; its hooks
// keep the tiles rendering in jsdom (no real sensors needed) - the same seam
// packages/views/documents/document-tree.test.tsx uses.
const dnd = vi.hoisted(() => ({ onDragEnd: undefined as ((event: unknown) => void) | undefined }));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: { children?: React.ReactNode; onDragEnd?: (event: unknown) => void }) => {
      dnd.onDragEnd = props.onDragEnd;
      return <>{props.children}</>;
    },
  };
});

vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      setActivatorNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

// The panel's keys live in its own table until the UI-wire round merges them into
// the shared locale files, so register that table on the i18next singleton. The
// table is the panel's only copy source, so a missing entry fails here loudly.
const i18n = initI18n();
const resources = pptxSorterI18nResources();
i18n.addResourceBundle("en", "translation", resources.en, true, true);
i18n.addResourceBundle("vi", "translation", resources.vi, true, true);

/** The Vietnamese copy of a key, with its `{{vars}}` filled the way the panel does. */
function copy(key: string, vars: Record<string, string | number> = {}): string {
  let value = (PPTX_SORTER_MESSAGES[key] as { vi: string }).vi;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
}

/** A button by its accessible name (aria-label or text). */
function button(key: string, vars: Record<string, string | number> = {}): HTMLElement {
  return screen.getByRole("button", { name: copy(key, vars) });
}

const slides = [
  { id: "s1", label: "Intro" },
  { id: "s2", label: "Body", hidden: true },
  { id: "s3", label: "Close" },
];

const sections: PptxSectionInfo[] = [
  { id: "sec-1", name: "Opening", slideIndices: [1] },
  { id: "sec-2", name: "Wrap up", slideIndices: [2] },
];

function renderPanel(props: Partial<PptxSorterPanelProps> = {}) {
  return render(<PptxSorterPanel slides={slides} sections={sections} onEdit={vi.fn(async () => undefined)} {...props} />);
}

beforeEach(async () => {
  await i18n.changeLanguage("vi");
  dnd.onDragEnd = undefined;
});

describe("PptxSorterPanel", () => {
  it("renders the grid, the selection readout and the section list", () => {
    renderPanel();
    expect(screen.getByLabelText(copy("office.pptx.sorter.label"))).toBeInTheDocument();
    expect(screen.getByLabelText(copy("office.pptx.sorter.grid_label"))).toBeInTheDocument();
    expect(document.querySelectorAll("[data-pptx-sorter-slide]")).toHaveLength(3);
    // s2 is hidden and marked as such.
    expect(document.querySelector("[data-pptx-sorter-hidden]")).not.toBeNull();
    expect(screen.getByText(copy("office.pptx.sorter.selected", { index: 1 }))).toBeInTheDocument();
    // Two named sections + the unsectioned lead group (slide 1 sits before sec-1).
    expect(document.querySelectorAll("[data-pptx-sorter-section]")).toHaveLength(3);
    expect(document.querySelector("[data-pptx-sorter-section='unsectioned']")).not.toBeNull();
    expect(screen.getByText("Opening")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-sorter-section-count")).toHaveTextContent(copy("office.pptx.sections.count", { value: 2 }));
  });

  it("selects a slide from a tile and from the section list", () => {
    const onSelectSlide = vi.fn();
    renderPanel({ onSelectSlide });
    fireEvent.click(button("office.pptx.sorter.slide_label", { index: 3, label: ": Close" }));
    expect(onSelectSlide).toHaveBeenCalledWith(2);
    fireEvent.click(button("office.pptx.sections.select_group", { index: 2, name: "Opening" }));
    expect(onSelectSlide).toHaveBeenCalledWith(1);
  });

  it("sends duplicate and delete for the selected slide", async () => {
    const onEdit = vi.fn(async () => undefined);
    renderPanel({ onEdit, selectedIndex: 0 });
    fireEvent.click(button("office.pptx.sorter.duplicate"));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "duplicate_slide", slideIndex: 0 }]));
    fireEvent.click(button("office.pptx.sorter.delete"));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "delete_slide", slideIndex: 0 }]));
  });

  it("toggles the hidden state and reflects it in the button", async () => {
    const onEdit = vi.fn(async () => undefined);
    renderPanel({ onEdit, selectedIndex: 1 });
    const toggle = button("office.pptx.sorter.show");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "set_slide_hidden", slideIndex: 1, hidden: false }]));
  });

  it("reorders with a drag and with the keyboard handle", async () => {
    const onEdit = vi.fn(async () => undefined);
    renderPanel({ onEdit });
    act(() => {
      dnd.onDragEnd?.({ active: { id: "s1" }, over: { id: "s3" } });
    });
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "move_slide", slideIndex: 0, toIndex: 2 }]));
    fireEvent.keyDown(button("office.pptx.sorter.drag_handle", { index: 2 }), { key: "ArrowRight" });
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "move_slide", slideIndex: 1, toIndex: 2 }]));
  });

  it("offers the layout catalog and adds a slide from the picked layout", async () => {
    const onEdit = vi.fn(async () => undefined);
    renderPanel({
      onEdit,
      layouts: [
        { name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" },
        { name: "Title and Content", path: "ppt/slideLayouts/slideLayout2.xml" },
      ],
      selectedIndex: 0,
    });
    fireEvent.click(button("office.pptx.sorter.new_label"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Title and Content" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "add_slide_with_layout", layout: 1, slideIndex: 0 }]));
  });

  it("loads the layout catalog on demand and shows a loading then error state", async () => {
    let reject!: (reason: unknown) => void;
    const loadLayouts = vi.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; }));
    renderPanel({ loadLayouts });
    fireEvent.click(button("office.pptx.sorter.new_label"));
    expect(await screen.findByTestId("pptx-sorter-layouts-loading")).toBeInTheDocument();
    act(() => { reject(new Error("catalog down")); });
    expect(await screen.findByTestId("pptx-sorter-layouts-error")).toHaveTextContent("catalog down");
  });

  it("says the layouts are unavailable when no catalog is bound", async () => {
    renderPanel();
    fireEvent.click(button("office.pptx.sorter.new_label"));
    expect(await screen.findByText(copy("office.pptx.sorter.layouts_unavailable"))).toBeInTheDocument();
  });

  it("adds, moves, removes and renames sections through the edit channel", async () => {
    const onEdit = vi.fn(async () => undefined);
    renderPanel({ onEdit, selectedIndex: 1 });
    fireEvent.click(button("office.pptx.sections.add_at", { index: 2 }));
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith([{ op: "add_section", atSlideIndex: 1, name: copy("office.pptx.sections.default_name", { index: 3 }) }]),
    );
    fireEvent.click(button("office.pptx.sections.move_down", { name: "Opening" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "move_section", id: "sec-1", dir: "down" }]));
    fireEvent.click(button("office.pptx.sections.remove", { name: "Opening" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "remove_section", id: "sec-1" }]));
    // Rename is inline: open it, type, save with Enter.
    fireEvent.click(button("office.pptx.sections.rename", { name: "Opening" }));
    const field = screen.getByLabelText(copy("office.pptx.sections.rename_label"));
    fireEvent.change(field, { target: { value: "Khai mạc" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ op: "rename_section", id: "sec-1", name: "Khai mạc" }]));
  });

  it("warns inline when a rename would be blank", () => {
    renderPanel();
    fireEvent.click(button("office.pptx.sections.rename", { name: "Opening" }));
    const field = screen.getByLabelText(copy("office.pptx.sections.rename_label"));
    fireEvent.change(field, { target: { value: "   " } });
    expect(screen.getByTestId("pptx-sorter-rename-empty")).toHaveTextContent(copy("office.pptx.sections.rename_empty"));
    expect(button("office.pptx.sections.rename_save")).toBeDisabled();
  });

  it("disables every mutating control and explains why when no edit channel is bound", () => {
    renderPanel({ onEdit: undefined });
    for (const key of ["office.pptx.sorter.duplicate", "office.pptx.sorter.delete", "office.pptx.sorter.new_label"]) {
      expect(button(key)).toBeDisabled();
    }
    expect(screen.getByTestId("pptx-sorter-unbound")).toHaveTextContent(copy("office.pptx.sorter.unbound"));
    expect(button("office.pptx.sections.add_at", { index: 1 })).toBeDisabled();
  });

  it("disables the controls with the read-only reason", () => {
    renderPanel({ readonly: true });
    const duplicate = button("office.pptx.sorter.duplicate");
    expect(duplicate).toBeDisabled();
    expect(duplicate).toHaveAttribute("title", copy("office.pptx.sorter.disabled_readonly"));
    expect(screen.getByTestId("pptx-sorter-readonly")).toHaveTextContent(copy("office.pptx.sorter.readonly"));
  });

  it("shows a loading grid while the deck opens", () => {
    renderPanel({ loading: true });
    expect(screen.getByTestId("pptx-sorter-loading")).toBeInTheDocument();
    expect(document.querySelector("[data-pptx-sorter-grid]")).toBeNull();
  });

  it("shows the honest empty state for a deck with no slides", () => {
    renderPanel({ slides: [], sections: [] });
    expect(screen.getByTestId("pptx-sorter-empty")).toHaveTextContent(copy("office.pptx.sorter.empty"));
    expect(document.querySelector("[data-pptx-sorter-grid]")).toBeNull();
    expect(screen.getByTestId("pptx-sorter-sections-none")).toHaveTextContent(copy("office.pptx.sections.none"));
  });

  it("surfaces a deck error and a rejected edit as alerts", async () => {
    const onEdit = vi.fn(async () => { throw new Error("edit refused"); });
    renderPanel({ onEdit, error: "open failed" });
    expect(screen.getByTestId("pptx-sorter-error")).toHaveTextContent("open failed");
    fireEvent.click(button("office.pptx.sorter.duplicate"));
    expect(await screen.findByTestId("pptx-sorter-edit-error")).toHaveTextContent("edit refused");
  });

  it("announces the in-flight edit politely and blocks a second one", async () => {
    let finish!: () => void;
    const onEdit = vi.fn(() => new Promise<void>((resolve) => { finish = () => resolve(); }));
    renderPanel({ onEdit });
    fireEvent.click(button("office.pptx.sorter.duplicate"));
    await waitFor(() => expect(screen.getByTestId("pptx-sorter-status")).toHaveTextContent(copy("office.pptx.sorter.pending")));
    expect(button("office.pptx.sorter.delete")).toBeDisabled();
    act(() => { finish(); });
    // The guard lifts once the edit settles: the action is usable again.
    await waitFor(() => expect(button("office.pptx.sorter.delete")).toBeEnabled());
    expect(screen.getByTestId("pptx-sorter-status")).toHaveTextContent(/^$/);
  });

  it("keeps a one-slide deck's reorder handle honest but its actions usable", () => {
    renderPanel({ slides: [{ id: "only" }], sections: [] });
    expect(button("office.pptx.sorter.drag_handle", { index: 1 })).toBeDisabled();
    expect(button("office.pptx.sorter.duplicate")).toBeEnabled();
  });

  it("renders a tile thumbnail when the rail supplies one", () => {
    renderPanel({ slides: [{ id: "s1", thumbnailUrl: "data:image/svg+xml;charset=utf-8,%3Csvg/%3E" }], sections: [] });
    const image = document.querySelector("[data-pptx-sorter-slide] img");
    expect(image).toHaveAttribute("src", "data:image/svg+xml;charset=utf-8,%3Csvg/%3E");
    expect(image).toHaveAttribute("alt", "");
    expect(document.querySelector("[data-pptx-sorter-placeholder]")).toBeNull();
  });

  it("groups the slide actions behind one labelled group", () => {
    renderPanel();
    const group = screen.getByRole("group", { name: copy("office.pptx.sorter.actions_label") });
    expect(within(group).getByRole("button", { name: copy("office.pptx.sorter.duplicate") })).toBeInTheDocument();
  });
});