import { describe, expect, it } from "vitest";
import { ariaKeyShortcuts } from "./aria";
import { createShortcutChord } from "./definitions";

describe("ariaKeyShortcuts", () => {
  const search = createShortcutChord("K", { primary: true });

  it("maps primary to Meta on macOS and Control elsewhere", () => {
    expect(ariaKeyShortcuts(search, "macos")).toBe("Meta+K");
    expect(ariaKeyShortcuts(search, "windows")).toBe("Control+K");
    expect(ariaKeyShortcuts(search, "linux")).toBe("Control+K");
  });

  it("keeps literal modifiers and orders them Control, Meta, Alt, Shift", () => {
    const chord = createShortcutChord("O", { primary: true, shift: true, alt: true });
    expect(ariaKeyShortcuts(chord, "macos")).toBe("Meta+Alt+Shift+O");
    expect(ariaKeyShortcuts(createShortcutChord("P", { control: true, meta: true }), "windows")).toBe("Control+Meta+P");
  });

  it("writes a plain key as is and renames arrow keys", () => {
    expect(ariaKeyShortcuts(createShortcutChord("S"), "windows")).toBe("S");
    expect(ariaKeyShortcuts(createShortcutChord("Up", { alt: true }), "windows")).toBe("Alt+ArrowUp");
  });

  it("omits the attribute for a cleared chord", () => {
    expect(ariaKeyShortcuts(null, "macos")).toBeUndefined();
  });
});
