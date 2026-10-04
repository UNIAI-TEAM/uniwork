import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PPTX_ANIM_EFFECTS } from "@uniwork/office-engine/pptx";
import { PptxAnimationsPanel } from "./pptx-animations-panel";
import { PPTX_ANIMATIONS_I18N } from "./animations-i18n";
import type { PptxAnimationEntry } from "./animations-model";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const ENTRY: PptxAnimationEntry = { effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 };

function effectLabel(effect: string): string {
  return PPTX_ANIMATIONS_I18N["office.pptx.animations.effect." + effect]!.en;
}

function renderPanel(props: Partial<Parameters<typeof PptxAnimationsPanel>[0]> = {}) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  const onReorder = vi.fn();
  const view = render(
    <PptxAnimationsPanel
      slideIndex={0}
      entries={[]}
      targetElementId="shape-1"
      onAdd={onAdd}
      onRemove={onRemove}
      onReorder={onReorder}
      {...props}
    />,
  );
  return { view, onAdd, onRemove, onReorder };
}

describe("animations i18n keys", () => {
  it("carries a vi + en label for every effect the pane can add", () => {
    for (const effect of PPTX_ANIM_EFFECTS) {
      const entry = PPTX_ANIMATIONS_I18N["office.pptx.animations.effect." + effect];
      expect(entry, "missing key for " + effect).toBeTruthy();
      expect(entry!.en.length).toBeGreaterThan(0);
      expect(entry!.vi.length).toBeGreaterThan(0);
    }
  });

  it("keeps every key under office.pptx.animations", () => {
    for (const key of Object.keys(PPTX_ANIMATIONS_I18N)) {
      expect(key.startsWith("office.pptx.animations.")).toBe(true);
    }
  });
});

describe("PptxAnimationsPanel", () => {
  it("renders the empty state with a next step when the slide has no effects", () => {
    renderPanel();
    expect(screen.getByTestId("pptx-animation-empty")).toHaveTextContent("No animations on this slide");
    expect(screen.getByTestId("pptx-animation-empty")).toHaveTextContent("Add an effect");
  });

  it("lists the slide's effects in play order with step numbers", () => {
    renderPanel({
      entries: [
        { effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 },
        { effect: "spin", trigger: "withPrev", durationMs: 1000, delayMs: 0 },
        { effect: "zoom", trigger: "onClick", durationMs: 500, delayMs: 0 },
      ],
    });
    const rows = document.querySelectorAll("[data-animation-row]");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.querySelector("[data-testid=pptx-animation-step]")).toHaveTextContent("Step 1");
    expect(rows[1]!.querySelector("[data-testid=pptx-animation-step]")).toHaveTextContent("Automatic");
    expect(rows[2]!.querySelector("[data-testid=pptx-animation-step]")).toHaveTextContent("Step 2");
  });

  it("adds the chosen effect with its timing in milliseconds", () => {
    const { onAdd } = renderPanel();
    fireEvent.click(screen.getByTestId("pptx-animation-add-button"));
    expect(onAdd).toHaveBeenCalledWith({ effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 }, "shape-1");
  });

  it("sends the trigger and a re-timed duration when they change", () => {
    const { onAdd } = renderPanel();
    fireEvent.click(screen.getByRole("combobox", { name: "Start" }));
    fireEvent.click(screen.getByRole("option", { name: "After previous" }));
    const duration = screen.getByLabelText("Duration (seconds)");
    fireEvent.change(duration, { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("pptx-animation-add-button"));
    expect(onAdd).toHaveBeenCalledWith({ effect: "fade", trigger: "afterPrev", durationMs: 2000, delayMs: 0 }, "shape-1");
  });

  it("disables add, with a reason, when no shape is selected", () => {
    renderPanel({ targetElementId: null });
    expect(screen.getByTestId("pptx-animations-no-target")).toHaveTextContent("Select a shape");
    expect(screen.getByTestId("pptx-animation-add-button")).toBeDisabled();
  });

  it("refuses an invalid timing field", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Duration (seconds)"), { target: { value: "-1" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number of seconds");
    expect(screen.getByTestId("pptx-animation-add-button")).toBeDisabled();
  });

  it("reports reorder and remove intents from the row actions", () => {
    const { onReorder, onRemove } = renderPanel({ entries: [ENTRY, { ...ENTRY, effect: "spin" }] });
    const rows = document.querySelectorAll("[data-animation-row]");
    fireEvent.click(rows[1]!.querySelector('[aria-label="Move up"]') as HTMLElement);
    expect(onReorder).toHaveBeenCalledWith(1, 0);
    fireEvent.click(rows[0]!.querySelector('[aria-label="Remove animation"]') as HTMLElement);
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("selects a row and reflects it with aria-pressed", () => {
    renderPanel({ entries: [ENTRY] });
    const rowButton = screen.getByRole("button", { name: /Fade, starts On click/ });
    expect(rowButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(rowButton);
    expect(rowButton).toHaveAttribute("aria-pressed", "true");
  });

  it("offers a preview only when a preview port is bound", () => {
    const { view } = renderPanel({ entries: [ENTRY] });
    expect(screen.getByTestId("pptx-animation-preview")).toBeDisabled();
    const onPreview = vi.fn();
    view.rerender(
      <PptxAnimationsPanel slideIndex={0} entries={[ENTRY]} targetElementId="shape-1" onAdd={vi.fn()} onPreview={onPreview} />,
    );
    fireEvent.click(screen.getByTestId("pptx-animation-preview"));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when no slide is selected", () => {
    renderPanel({ slideIndex: null });
    expect(screen.getByTestId("pptx-animations-empty-slide")).toHaveTextContent("Select a slide");
  });

  it("shows the loading state and busy region while reading", () => {
    renderPanel({ loading: true });
    expect(screen.getByTestId("pptx-animations-loading")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Animations" })).toHaveAttribute("aria-busy", "true");
  });

  it("surfaces a read failure with a retry", () => {
    const onRetry = vi.fn();
    renderPanel({ error: "timing unreadable", onRetry });
    expect(screen.getByTestId("pptx-animations-error")).toHaveTextContent("timing unreadable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("stays honest and inert when no edit port is bound", () => {
    render(<PptxAnimationsPanel slideIndex={0} entries={[ENTRY]} targetElementId="shape-1" />);
    expect(screen.getByTestId("pptx-animations-unbound")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-animation-add-button")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Fade, starts On click/ })).toBeDisabled();
  });

  it("marks a read-only presentation without claiming it is unbound", () => {
    renderPanel({ readOnly: true });
    expect(screen.getByTestId("pptx-animations-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("pptx-animations-unbound")).toBeNull();
  });

  it("labels the pane as a region with the slide index", () => {
    renderPanel({ slideIndex: 3 });
    const region = screen.getByRole("region", { name: "Animations" });
    expect(region).toHaveAttribute("data-pptx-animations-panel");
    expect(region).toHaveAttribute("data-slide-index", "3");
  });

  it("keeps the effect picker offering every effect kind", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("combobox", { name: "Effect" }));
    for (const effect of PPTX_ANIM_EFFECTS) {
      expect(screen.getByRole("option", { name: effectLabel(effect) })).toBeInTheDocument();
    }
  });
});
