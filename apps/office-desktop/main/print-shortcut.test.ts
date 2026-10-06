import { describe, expect, it, vi } from "vitest";
import { installPrintShortcut, type PrintShortcutInput } from "./print-shortcut";

function setup(platform?: string) {
  let listener: ((event: { preventDefault(): void }, input: PrintShortcutInput) => void) | undefined;
  const webContents = { on: vi.fn((_event: "before-input-event", next: typeof listener) => { listener = next; }), send: vi.fn() };
  installPrintShortcut(webContents as never, platform);
  const press = (input: Partial<PrintShortcutInput>) => {
    const preventDefault = vi.fn();
    listener!({ preventDefault }, { type: "keyDown", key: "p", control: true, meta: false, alt: false, shift: false, ...input });
    return preventDefault;
  };
  return { webContents, press };
}

describe("installPrintShortcut", () => {
  it.each(["win32", "linux"])("claims Ctrl+P on %s and asks the renderer to print the open document", (platform) => {
    const { webContents, press } = setup(platform);
    expect(press({ key: "P" })).toHaveBeenCalledOnce();
    expect(webContents.send).toHaveBeenCalledOnce();
    expect(webContents.send).toHaveBeenCalledWith("desktop:office-print-requested", {});
  });

  it.each(["win32", "linux"])("leaves Meta+P (Win+P projection) and Ctrl+Meta+P alone on %s", (platform) => {
    const { webContents, press } = setup(platform);
    expect(press({ control: false, meta: true })).not.toHaveBeenCalled();
    expect(press({ meta: true })).not.toHaveBeenCalled();
    expect(webContents.send).not.toHaveBeenCalled();
  });

  it("claims Cmd+P on macOS and leaves Ctrl+P to the text field (cursor up)", () => {
    const { webContents, press } = setup("darwin");
    expect(press({ control: false, meta: true, key: "P" })).toHaveBeenCalledOnce();
    expect(webContents.send).toHaveBeenCalledOnce();
    expect(press({})).not.toHaveBeenCalled();
    expect(press({ meta: true })).not.toHaveBeenCalled();
    expect(webContents.send).toHaveBeenCalledOnce();
  });

  it("claims a held key but forwards only the first press", () => {
    const { webContents, press } = setup("win32");
    press({});
    expect(press({ isAutoRepeat: true })).toHaveBeenCalledOnce();
    expect(webContents.send).toHaveBeenCalledOnce();
  });

  it("leaves every other key, a key release and the Alt/Shift chords alone", () => {
    const { webContents, press } = setup("win32");
    for (const input of [{ key: "s" }, { control: false }, { type: "keyUp" }, { alt: true }, { shift: true }]) {
      expect(press(input)).not.toHaveBeenCalled();
    }
    expect(webContents.send).not.toHaveBeenCalled();
  });
});
