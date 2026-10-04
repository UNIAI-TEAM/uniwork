import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyLinkHref,
  createDocxLinkClickExtension,
  handleLinkModifierClick,
  isLinkModifierClick,
  linkHrefFromTarget,
  openLinkHref,
} from "./index";

const BLOCKED_SCHEMES = ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "file:///etc/passwd", "vbscript:msgbox(1)"];

function anchorWith(href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  document.body.append(anchor);
  return anchor;
}

/** The extension's own click handler, captured through its plugin spec. */
function pluginClick(open: (href: string) => void) {
  const extension = createDocxLinkClickExtension({ open });
  const build = extension.config.addProseMirrorPlugins as ((this: unknown) => unknown[]) | undefined;
  const plugin = build?.call(extension)[0] as { props: { handleDOMEvents?: { click?: (view: unknown, event: MouseEvent) => boolean | void } } } | undefined;
  return plugin?.props.handleDOMEvents?.click;
}

function pluginHandlesModifierClick(open: (href: string) => void, anchor: HTMLElement): boolean {
  const click = pluginClick(open);
  let handled: boolean | undefined;
  anchor.addEventListener("click", (event) => {
    handled = click?.(null, event) === true;
  });
  anchor.dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true }));
  return handled === true;
}

afterEach(() => {
  document.body.innerHTML = "";
});

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
    const anchor = anchorWith("https://uniwork.vn");
    const span = document.createElement("span");
    anchor.append(span);
    expect(linkHrefFromTarget(span)).toBe("https://uniwork.vn");
    expect(linkHrefFromTarget(document.createElement("p"))).toBeNull();
    expect(linkHrefFromTarget(null)).toBeNull();
  });
});

describe("openLinkHref", () => {
  it("opens an allowlisted target in a new tab with noopener,noreferrer", () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    expect(openLinkHref("https://uniwork.vn")).toBe(true);
    expect(spy).toHaveBeenCalledWith("https://uniwork.vn", "_blank", "noopener,noreferrer");
    expect(openLinkHref("mailto:hello@uniwork.vn")).toBe(true);
    expect(spy).toHaveBeenCalledWith("mailto:hello@uniwork.vn", "_blank", "noopener,noreferrer");
    spy.mockRestore();
  });

  it.each(BLOCKED_SCHEMES)("never opens the blocked scheme %s", (href) => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    expect(openLinkHref(href)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects empty and schemeless targets", () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    expect(openLinkHref("")).toBe(false);
    expect(openLinkHref("uniwork.vn")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("handleLinkModifierClick", () => {
  it("opens an allowlisted link and consumes the event", () => {
    const open = vi.fn();
    const anchor = anchorWith("https://uniwork.vn");
    let handled = false;
    anchor.addEventListener("click", (event) => {
      handled = handleLinkModifierClick(event, { open });
    });
    const click = new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true });
    anchor.dispatchEvent(click);
    expect(handled).toBe(true);
    expect(open).toHaveBeenCalledWith("https://uniwork.vn");
    expect(click.defaultPrevented).toBe(true);
  });

  it.each(BLOCKED_SCHEMES)("consumes %s without opening it", (href) => {
    const open = vi.fn();
    const anchor = anchorWith(href);
    let handled = false;
    let prevented = false;
    anchor.addEventListener("click", (event) => {
      handled = handleLinkModifierClick(event, { open });
      prevented = event.defaultPrevented;
    });
    anchor.dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true }));
    expect(handled).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it("leaves plain clicks and non-link targets alone", () => {
    const open = vi.fn();
    const anchor = anchorWith("https://uniwork.vn");
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
  });
});

describe("createDocxLinkClickExtension", () => {
  it("builds the modifier-click extension", () => {
    expect(createDocxLinkClickExtension().name).toBe("docxLinkClick");
    expect(typeof createDocxLinkClickExtension({ open: vi.fn() }).config.addProseMirrorPlugins).toBe("function");
  });

  it("opens an allowlisted link from the registered click handler", () => {
    const open = vi.fn();
    expect(pluginHandlesModifierClick(open, anchorWith("https://uniwork.vn"))).toBe(true);
    expect(open).toHaveBeenCalledWith("https://uniwork.vn");
  });

  it.each(BLOCKED_SCHEMES)("blocks the scheme %s at the extension handler", (href) => {
    const open = vi.fn();
    expect(pluginHandlesModifierClick(open, anchorWith(href))).toBe(true);
    expect(open).not.toHaveBeenCalled();
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
