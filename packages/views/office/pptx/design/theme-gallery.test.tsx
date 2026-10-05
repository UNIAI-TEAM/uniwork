import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { installDesignPanelI18n } from "./install-design-i18n";
import { PPTX_DESIGN_THEMES } from "./design-model";
import { PptxThemeGallery } from "./theme-gallery";

initI18n();
installDesignPanelI18n();
beforeEach(async () => { await setLocale("en"); });

describe("PptxThemeGallery", () => {
  it("renders one radio card per built-in theme with its localized name", () => {
    render(<PptxThemeGallery onApplyTheme={vi.fn()} />);
    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(PPTX_DESIGN_THEMES.length);
    expect(screen.getByRole("radiogroup", { name: "Theme gallery" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Apply theme Office" })).toBeInTheDocument();
  });

  it("paints each card from its own scheme (page background, text, accents)", () => {
    render(<PptxThemeGallery onApplyTheme={vi.fn()} />);
    const card = document.querySelector('[data-theme-card="office"] [data-theme-preview]') as HTMLElement;
    expect(card.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(card.style.color).toBe("rgb(0, 0, 0)");
    expect(card.querySelectorAll("span.size-2")).toHaveLength(4);
  });

  it("reports the picked theme id", () => {
    const onApplyTheme = vi.fn();
    render(<PptxThemeGallery onApplyTheme={onApplyTheme} />);
    fireEvent.click(screen.getByRole("radio", { name: "Apply theme Forest" }));
    expect(onApplyTheme).toHaveBeenCalledWith("forest");
  });

  it("marks the deck's current theme checked and labels it as current", () => {
    render(<PptxThemeGallery activeThemeId="indigo" onApplyTheme={vi.fn()} />);
    const current = screen.getByRole("radio", { name: "Indigo (current theme)" });
    expect(current).toHaveAttribute("aria-checked", "true");
    expect(current).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("radio", { name: "Apply theme Office" })).toHaveAttribute("aria-checked", "false");
  });

  it("disables every card while busy and dispatches nothing on click", () => {
    const onApplyTheme = vi.fn();
    render(<PptxThemeGallery busy onApplyTheme={onApplyTheme} />);
    const card = screen.getByRole("radio", { name: "Apply theme Office" });
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onApplyTheme).not.toHaveBeenCalled();
    expect(screen.getByRole("radiogroup", { name: "Theme gallery" })).toHaveAttribute("aria-busy", "true");
  });

  it("disables every card when the panel is disabled", () => {
    render(<PptxThemeGallery disabled onApplyTheme={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Apply theme Office" })).toBeDisabled();
  });

  it("keeps one card in the tab order and moves it with the arrow keys", () => {
    render(<PptxThemeGallery onApplyTheme={vi.fn()} />);
    const cards = screen.getAllByRole("radio");
    expect(cards.filter((card) => card.getAttribute("tabindex") === "0")).toHaveLength(1);
    fireEvent.keyDown(cards[0] as HTMLElement, { key: "ArrowRight" });
    expect(cards[1]).toHaveFocus();
    fireEvent.keyDown(cards[1] as HTMLElement, { key: "End" });
    expect(cards[cards.length - 1]).toHaveFocus();
    fireEvent.keyDown(cards[cards.length - 1] as HTMLElement, { key: "ArrowRight" });
    expect(cards[0]).toHaveFocus();
  });

  it("moves the tabbable stop to the checked theme when it arrives after mount", () => {
    const view = render(<PptxThemeGallery activeThemeId={null} onApplyTheme={vi.fn()} />);
    expect(screen.getAllByRole("radio")[0]).toHaveAttribute("tabindex", "0");
    // The host probe reports the theme only after mount.
    view.rerender(<PptxThemeGallery activeThemeId="forest" onApplyTheme={vi.fn()} />);
    const active = screen.getByRole("radio", { name: "Forest (current theme)" });
    expect(active).toHaveAttribute("aria-checked", "true");
    expect(active).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("radio").filter((card) => card.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("starts the roving focus on the deck's current theme", () => {
    render(<PptxThemeGallery activeThemeId="forest" onApplyTheme={vi.fn()} />);
    const active = screen.getByRole("radio", { name: "Forest (current theme)" });
    expect(active).toHaveAttribute("tabindex", "0");
  });
});