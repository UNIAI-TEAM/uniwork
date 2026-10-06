import { describe, expect, it, vi } from "vitest";
import { installPrintShortcut, type PrintShortcutInput } from "./print-shortcut";

function setup() {
  let listener: ((event: { preventDefault(): void }, input: PrintShortcutInput) => void) | undefined;
  const webContents = { on: vi.fn((_event: "before-input-event", next: typeof listener) => { listener = next; }), send: vi.fn() };
  installPrintShortcut(webContents as never);
  const press = (input: Partial<PrintShortcutInput>) => {
    const preventDefault = vi.fn();
    listener!({ preventDefault }, { type: "keyDown", key: "p", control: true, meta: false, alt: false, shift: false, ...input });
    return preventDefault;
  };
  return { webContents, press };
}

describe("installPrintShortcut", () => {
  it("claims Ctrl+P and Cmd+P and asks the renderer to print the open document", () => {
    const { webContents, press } = setup();
    expect(press({})).toHaveBeenCalledOnce();
    expect(press({ control: false, meta: true, key: "P" })).toHaveBeenCalledOnce();
    expect(webContents.send).toHaveBeenCalledTimes(2);
    expect(webContents.send).toHaveBeenCalledWith("desktop:office-print-requested", {});
  });

  it("claims a held key but forwards only the first press", () => {
    const { webContents, press } = setup();
    press({});
    expect(press({ isAutoRepeat: true })).toHaveBeenCalledOnce();
    expect(webContents.send).toHaveBeenCalledOnce();
  });

  it("leaves every other key, a key release and the Alt/Shift chords alone", () => {
    const { webContents, press } = setup();
    for (const input of [{ key: "s" }, { control: false }, { type: "keyUp" }, { alt: true }, { shift: true }]) {
      expect(press(input)).not.toHaveBeenCalled();
    }
    expect(webContents.send).not.toHaveBeenCalled();
  });
});
