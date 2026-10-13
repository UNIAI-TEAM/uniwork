import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { QueryProvider } from "@uniwork/core/provider";

// The transport is the only mock: the header reads the session and the workspace list through it.
const request = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => request(...a),
}));

// Theme and language menus need providers the header test has no use for.
vi.mock("@uniwork/views/layout/preference-menus", () => ({ ThemeMenu: () => null, LocaleMenu: () => null }));

import { SiteHeader } from "./site-header";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

async function render(): Promise<void> {
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(SiteHeader))); });
}
const links = (scope: Element) => [...scope.querySelectorAll<HTMLAnchorElement>(":scope > a")].map((a) => [a.textContent, a.getAttribute("href")]);

beforeEach(async () => {
  request.mockRejectedValue(new Error("signed out"));
  await setLocale("vi");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  request.mockReset();
});

describe("the landing header's Office menu", () => {
  it("sits after AI teammates and before Pricing in the desktop navigation", async () => {
    await render();
    const nav = container.querySelector(".header-navigation");
    expect(nav).not.toBeNull();
    expect(links(nav!)).toEqual([
      ["Nhân sự AI", "/features/agents"],
      ["Office", "/office"],
      ["Bảng giá", "/pricing"],
      ["Doanh nghiệp", "/enterprise"],
      ["Nhật ký cập nhật", "/changelog"],
    ]);
  });

  it("is in the mobile menu in the same place, and closes the menu when followed", async () => {
    await render();
    await act(async () => { container.querySelector<HTMLButtonElement>(".header-mobile-toggle")?.click(); });
    const menu = container.querySelector("#landing-mobile-menu");
    expect(menu).not.toBeNull();
    const routes = [...menu!.querySelectorAll<HTMLAnchorElement>(":scope > a.mobile-route-link")].map((a) => a.getAttribute("href"));
    expect(routes.slice(0, 4)).toEqual(["/features/agents", "/office", "/pricing", "/enterprise"]);
    // jsdom cannot navigate; the click only has to reach the link's own handler.
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(async () => { menu!.querySelector<HTMLAnchorElement>("a[href='/office']")?.click(); });
    expect(container.querySelector("#landing-mobile-menu")).toBeNull();
  });

  it("is labelled Office in English too", async () => {
    await setLocale("en");
    await render();
    expect(container.querySelector(".header-navigation a[href='/office']")?.textContent).toBe("Office");
  });
});
