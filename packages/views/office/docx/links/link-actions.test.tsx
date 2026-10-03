import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyLinkHref,
  createDocxLinkClickExtension,
  handleLinkModifierClick,
  isLinkModifierClick,
  linkHrefFromTarget,
  openLinkHref,
} from "./link-actions";

describe("isLinkModifierClick", () => {
  it("accepts primary Ctrl/Cmd clicks only", () => {
    expect(isLinkModifierClick({ button: 0, ctrlKey: true, metaKey: false })).toBe(true);
    expect(isLinkModifierClick({ button: 0, ctrlKey: false, metaKey: true })).toBe(true);
    expect(isLinkModifierClick({ button: 0, ctrlKey: false, metaKey: false })).toBe(false);
    expect(isLinkModifierClick({ button: 1, ctrlKey: true, metaKey: true })).toBe(false);
  });
});

describe("linkHrefFromTarget", () => {
  it("resolves the link ancestor of a click target", () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "https://uniwork.vn");
    const span = document.createElement("span");
    anchor.append(span);
    expect(linkHrefFromTarget(span)).toBe("https://uniwork.vn");
    expect(linkHrefFromTarget(document.createElement("p"))).toBeNull();
    expect(linkHrefFromTarget(null)).toBeNull();
  });
});

describe("handleLinkModifierClick", () => {
  it("opens the link and consumes the event", () => {
    const open = vi.fn();
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "https://uniwork.vn");
    document.body.append(anchor);
    let handled = false;
    anchor.addEventListener("click", (event) => {
      handled = handleLinkModifierClick(event, { open });
    });
    const click = new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true });
    anchor.dispatchEvent(click);
    expect(handled).toBe(true);
    expect(open).toHaveBeenCalledWith("https://uniwork.vn");
    expect(click.defaultPrevented).toBe(true);
    anchor.remove();
  });

  it("leaves plain clicks and non-link targets alone", () => {
    const open = vi.fn();
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "https://uniwork.vn");
    document.body.append(anchor);
    let handled = false;
    anchor.addEventListener("click", (event) => {
      handled = handleLinkModifierClick(event, { open });
    });
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(plain);
    expect(handled).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);

    const paragraph = document.createElement("p");
    document.body.append(paragraph);
    paragraph.addEventListener("click", (event) => {
      handled = handleLinkModifierClick(event, { open });
    });
    paragraph.dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true }));
    expect(handled).toBe(false);
    expect(open).not.toHaveBeenCalled();
    anchor.remove();
    paragraph.remove();
  });
});

describe("openLinkHref", () => {
  it("opens a new tab with noopener,noreferrer", () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    openLinkHref("https://uniwork.vn");
    expect(spy).toHaveBeenCalledWith("https://uniwork.vn", "_blank", "noopener,noreferrer");
    spy.mockRestore();
  });
});

describe("copyLinkHref", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("writes through the clipboard when the host has one", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await expect(copyLinkHref("https://uniwork.vn")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://uniwork.vn");
  });

  it("reports false without a clipboard", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    await expect(copyLinkHref("https://uniwork.vn")).resolves.toBe(false);
  });
});

describe("createDocxLinkClickExtension", () => {
  it("builds the modifier-click extension", () => {
    expect(createDocxLinkClickExtension().name).toBe("docxLinkClick");
    expect(typeof createDocxLinkClickExtension({ open: vi.fn() }).config.addProseMirrorPlugins).toBe("function");
  });
});
