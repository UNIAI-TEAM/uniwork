import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { FormatEdit } from "@uniwork/office-engine/pptx";
import { pptxInsertNestedDictionary } from "../insert/insert-i18n";
import { formatPanelDictionary } from "./format-i18n";
import { PptxFormatPanel, type PptxFormatPanelProps } from "./pptx-format-panel";

// The panel carries its own keys; install them into the shared instance the way
// the serialized UI-wire round will by merging the same entries into the locale
// files.
const instance = initI18n();
for (const locale of ["en", "vi"] as const) {
  instance.addResourceBundle(locale, "translation", formatPanelDictionary(locale), true, true);
  // The shape names come from the Insert gallery dictionary.
  instance.addResourceBundle(locale, "translation", pptxInsertNestedDictionary(locale), true, true);
}
beforeEach(async () => {
  await setLocale("en");
});

function renderPanel(overrides: Partial<PptxFormatPanelProps> = {}) {
  const onApplyEdit = vi.fn(async (_edit: FormatEdit) => undefined);
  const onError = vi.fn();
  const element = (extra: Partial<PptxFormatPanelProps> = {}) => (
    <PptxFormatPanel
      onApplyEdit={onApplyEdit}
      onError={onError}
      slideIndex={1}
      selectedElementId="sh1"
      selectedElementType="shape"
      selectedIds={["sh1"]}
      {...overrides}
      {...extra}
    />
  );
  const view = render(element());
  return {
    view,
    rerender: (extra: Partial<PptxFormatPanelProps> = {}) => view.rerender(element(extra)),
    onApplyEdit,
    onError,
  };
}

const panel = () => document.querySelector("[data-pptx-format-panel]") as HTMLElement;

describe("PptxFormatPanel", () => {
  it("mounts the six format sections in one labelled panel", () => {
    renderPanel();
    expect(panel()).toHaveAttribute("data-state", "ready");
    expect(screen.getByRole("region", { name: "Format" })).toBeInTheDocument();
    for (const section of ["fill", "line", "effects", "geometry", "arrange", "text"]) {
      expect(document.querySelector(`[data-pptx-format-section="${section}"]`)).not.toBeNull();
    }
  });
  it("renders the Dash-style and Align labels as copy, not a raw key", () => {
    renderPanel({ selectedIds: ["sh1", "sh2"] });
    // The dash and align labels are FULL office.pptx.format.* keys, so they must
    // be resolved on the root t(), not the panel's office.pptx prefix - a
    // prefixed call renders "office.pptx.office.pptx.format.*" verbatim.
    expect(screen.getByRole("combobox", { name: "Dash style" })).toHaveTextContent("Solid");
    expect(screen.getByRole("button", { name: "Align center" })).toHaveTextContent("Align center");
    expect(screen.queryByText(/^office\.pptx\./)).toBeNull();
  });

  it("applies a solid fill as one set_fill edit", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-format-fill-hex"), { target: { value: "#445566" } });
    fireEvent.click(screen.getByTestId("pptx-format-apply-fill"));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1));
    expect(onApplyEdit.mock.calls[0]![0]).toEqual({
      op: "set_fill",
      slideIndex: 1,
      elementId: "sh1",
      fill: "#445566",
    });
  });

  it("applies a gradient fill with the engine's angle unit", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Gradient fill" }));
    fireEvent.change(screen.getByTestId("pptx-format-gradient-angle"), { target: { value: "90" } });
    fireEvent.click(screen.getByTestId("pptx-format-apply-fill"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_fill",
        slideIndex: 1,
        elementId: "sh1",
        fill: {
          stops: [
            { pos: 0, color: "#4472C4" },
            { pos: 1, color: "#FFFFFF" },
          ],
          angle: 5400000,
        },
      }),
    );
  });

  it("applies no fill as the engine's 'none'", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "No fill" }));
    fireEvent.click(screen.getByTestId("pptx-format-apply-fill"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_fill", slideIndex: 1, elementId: "sh1", fill: "none" }),
    );
  });

  it("applies an outline as set_stroke with the EMU width and a dash", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-format-line-width"), { target: { value: "2" } });
    // The dash control is a Base UI Select (a <button role="combobox">): a
    // `change` event never reaches it, so open the trigger and press the item the
    // way a user does (Base UI commits on the click that follows the pointer press).
    fireEvent.click(screen.getByTestId("pptx-format-line-dash"));
    const dashOption = screen.getByRole("option", { name: "Dash" });
    fireEvent.pointerDown(dashOption);
    fireEvent.click(dashOption);
    fireEvent.click(screen.getByTestId("pptx-format-apply-line"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_stroke",
        slideIndex: 1,
        elementId: "sh1",
        stroke: { color: "#000000", widthEmu: 25400, dash: "dash" },
      }),
    );
  });

  it("applies no outline as the engine's null stroke", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "No outline" }));
    fireEvent.click(screen.getByTestId("pptx-format-apply-line"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_stroke", slideIndex: 1, elementId: "sh1", stroke: null }),
    );
  });

  it("renders the shadow toggle as an accessible Drop shadow checkbox", () => {
    renderPanel();
    const shadow = screen.getByRole("checkbox", { name: "Drop shadow" });
    expect(shadow).toHaveAttribute("aria-checked", "false");
    fireEvent.click(shadow);
    expect(shadow).toHaveAttribute("aria-checked", "true");
  });

  it("applies a shadow through set_effects", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Drop shadow" }));
    fireEvent.click(screen.getByTestId("pptx-format-apply-effects"));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1));
    const edit = onApplyEdit.mock.calls[0]![0];
    expect(edit.op).toBe("set_effects");
    expect(edit).toMatchObject({
      op: "set_effects",
      slideIndex: 1,
      elementId: "sh1",
      effects: { shadow: { color: "#000000", blurRad: 50800, dist: 25400, dirDeg: 2700000 }, glow: null, softEdge: 0 },
    });
  });

  it("changes the shape from a named list, not a raw OOXML preset field (R2-11)", async () => {
    const { onApplyEdit } = renderPanel();
    const trigger = screen.getByTestId("pptx-format-prst");
    expect(trigger).toHaveAccessibleName("Change shape");
    expect(trigger).toHaveTextContent("Choose a shape");
    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: "Rounded rectangle" });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_shape_geometry",
        slideIndex: 1,
        elementId: "sh1",
        prst: "roundRect",
      }),
    );
  });

  it("shows no developer fields: no OOXML hint, no adj=0.25 field (R2-11)", () => {
    renderPanel();
    const geometry = document.querySelector('[data-pptx-format-section="geometry"]') as HTMLElement;
    expect(geometry.textContent).not.toMatch(/OOXML|adj=/);
    expect(screen.queryByTestId("pptx-format-adjust")).toBeNull();
  });

  it("groups, flips and aligns the selection through arrange ops", async () => {
    const { onApplyEdit } = renderPanel({ selectedIds: ["sh1", "sh2"] });
    fireEvent.click(screen.getByTestId("pptx-format-group"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "group_elements",
        slideIndex: 1,
        elementIds: ["sh1", "sh2"],
      }),
    );
    fireEvent.click(screen.getByTestId("pptx-format-flip-h"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "flip_elements", slideIndex: 1, elementIds: ["sh1", "sh2"], axis: "h" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Align center" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "align_elements",
        slideIndex: 1,
        elementIds: ["sh1", "sh2"],
        mode: "centerH",
        to: "selection",
      }),
    );
  });

  it("distributes three selected elements", async () => {
    const { onApplyEdit } = renderPanel({ selectedIds: ["a", "b", "c"] });
    fireEvent.click(screen.getByTestId("pptx-format-distribute-h"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "distribute_elements",
        slideIndex: 1,
        elementIds: ["a", "b", "c"],
        axis: "horizontal",
        to: "selection",
      }),
    );
  });

  it("ungroups only when the selection is a single group", () => {
    renderPanel({ selectedElementType: "shape" });
    expect(screen.getByTestId("pptx-format-ungroup")).toBeDisabled();
  });

  it("applies a text anchor and an autofit mode", async () => {
    const { onApplyEdit } = renderPanel({ selectedElementType: "text", selectedElementId: "t1" });
    fireEvent.click(screen.getByRole("radio", { name: "Middle" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_text_anchor", slideIndex: 1, elementId: "t1", anchor: "middle" }),
    );
    // Same Base UI Select interaction as the dash control above.
    await waitFor(() => expect(screen.getByTestId("pptx-format-autofit")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("pptx-format-autofit"));
    const shrinkOption = screen.getByRole("option", { name: "Shrink text on overflow" });
    fireEvent.pointerDown(shrinkOption);
    fireEvent.click(shrinkOption);
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_text_body_props",
        slideIndex: 1,
        elementId: "t1",
        props: { autofit: "shrink" },
      }),
    );
  });

  it("disables the fill section on an element type the engine refuses", () => {
    renderPanel({ selectedElementType: "picture" });
    expect(screen.getByTestId("pptx-format-apply-fill")).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Solid fill" })).toBeDisabled();
    // a picture border is still strokable
    expect(screen.getByTestId("pptx-format-apply-line")).not.toBeDisabled();
  });

  it("shows the empty state and disables every control when nothing is selected", () => {
    renderPanel({ selectedElementId: null, selectedIds: [] });
    expect(panel()).toHaveAttribute("data-state", "empty");
    expect(screen.getByTestId("pptx-format-empty")).toHaveTextContent("Select an element");
    expect(screen.getByTestId("pptx-format-apply-fill")).toBeDisabled();
  });

  it("disables every control and says so when no edit channel is bound", () => {
    renderPanel({ onApplyEdit: undefined });
    expect(screen.getByTestId("pptx-format-unbound")).toHaveTextContent("not connected to this editor yet");
    expect(screen.getByTestId("pptx-format-apply-fill")).toBeDisabled();
  });

  it("disables every control in read-only mode and explains why", () => {
    const { onApplyEdit } = renderPanel({ disabled: true });
    fireEvent.click(screen.getByTestId("pptx-format-apply-fill"));
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("pptx-format-unbound")).toHaveTextContent("read-only");
  });

  it("shows the busy state while an edit is in flight and refuses a duplicate", async () => {
    let resolve!: () => void;
    const onApplyEdit = vi.fn((_edit: FormatEdit) => new Promise<void>((done) => { resolve = done; }));
    renderPanel({ onApplyEdit });
    fireEvent.click(screen.getByTestId("pptx-format-apply-fill"));
    expect(screen.getByTestId("pptx-format-busy")).toHaveTextContent("Applying");
    fireEvent.click(screen.getByTestId("pptx-format-apply-fill"));
    expect(onApplyEdit).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "ready"));
  });

  it("reports a refused edit as an error and keeps the document claim honest", async () => {
    const onApplyEdit = vi.fn(async () => { throw new Error("fmt_bad_color"); });
    const onError = vi.fn();
    renderPanel({ onApplyEdit, onError });
    fireEvent.click(screen.getByTestId("pptx-format-apply-fill"));
    const alert = await screen.findByTestId("pptx-format-error");
    expect(alert).toHaveTextContent("could not be applied");
    expect(alert).toHaveTextContent("fmt_bad_color");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(panel()).toHaveAttribute("data-state", "ready");
  });

  it("renders the loading state as a busy status region", () => {
    renderPanel({ loading: true });
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status", { name: "Loading the format tools..." })).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector("[data-pptx-format-section]")).toBeNull();
  });

  it("renders vi copy when the locale is Vietnamese", async () => {
    await setLocale("vi");
    renderPanel();
    expect(screen.getByRole("region", { name: "Định dạng" })).toBeInTheDocument();
    await setLocale("en");
  });
});