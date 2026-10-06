import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bold, Scissors } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { RibbonGroupView } from "./ribbon-group";
import type { RibbonGroup, RibbonItem } from "./types";

function renderGroup(group: RibbonGroup, stage: 0 | 1 | 2 = 0) {
  render(<RibbonGroupView group={group} stage={stage} />);
  return screen.getByRole("group", { name: group.labelKey });
}

const gallery = (count: number, extra: Partial<RibbonItem> = {}): RibbonItem =>
  ({
    kind: "gallery",
    id: "styles",
    labelKey: "Styles",
    maxVisible: 3,
    selectedId: "o1",
    onSelect: vi.fn(),
    options: Array.from({ length: count }, (_, i) => ({ id: `o${i + 1}`, label: `Opt ${i + 1}` })),
    ...extra,
  }) as RibbonItem;

describe("group anatomy", () => {
  it("pins the launcher in the caption row, after a centred caption", () => {
    const group = renderGroup({
      id: "font",
      labelKey: "Font",
      priority: 1,
      launcher: { labelKey: "Font dialog", onOpen: vi.fn() },
      items: [{ kind: "button", id: "bold", labelKey: "Bold", icon: Bold, size: "icon", onExecute: vi.fn() }],
    });
    const caption = group.querySelector("[data-ribbon-caption='font']") as HTMLElement;
    expect(caption.className).toContain("justify-center");
    expect(caption.firstElementChild).toHaveTextContent("Font");
    const launcher = within(caption).getByRole("button", { name: "Font dialog" });
    expect(launcher).toHaveAttribute("data-ribbon-launcher", "font");
    expect(launcher.parentElement?.className).toContain("right-0");
    expect(group.className).toContain("after:bg-border");
    expect(group.className).not.toContain("border-r");
  });
});

describe("gallery", () => {
  it("renders one bordered box with the visible cards and a more button", () => {
    const group = renderGroup({ id: "styles", labelKey: "Styles group", priority: 1, items: [gallery(5)] });
    const box = group.querySelector("[data-ribbon-item='styles']") as HTMLElement;
    expect(box.className).toContain("border-border");
    const cards = within(box).getAllByRole("button", { pressed: true }).concat(within(box).getAllByRole("button", { pressed: false }));
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("AaBbCcDd");
    expect(cards[0]?.className).toContain("border-0");
    expect(within(box).getByRole("button", { name: /Styles/ })).toBeInTheDocument();
    expect(box.querySelector("[data-ribbon-gallery-more]")).not.toBeNull();
  });

  it("has no more button when every card is visible, and honours a custom sample", () => {
    const group = renderGroup({ id: "styles", labelKey: "Styles group", priority: 1, items: [gallery(2, { sample: "Xy" } as Partial<RibbonItem>)] });
    expect(group.querySelector("[data-ribbon-gallery-more]")).toBeNull();
    expect(within(group).getByRole("button", { name: "Opt 1" })).toHaveTextContent("Xy");
    expect(within(group).getByRole("button", { name: "Opt 1" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("items", () => {
  const combo = (width?: number): RibbonItem => ({
    kind: "combo",
    id: "family",
    labelKey: "Family",
    value: "a",
    options: [{ value: "a", label: "Document default" }],
    onChange: vi.fn(),
    width,
  });

  it("gives combos a 140px default and a 56px floor", () => {
    const first = renderGroup({ id: "g", labelKey: "G", priority: 1, items: [combo()] });
    expect(first.querySelector<HTMLElement>("[data-ribbon-item='family']")?.style.width).toBe("140px");
  });

  it("shows a placeholder instead of a blank trigger when a combo has no value (R3 F-3)", () => {
    const group = renderGroup({
      id: "g",
      labelKey: "G",
      priority: 1,
      items: [{ ...combo(), value: null, placeholderKey: "Unset spacing" } as RibbonItem],
    });
    expect(within(group).getByRole("combobox", { name: "Family" })).toHaveTextContent("Unset spacing");
  });

  it("never renders a combo narrower than 56px", () => {
    const group = renderGroup({ id: "g", labelKey: "G", priority: 1, items: [combo(20)] });
    expect(group.querySelector<HTMLElement>("[data-ribbon-item='family']")?.style.width).toBe("56px");
  });

  it("renders the label of a large item", () => {
    const group = renderGroup({
      id: "g",
      labelKey: "G",
      priority: 1,
      items: [{ kind: "button", id: "cut", labelKey: "Cut it", icon: Scissors, size: "large", onExecute: vi.fn() }],
    });
    const button = within(group).getByRole("button", { name: "Cut it" });
    expect(button).toHaveAttribute("data-ribbon-size", "large");
    expect(button).toHaveTextContent("Cut it");
  });

  it("names an icon item and wires it to a tooltip trigger", async () => {
    const group = renderGroup({
      id: "g",
      labelKey: "G",
      priority: 1,
      items: [{ kind: "toggle", id: "bold", labelKey: "Bold", icon: Bold, size: "icon", pressed: false, shortcut: "Ctrl+B", onExecute: vi.fn() }],
    });
    const button = within(group).getByRole("button", { name: "Bold" });
    expect(button).toHaveAttribute("data-ribbon-size", "icon");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button.className).toContain("size-6");
    await userEvent.hover(button);
    expect(await screen.findByText("Bold (Ctrl+B)")).toBeInTheDocument();
  });
});
