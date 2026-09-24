import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ShortcutChord } from "@uniwork/core/shortcuts";
import { ShortcutKeycaps } from "./shortcut-keycaps";

const chord = (
  key: ShortcutChord["key"],
  modifiers: Partial<ShortcutChord["modifiers"]> = {},
): ShortcutChord => ({
  key,
  modifiers: {
    primary: false,
    control: false,
    alt: false,
    shift: false,
    meta: false,
    ...modifiers,
  },
});

describe("ShortcutKeycaps", () => {
  it("renders macos modifier icons and known key tokens", () => {
    render(
      <ShortcutKeycaps
        shortcut={chord("Enter", {
          primary: true,
          control: true,
          alt: true,
          shift: true,
          meta: true,
        })}
        platform="macos"
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("data-slot", "shortcut-keycaps");
    expect(screen.getByTitle("Command")).toBeTruthy();
    expect(screen.getByTitle("Control")).toBeTruthy();
    expect(screen.getByTitle("Option")).toBeTruthy();
    expect(screen.getByTitle("Shift")).toBeTruthy();
    expect(screen.getByTitle("Meta")).toBeTruthy();
    expect(screen.getByTitle("Enter")).toBeTruthy();
  });

  it("renders windows and linux modifier labels", () => {
    const { rerender } = render(
      <ShortcutKeycaps
        shortcut={chord("A", {
          primary: true,
          control: true,
          alt: true,
          shift: true,
          meta: true,
        })}
        platform="windows"
        size="md"
      />,
    );
    expect(screen.getByTitle("Ctrl")).toBeTruthy();
    expect(screen.getByTitle("Win")).toBeTruthy();
    expect(screen.getByTitle("Alt")).toBeTruthy();
    expect(screen.getByTitle("A")).toBeTruthy();

    rerender(
      <ShortcutKeycaps
        shortcut={chord("Escape", { meta: true })}
        platform="linux"
        decorative
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTitle("Super")).toBeTruthy();
    expect(screen.getByTitle("Esc")).toBeTruthy();
  });

  it("covers mapped key tokens without icons via text labels", () => {
    const { rerender } = render(
      <ShortcutKeycaps
        shortcut={chord("Plus")}
        platform="windows"
        className="extra"
        keyClassName="key-extra"
      />,
    );
    expect(screen.getByTitle("+")).toHaveTextContent("+");

    for (const [key, title] of [
      ["Minus", "−"],
      ["Equals", "="],
      ["Underscore", "_"],
      ["Tab", "Tab"],
      ["Space", "Space"],
      ["Backspace", "Backspace"],
      ["Delete", "Delete"],
      ["Up", "Up Arrow"],
      ["Down", "Down Arrow"],
      ["Left", "Left Arrow"],
      ["Right", "Right Arrow"],
    ] as const) {
      rerender(<ShortcutKeycaps shortcut={chord(key)} platform="windows" />);
      expect(screen.getByTitle(title)).toBeTruthy();
    }
  });
});
