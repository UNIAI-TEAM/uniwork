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
const toggleButtons = () => [...container.querySelectorAll<HTMLButtonElement>(".header-directory-toggle")];
const toggles = () => toggleButtons().map((button) => button.textContent);

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
  it("is a directory group between Solutions and Learn, followed by Pricing and Changelog", async () => {
    await render();
    const nav = container.querySelector(".header-navigation");
    expect(nav).not.toBeNull();
    expect(toggles()).toEqual(["Sản phẩm", "Giải pháp", "Office", "Tìm hiểu"]);
    expect(links(nav!)).toEqual([["Bảng giá", "/pricing"], ["Nhật ký cập nhật", "/changelog"]]);
  });

  it("opens the Office directory with the business edition link and the personal edition note", async () => {
    await render();
    const toggle = toggleButtons()[2];
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { toggle?.click(); });
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    const directory = container.querySelector("#header-directory-office");
    expect(directory?.querySelectorAll("a")).toHaveLength(1);
    expect(directory?.querySelector("a")?.getAttribute("href")).toBe("/office#office-business");
    expect(directory?.querySelector("a")?.textContent).toContain("Office for Enterprise");
    expect(directory?.querySelector("[data-office-personal]")?.textContent).toContain("Office for Personal");
    expect(directory?.querySelector("[data-office-personal]")?.textContent).toContain("Đang phát triển");
  });

  it("shows the changelog in the top bar without repeating it in Learn", async () => {
    await render();
    await act(async () => { toggleButtons()[3]?.click(); });
    expect(container.querySelector("#header-directory-learn a[href='/changelog']")).toBeNull();
    expect(container.querySelector(".header-navigation > a[href='/changelog']")?.textContent).toBe("Nhật ký cập nhật");
  });

  it("is in the mobile menu in the same place, and closes the menu when followed", async () => {
    await render();
    await act(async () => { container.querySelector<HTMLButtonElement>(".header-mobile-toggle")?.click(); });
    const menu = container.querySelector("#landing-mobile-menu");
    expect(menu).not.toBeNull();
    expect([...menu!.querySelectorAll("details > summary")].map((summary) => summary.textContent)).toEqual(["Sản phẩm", "Giải pháp", "Office", "Tìm hiểu"]);
    expect([...menu!.querySelectorAll<HTMLAnchorElement>(":scope > a.mobile-route-link")][0]?.getAttribute("href")).toBe("/pricing");
    expect(menu!.querySelector(":scope > a[href='/changelog']")?.textContent).toBe("Nhật ký cập nhật");
    const office = menu!.querySelectorAll("details")[2];
    expect(office?.querySelector("a")?.getAttribute("href")).toBe("/office#office-business");
    expect(office?.querySelector("[data-office-personal]")).not.toBeNull();
    // jsdom cannot navigate; the click only has to reach the link's own handler.
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(async () => { office?.querySelector<HTMLAnchorElement>("a")?.click(); });
    expect(container.querySelector("#landing-mobile-menu")).toBeNull();
  });

  it("is labelled Office in English too", async () => {
    await setLocale("en");
    await render();
    expect(toggles()[2]).toBe("Office");
    await act(async () => { toggleButtons()[2]?.click(); });
    expect(container.querySelector("#header-directory-office [data-office-personal]")?.textContent).toContain("In development");
  });
});
