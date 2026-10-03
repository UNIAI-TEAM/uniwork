import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { configureShortcutPlatform } from "@uniwork/core/shortcuts";
import {
  createDocxShortcutController,
  isDocxShortcutInputTarget,
  useDocxShortcuts,
  type DocxShortcutHandlers,
} from "./use-docx-shortcuts";

interface FakeKeyInit {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}

function keyEvent(key: string, init: FakeKeyInit = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent;
}

describe("createDocxShortcutController", () => {
  it("fires the handler for a bound chord and prevents the key only then", () => {
    const bold = vi.fn();
    const controller = createDocxShortcutController({ bold }, { platform: "windows" });
    const event = keyEvent("b", { ctrlKey: true });

    expect(controller.handle(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(bold).toHaveBeenCalledWith(event, expect.objectContaining({ id: "bold" }));
  });

  it("leaves unbound keys and map entries without a handler alone", () => {
    const controller = createDocxShortcutController({}, { platform: "windows" });

    const unboundKey = keyEvent("b", { ctrlKey: true });
    expect(controller.handle(unboundKey)).toBe(false);
    expect(unboundKey.preventDefault).not.toHaveBeenCalled();

    // Mod+S is in the map but this controller has no save handler.
    const unboundEntry = keyEvent("s", { ctrlKey: true });
    expect(controller.handle(unboundEntry)).toBe(false);
    expect(unboundEntry.preventDefault).not.toHaveBeenCalled();
  });

  it("skips repeating, already-prevented and IME keydowns", () => {
    const bold = vi.fn();
    const controller = createDocxShortcutController({ bold }, { platform: "windows" });

    expect(controller.handle(keyEvent("b", { ctrlKey: true, repeat: true }))).toBe(false);
    expect(controller.handle(keyEvent("b", { ctrlKey: true, defaultPrevented: true }))).toBe(false);
    expect(controller.handle(keyEvent("b", { ctrlKey: true, isComposing: true }))).toBe(false);
    expect(bold).not.toHaveBeenCalled();
  });

  it("keeps editor chords out of text fields but lets global chords through", () => {
    const bold = vi.fn();
    const save = vi.fn();
    const controller = createDocxShortcutController({ bold, save }, { platform: "windows" });
    const input = document.createElement("input");

    expect(controller.handle(keyEvent("b", { ctrlKey: true, target: input }))).toBe(false);
    expect(bold).not.toHaveBeenCalled();

    expect(controller.handle(keyEvent("s", { ctrlKey: true, target: input }))).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not fire behind an open dialog or menu", () => {
    const bold = vi.fn();
    const controller = createDocxShortcutController({ bold }, { platform: "windows" });
    const layer = document.createElement("div");
    layer.setAttribute("role", "dialog");
    const inner = document.createElement("button");
    layer.appendChild(inner);
    document.body.appendChild(layer);
    try {
      expect(controller.handle(keyEvent("b", { ctrlKey: true, target: inner }))).toBe(false);
      expect(bold).not.toHaveBeenCalled();

      const override = createDocxShortcutController({ bold }, { platform: "windows", isLayerTarget: () => true });
      expect(override.handle(keyEvent("b", { ctrlKey: true }))).toBe(false);
    } finally {
      layer.remove();
    }
  });

  it("uses the macOS chord list when the platform is macOS", () => {
    const redo = vi.fn();
    const controller = createDocxShortcutController({ redo }, { platform: "macos" });

    expect(controller.handle(keyEvent("z", { metaKey: true, shiftKey: true }))).toBe(true);
    // ⌘Y is a Windows chord; the Mac list replaced it.
    expect(controller.handle(keyEvent("y", { metaKey: true }))).toBe(false);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("normalizes meaning keys such as Equals and Minus", () => {
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    const controller = createDocxShortcutController({ zoomIn, zoomOut }, { platform: "windows" });

    expect(controller.handle(keyEvent("=", { ctrlKey: true }))).toBe(true);
    expect(controller.handle(keyEvent("-", { ctrlKey: true }))).toBe(true);
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).toHaveBeenCalledTimes(1);
  });

  it("binds and unbinds a target element", () => {
    const bold = vi.fn();
    const controller = createDocxShortcutController({ bold }, { platform: "windows" });
    const surface = document.createElement("div");

    controller.attach(surface);
    fireEvent.keyDown(surface, { key: "b", ctrlKey: true });
    expect(bold).toHaveBeenCalledTimes(1);

    controller.detach();
    fireEvent.keyDown(surface, { key: "b", ctrlKey: true });
    expect(bold).toHaveBeenCalledTimes(1);
  });

  it("re-attaching replaces the previous target", () => {
    const bold = vi.fn();
    const controller = createDocxShortcutController({ bold }, { platform: "windows" });
    const first = document.createElement("div");
    const second = document.createElement("div");

    controller.attach(first);
    controller.attach(second);
    fireEvent.keyDown(first, { key: "b", ctrlKey: true });
    fireEvent.keyDown(second, { key: "b", ctrlKey: true });
    expect(bold).toHaveBeenCalledTimes(1);
  });
});

describe("isDocxShortcutInputTarget", () => {
  it("treats text controls as inputs and contenteditables as the document", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isDocxShortcutInputTarget(document.createElement(tag))).toBe(true);
    }
    expect(isDocxShortcutInputTarget(document.createElement("div"))).toBe(false);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isDocxShortcutInputTarget(editable)).toBe(false);
    expect(isDocxShortcutInputTarget(null)).toBe(false);
  });
});

describe("useDocxShortcuts", () => {
  it("binds to the document and reads the latest handlers without rebinding", () => {
    // The hook resolves the platform itself; pin it so a Mac dev machine and
    // the Linux CI run the same chord.
    configureShortcutPlatform("windows");
    const first = vi.fn();
    try {
      const { rerender, unmount } = renderHook(
        ({ handlers }: { handlers: DocxShortcutHandlers }) => useDocxShortcuts(handlers),
        { initialProps: { handlers: { help: first } as DocxShortcutHandlers } },
      );

      fireEvent.keyDown(document, { key: "/", ctrlKey: true });
      expect(first).toHaveBeenCalledTimes(1);

      const second = vi.fn();
      rerender({ handlers: { help: second } });
      fireEvent.keyDown(document, { key: "/", ctrlKey: true });
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).toHaveBeenCalledTimes(1);

      unmount();
      fireEvent.keyDown(document, { key: "/", ctrlKey: true });
      expect(second).toHaveBeenCalledTimes(1);
    } finally {
      configureShortcutPlatform(null);
    }
  });
});
