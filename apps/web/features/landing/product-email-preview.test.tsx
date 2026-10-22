import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { ProductEmailPreview } from "./product-email-preview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no PointerEvent; Base UI builds one when the switch is clicked.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
  (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {} as typeof MouseEvent;
}
let root: Root;
let container: HTMLDivElement;

const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const row = () => container.querySelector<HTMLElement>("[data-thread-row]")!;
const subject = () => container.querySelector<HTMLElement>("#demo-email-subject");
/** The toolbar's announced keys, label to chord, read from the real DOM. */
const announced = () => Object.fromEntries([...container.querySelectorAll("[role=toolbar] [aria-keyshortcuts]")].map(el => [el.getAttribute("aria-label"), el.getAttribute("aria-keyshortcuts")]));

async function openReader() {
  await act(async () => { row().click(); });
  expect(subject()).not.toBeNull();
}
/** Flip the dialog's single-key switch; the preview owns that state. */
async function setSwitch(on: boolean) {
  await press(row() ?? subject()!, "?");
  const toggle = document.querySelector<HTMLElement>("[role=switch]")!;
  expect(toggle.getAttribute("aria-checked")).toBe(on ? "false" : "true");
  await act(async () => { toggle.click(); });
  expect(toggle.getAttribute("aria-checked")).toBe(String(on));
}

beforeEach(async () => {
  await setLocale("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(ProductEmailPreview)); });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe("landing email preview single-key switch", () => {
  it("announces the reader keys while the switch is on", async () => {
    await openReader();
    expect(Object.values(announced()).sort()).toEqual(["#", "E", "Escape", "S", "Shift+U"]);
  });

  it("announces only Escape on the back button once the switch is off", async () => {
    await openReader();
    await setSwitch(false);
    expect(announced()).toEqual({ "Back to list": "Escape" });
  });

  it("still goes back on Escape with the switch off, and ignores the other single keys", async () => {
    await openReader();
    await setSwitch(false);
    await press(subject()!, "e");
    await press(subject()!, "#");
    expect(subject()).not.toBeNull();
    await press(subject()!, "Escape");
    expect(subject()).toBeNull();
    expect(row()).not.toBeNull();
  });
});
