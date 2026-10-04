// B3ui (UNI-927) - jsdom tests for the Charts panel.
//
// One payload per section through the single `onApplyEdit` port, the disabled
// reasons, and the four panel states. The panel owns no session and no
// transport, so no host module is mocked.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { ChartEdit } from "@uniwork/office-engine/pptx";
import { PPTX_CHART_DEFAULT_RECT } from "./chart-model";
import { registerPptxChartsI18n } from "./charts-i18n";
import { PptxChartsPanel, type PptxChartsPanelProps } from "./pptx-charts-panel";

initI18n();
registerPptxChartsI18n();
beforeEach(async () => {
  await setLocale("en");
  registerPptxChartsI18n();
});

function renderPanel(overrides: Partial<PptxChartsPanelProps> = {}) {
  const onApplyEdit = vi.fn(async (_edit: ChartEdit) => undefined);
  const onError = vi.fn();
  const element = (extra: Partial<PptxChartsPanelProps> = {}) => (
    <PptxChartsPanel
      onApplyEdit={onApplyEdit}
      onError={onError}
      slideCount={3}
      slideIndex={1}
      chartElementId="chart-1"
      chartKind="bar"
      chartData={{ categories: ["Q1", "Q2"], series: [{ name: "Sales", values: [10, 20] }] }}
      chartStyle={{ title: "Revenue", legendPos: "b", dataLabels: false, gridlines: false }}
      {...overrides}
      {...extra}
    />
  );
  const view = render(element());
  return {
    view,
    rerender: (extra: Partial<PptxChartsPanelProps> = {}) => view.rerender(element(extra)),
    onApplyEdit,
    onError,
  };
}

const panel = () => document.querySelector("[data-pptx-charts-panel]") as HTMLElement;

describe("PptxChartsPanel", () => {
  it("mounts the four sections in one labelled panel", () => {
    renderPanel();
    expect(panel()).toHaveAttribute("data-state", "ready");
    expect(screen.getByRole("region", { name: "Charts" })).toBeInTheDocument();
    expect(document.querySelector("[data-pptx-charts-insert]")).toBeInTheDocument();
    expect(document.querySelector("[data-pptx-charts-data]")).toBeInTheDocument();
    expect(document.querySelector("[data-pptx-charts-type]")).toBeInTheDocument();
    expect(document.querySelector("[data-pptx-charts-style]")).toBeInTheDocument();
  });

  it("renders the Kind and Colour-scheme labels as copy, not a raw key", () => {
    renderPanel();
    // The full office.pptx.charts.kind.* / .palette.* keys must be looked up on
    // the root t(), not the panel's office.pptx prefix - a prefixed call renders
    // "office.pptx.office.pptx.charts.*" in the trigger and the item list.
    const typeTriggers = screen.getAllByRole("combobox", { name: "Type" });
    expect(typeTriggers[0]).toHaveTextContent("Clustered column");
    expect(typeTriggers[1]).toHaveTextContent("Clustered column");
    expect(screen.getByRole("combobox", { name: "Colours" })).toHaveTextContent("Office");
    expect(screen.queryByText(/^office\.pptx\./)).toBeNull();
  });

  it("inserts a chart with one add_chart payload", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByTestId("pptx-charts-insert"));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1));
    const edit = onApplyEdit.mock.calls[0]![0];
    expect(edit.op).toBe("add_chart");
    expect(edit).toMatchObject({
      op: "add_chart",
      slideIndex: 1,
      kind: "bar",
      xPx: PPTX_CHART_DEFAULT_RECT.xPx,
      yPx: PPTX_CHART_DEFAULT_RECT.yPx,
      wPx: PPTX_CHART_DEFAULT_RECT.wPx,
      hPx: PPTX_CHART_DEFAULT_RECT.hPx,
    });
  });

  it("applies the Data section as one set_chart with the parsed series", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-charts-data-text"), {
      target: { value: "Cat,Value\nQ1,7\nQ2,9" },
    });
    fireEvent.click(screen.getByTestId("pptx-charts-data-apply"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_chart",
        slideIndex: 1,
        elementId: "chart-1",
        patch: { categories: ["Q1", "Q2"], series: [{ name: "Value", values: [7, 9] }] },
      }),
    );
  });

  it("applies the Type section as one set_chart kind payload", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByTestId("pptx-charts-type-apply"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_chart",
        slideIndex: 1,
        elementId: "chart-1",
        patch: { kind: "bar", barDir: "col" },
      }),
    );
  });

  it("applies the Style section as one set_chart style payload", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByTestId("pptx-charts-style-apply"));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1));
    const edit = onApplyEdit.mock.calls[0]![0] as { op: string; patch: Record<string, unknown> };
    expect(edit.op).toBe("set_chart");
    expect(edit.patch).toMatchObject({ title: "Revenue", legendPos: "b", dataLabels: false, gridlines: false });
    expect(Array.isArray(edit.patch.colorScheme)).toBe(true);
  });

  it("seeds the data editor from the selected chart", () => {
    renderPanel();
    const textarea = screen.getByTestId("pptx-charts-data-text") as HTMLTextAreaElement;
    expect(textarea.value).toContain("Sales");
    expect(textarea.value).toContain("Q1");
  });

  it("disables every control and says so when no edit channel is bound", () => {
    renderPanel({ onApplyEdit: undefined });
    expect(screen.getByTestId("pptx-charts-unbound")).toHaveTextContent(
      "Chart edits are not connected to this editor yet.",
    );
    expect(screen.getByTestId("pptx-charts-insert")).toBeDisabled();
    expect(screen.getByTestId("pptx-charts-data-apply")).toBeDisabled();
  });

  it("disables every control in read-only mode and explains why", () => {
    const { onApplyEdit } = renderPanel({ disabled: true });
    fireEvent.click(screen.getByTestId("pptx-charts-insert"));
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("pptx-charts-unbound")).toHaveTextContent("This presentation is read-only.");
  });

  it("keeps the Insert section usable with no chart selected and explains the rest", () => {
    renderPanel({ chartElementId: null });
    expect(screen.getByTestId("pptx-charts-insert")).not.toBeDisabled();
    expect(screen.getByTestId("pptx-charts-data-apply")).toBeDisabled();
    expect(screen.getByTestId("pptx-charts-no-selection")).toHaveTextContent(
      "Select a chart on the slide to edit its data, type or style.",
    );
  });

  it("disables everything but reports the no-slide reason when no slide is selected", () => {
    renderPanel({ slideIndex: null });
    expect(screen.getByTestId("pptx-charts-insert")).toBeDisabled();
    expect(screen.getByTestId("pptx-charts-unbound")).toHaveTextContent("Select a slide to insert a chart.");
  });

  it("shows the busy state while an edit is in flight and refuses a duplicate", async () => {
    let resolve!: () => void;
    const onApplyEdit = vi.fn((_edit: ChartEdit) => new Promise<void>((done) => { resolve = done; }));
    renderPanel({ onApplyEdit });
    fireEvent.click(screen.getByTestId("pptx-charts-insert"));
    expect(screen.getByTestId("pptx-charts-busy")).toHaveTextContent("Applying...");
    fireEvent.click(screen.getByTestId("pptx-charts-insert"));
    expect(onApplyEdit).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "ready"));
  });

  it("reports a refused edit as an error and keeps the document claim honest", async () => {
    const onApplyEdit = vi.fn(async () => {
      throw new Error("bad_chart_data");
    });
    const onError = vi.fn();
    renderPanel({ onApplyEdit, onError });
    fireEvent.click(screen.getByTestId("pptx-charts-insert"));
    const alert = await screen.findByTestId("pptx-charts-error");
    expect(alert).toHaveTextContent("The chart change could not be applied");
    expect(alert).toHaveTextContent("bad_chart_data");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(panel()).toHaveAttribute("data-state", "ready");
  });

  it("surfaces a local parse refusal without calling the edit channel", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-charts-data-text"), { target: { value: "nonsense" } });
    fireEvent.click(screen.getByTestId("pptx-charts-data-apply"));
    const alert = await screen.findByTestId("pptx-charts-error");
    expect(alert).toHaveTextContent("bad_chart_data");
    expect(onApplyEdit).not.toHaveBeenCalled();
  });

  it("renders the loading state as a busy status region", () => {
    renderPanel({ loading: true });
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status", { name: "Loading the chart tools..." })).toHaveAttribute("aria-busy", "true");
  });

  it("renders the empty state for a deck with no slides", () => {
    renderPanel({ slideCount: 0, slideIndex: null });
    expect(panel()).toHaveAttribute("data-state", "empty");
    expect(panel()).toHaveTextContent("Open a presentation to insert a chart");
  });
});