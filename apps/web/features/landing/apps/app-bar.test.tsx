import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { AppBar } from "./app-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const SECTIONS = [{ id: "a-overview", labelKey: "landing.apps.bar.overview" }, { id: "a-faq", labelKey: "landing.apps.bar.faq" }] as const;

beforeEach(async () => {
  await setLocale("vi");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(AppBar, { app: "unichat", sections: SECTIONS, cta: { href: "#a-download", label: "Tải cho macOS", short: "Tải" } })); });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the app bar", () => {
  it("names the app under Apps, lists the sections and keeps both download labels", () => {
    expect(container.querySelector(".app-bar-crumb")?.textContent).toBe("Ứng dụngUniChat");
    expect([...container.querySelectorAll(".app-bar-links a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Tổng quan", "#a-overview"], ["Hỏi đáp", "#a-faq"]]);
    expect(container.querySelector(".app-bar-cta-long")?.textContent).toBe("Tải cho macOS");
    expect(container.querySelector(".app-bar-cta-short")?.textContent).toBe("Tải");
  });

  it("opens the sections sheet from the app's name, with the way back to every app, and closes it on Escape", async () => {
    const toggle = container.querySelector<HTMLButtonElement>(".app-bar-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { toggle.click(); });
    const sheet = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect([...sheet!.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/apps", "#a-overview", "#a-faq"]);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".app-bar-sheet")).toBeNull();
  });

  it("closes the sheet once a section is chosen", async () => {
    await act(async () => { container.querySelector<HTMLButtonElement>(".app-bar-toggle")?.click(); });
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(async () => { container.querySelector<HTMLAnchorElement>(".app-bar-sheet a[href='#a-faq']")?.click(); });
    expect(container.querySelector(".app-bar-sheet")).toBeNull();
  });
});
