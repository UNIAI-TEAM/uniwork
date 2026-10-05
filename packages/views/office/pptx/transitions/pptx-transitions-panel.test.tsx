import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PPTX_TRANSITION_KINDS, type PptxTransitionKind } from "@uniwork/office-engine/pptx";
import { PptxTransitionsPanel } from "./pptx-transitions-panel";
import { Ban, Blend, Sparkles, ZoomIn } from "lucide-react";
import { isPptxTransitionKind, resolveSelectedKind, transitionKindIcon } from "./transition-gallery";
import { PPTX_TRANSITIONS_I18N } from "./transitions-i18n";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const KINDS: readonly PptxTransitionKind[] = PPTX_TRANSITION_KINDS;

/** The English tile label, read from the panel's own key table so the test and
 * the component cannot drift apart. */
function tileLabel(kind: PptxTransitionKind): string {
  return PPTX_TRANSITIONS_I18N["office.pptx.transitions.kind." + kind]!.en;
}

function renderPanel(props: Partial<Parameters<typeof PptxTransitionsPanel>[0]> = {}) {
  const onApplyTransition = vi.fn();
  const onApplyAdvance = vi.fn();
  const view = render(
    <PptxTransitionsPanel slideIndex={0} onApplyTransition={onApplyTransition} onApplyAdvance={onApplyAdvance} {...props} />,
  );
  return { view, onApplyTransition, onApplyAdvance };
}

describe("transitions i18n keys", () => {
  it("carries a vi + en label for every transition kind the gallery renders", () => {
    for (const kind of KINDS) {
      const entry = PPTX_TRANSITIONS_I18N["office.pptx.transitions.kind." + kind];
      expect(entry, "missing key for " + kind).toBeTruthy();
      expect(entry!.en.length).toBeGreaterThan(0);
      expect(entry!.vi.length).toBeGreaterThan(0);
    }
  });

  it("keeps every key under office.pptx.transitions", () => {
    for (const key of Object.keys(PPTX_TRANSITIONS_I18N)) {
      expect(key.startsWith("office.pptx.transitions.")).toBe(true);
    }
  });
});

describe("transition gallery helpers", () => {
  it("recognises only real transition kinds", () => {
    for (const kind of KINDS) expect(isPptxTransitionKind(kind)).toBe(true);
    expect(isPptxTransitionKind("cut")).toBe(false);
    expect(isPptxTransitionKind("")).toBe(false);
    expect(isPptxTransitionKind(7)).toBe(false);
    expect(isPptxTransitionKind(null)).toBe(false);
  });

  it("resolves an unknown reported kind to none instead of an unlabelled selection", () => {
    expect(resolveSelectedKind("fade")).toBe("fade");
    expect(resolveSelectedKind("morph")).toBe("morph");
    expect(resolveSelectedKind("fly")).toBe("none");
    expect(resolveSelectedKind(undefined)).toBe("none");
    expect(resolveSelectedKind(null)).toBe("none");
  });

  it("maps every kind to a decorative icon, Sparkles as the fallback (R2-13)", () => {
    expect(transitionKindIcon("fade")).toBe(Blend);
    expect(transitionKindIcon("zoom")).toBe(ZoomIn);
    expect(transitionKindIcon("none")).toBe(Ban);
    expect(transitionKindIcon("dissolve")).toBe(Sparkles);
  });

  it("draws an aria-hidden icon in every tile while the label stays the accessible name (R2-13)", () => {
    renderPanel({ currentKind: "fade" });
    const tile = screen.getByRole("button", { name: "Fade" });
    expect(tile.querySelector('svg[data-transition-icon="fade"]')).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelectorAll("[data-pptx-transition-gallery] svg[data-transition-icon]")).toHaveLength(12);
    expect(tile.textContent).toBe("Fade");
  });
});

describe("PptxTransitionsPanel", () => {
  it("renders one tile per transition kind and marks the current one", () => {
    renderPanel({ currentKind: "push" });
    expect(document.querySelector("[data-pptx-transition-gallery]")).not.toBeNull();
    for (const kind of KINDS) {
      expect(screen.getByRole("button", { name: tileLabel(kind) })).toBeInTheDocument();
    }
    expect(document.querySelector('[data-transition-kind="push"]')).toHaveAttribute("data-selected", "true");
    expect(document.querySelector('[data-transition-kind="none"]')).toHaveAttribute("data-selected", "false");
    expect(screen.getByTestId("pptx-transitions-current")).toHaveTextContent("Current transition: Push");
  });

  it("reports a picked kind through onApplyTransition", () => {
    const { onApplyTransition } = renderPanel({ currentKind: "none" });
    fireEvent.click(screen.getByRole("button", { name: tileLabel("wipe") }));
    expect(onApplyTransition).toHaveBeenCalledWith("wipe", false);
  });

  it("applies the pick to every slide when the apply-all box is checked", () => {
    const { onApplyTransition } = renderPanel({ currentKind: "none" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all slides" }));
    fireEvent.click(screen.getByRole("button", { name: tileLabel("circle") }));
    expect(onApplyTransition).toHaveBeenCalledWith("circle", true);
  });

  it("commits an auto-advance timer in whole milliseconds from the seconds field", () => {
    const { onApplyAdvance } = renderPanel({ advanceMs: null });
    fireEvent.click(screen.getByRole("radio", { name: "Automatically after" }));
    // Switching the mode alone must not send a stray 0 s timer.
    expect(onApplyAdvance).not.toHaveBeenCalled();
    const field = screen.getByLabelText("Seconds");
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onApplyAdvance).toHaveBeenCalledWith(3000);
  });

  it("clears the timer when the click-to-advance mode is chosen", () => {
    const { onApplyAdvance } = renderPanel({ advanceMs: 4000 });
    fireEvent.click(screen.getByRole("radio", { name: "On mouse click" }));
    expect(onApplyAdvance).toHaveBeenCalledWith(null);
  });

  it("refuses an invalid seconds field instead of sending it to the engine", () => {
    const { onApplyAdvance } = renderPanel({ advanceMs: null });
    fireEvent.click(screen.getByRole("radio", { name: "Automatically after" }));
    const field = screen.getByLabelText("Seconds");
    fireEvent.change(field, { target: { value: "-1" } });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number of seconds");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onApplyAdvance).not.toHaveBeenCalled();
  });

  it("shows the empty state when no slide is selected", () => {
    renderPanel({ slideIndex: null });
    expect(screen.getByTestId("pptx-transitions-empty")).toHaveTextContent("Select a slide");
    expect(document.querySelector("[data-pptx-transition-gallery]")).toBeNull();
  });

  it("shows the loading state while the transition is being read", () => {
    renderPanel({ loading: true });
    expect(screen.getByTestId("pptx-transitions-loading")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Transitions" })).toHaveAttribute("aria-busy", "true");
  });

  it("surfaces a read failure with a retry", () => {
    const onRetry = vi.fn();
    renderPanel({ error: "engine refused", onRetry });
    expect(screen.getByTestId("pptx-transitions-error")).toHaveTextContent("engine refused");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("stays honest and inert when no edit port is bound", () => {
    render(<PptxTransitionsPanel slideIndex={0} />);
    expect(screen.getByTestId("pptx-transitions-unbound")).toBeInTheDocument();
    for (const kind of KINDS) {
      expect(screen.getByRole("button", { name: tileLabel(kind) })).toBeDisabled();
    }
    // The timer field only exists in "automatically" mode; in the default
    // click-to-advance mode there is nothing to disable.
    expect(screen.getByRole("radio", { name: "On mouse click" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Automatically after" })).toBeDisabled();
  });

  it("marks a read-only presentation without claiming it is unbound", () => {
    renderPanel({ readOnly: true });
    expect(screen.getByTestId("pptx-transitions-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("pptx-transitions-unbound")).toBeNull();
  });

  it("exposes the panel as a labelled region with the slide index", () => {
    // <section aria-label> has the implicit region role; the panel does not
    // restate it (jsx-a11y/no-redundant-roles).
    renderPanel({ slideIndex: 2 });
    const region = screen.getByRole("region", { name: "Transitions" });
    expect(region).toHaveAttribute("data-pptx-transitions-panel");
    expect(region).toHaveAttribute("data-slide-index", "2");
  });
});
