import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { QueryProvider } from "@uniwork/core/provider";

// The transport is the only mock: the header reads the session, the workspace list and the public config through it.
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

const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};
const pilotStores = { testflight: "https://testflight.apple.com/join/AbCdEf12", play_internal: "https://play.google.com/apps/internaltest/4701234567890" };

async function render(config: unknown = { flags: {} }, userAgent?: string): Promise<void> {
  if (userAgent) vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  request.mockImplementation((path: string) => (path.startsWith("/api/v1/config") ? Promise.resolve(config) : Promise.reject(new Error("signed out"))));
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(SiteHeader))); });
}
async function openApps(): Promise<Element> {
  await act(async () => { toggleButtons()[1]?.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container.querySelector("#header-directory-apps")!;
}
const links = (scope: Element) => [...scope.querySelectorAll<HTMLAnchorElement>(":scope > a")].map((a) => [a.textContent, a.getAttribute("href")]);
const hrefs = (scope: Element, selector: string) => [...scope.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => a.getAttribute("href"));
const toggleButtons = () => [...container.querySelectorAll<HTMLButtonElement>(".header-directory-toggle")];
const toggles = () => toggleButtons().map((button) => button.textContent);

beforeEach(async () => {
  await setLocale("vi");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  vi.restoreAllMocks();
  act(() => root.unmount());
  container.remove();
  request.mockReset();
});

describe("the landing header's Apps menu", () => {
  it("is a directory group between Products and Solutions, followed by Pricing and Changelog", async () => {
    await render();
    const nav = container.querySelector(".header-navigation");
    expect(nav).not.toBeNull();
    expect(toggles()).toEqual(["Sản phẩm", "Ứng dụng", "Giải pháp", "Tìm hiểu"]);
    expect(links(nav!)).toEqual([["Bảng giá", "/pricing"], ["Nhật ký cập nhật", "/changelog"]]);
  });

  it("lists every app of the catalogue, announces Office for Personal without a link, and leads to the hub", async () => {
    await render();
    const toggle = toggleButtons()[1];
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    const directory = await openApps();
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(hrefs(directory, ".header-apps-list a")).toEqual(["/", "/apps/office", "/apps/unichat"]);
    expect([...directory.querySelectorAll(".header-apps-list a strong")].map((s) => s.textContent)).toEqual(["UniWork", "UniWork Office", "UniChat"]);
    const personal = directory.querySelector("[data-office-personal]");
    expect(personal?.textContent).toContain("Office for Personal");
    expect(personal?.textContent).toContain("Đang phát triển");
    expect(personal?.closest("a")).toBeNull();
    expect(directory.querySelector(".header-apps-all")?.getAttribute("href")).toBe("/apps");
  });

  it("points the visitor's quick downloads at each app's download section, with the formats it ships", async () => {
    const url = "https://downloads.test/UniWork-Office.exe";
    await render({ flags: {}, office_installers: { stable: [{ platform: "win32-x64", kind: ".exe", url }] } }, UA.windows);
    const directory = await openApps();
    expect(directory.querySelector(".header-quick .header-apps-title")?.textContent).toBe("Máy của bạn · Windows");
    expect(hrefs(directory, ".header-quick a")).toEqual(["/apps/office#office-download", "/apps/unichat#unichat-download", "/apps/unichat#unichat-download", "/login"]);
    expect(directory.querySelector(".header-quick-row small")?.textContent).toBe("x64 · .exe");
    // The menu never hands out the file itself: the app page settles the chip and the format.
    expect(directory.querySelector(`a[href='${url}']`)).toBeNull();
    expect(directory.querySelector(".header-quick-get")?.textContent).toBe("Tải UniWork Office");
  });

  it("tags UniChat's phone builds as a pilot only while every published one is", async () => {
    await render({ flags: {}, unichat_stores: pilotStores });
    expect((await openApps()).querySelector("a[href='/apps/unichat'] .app-tag")?.textContent).toBe("Điện thoại: thử nghiệm");
    act(() => root.unmount());
    root = createRoot(container);
    await render({ flags: {}, unichat_stores: { ...pilotStores, ios: "https://apps.apple.com/app/unichat/id1234567890" } });
    expect((await openApps()).querySelector("a[href='/apps/unichat'] .app-tag")).toBeNull();
  });

  it("puts UniChat first on a phone and offers no desktop rows there", async () => {
    await render({ flags: {} }, UA.iphone);
    const directory = await openApps();
    expect(hrefs(directory, ".header-apps-list a")).toEqual(["/apps/unichat", "/", "/apps/office"]);
    expect(directory.querySelectorAll(".header-quick-row")).toHaveLength(0);
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
    expect([...menu!.querySelectorAll("details > summary")].map((summary) => summary.textContent)).toEqual(["Sản phẩm", "Ứng dụng", "Giải pháp", "Tìm hiểu"]);
    expect([...menu!.querySelectorAll<HTMLAnchorElement>(":scope > a.mobile-route-link")][0]?.getAttribute("href")).toBe("/pricing");
    expect(menu!.querySelector(":scope > a[href='/changelog']")?.textContent).toBe("Nhật ký cập nhật");
    const apps = menu!.querySelectorAll("details")[1];
    expect(apps?.querySelector(".header-apps-list a")?.getAttribute("href")).toBe("/");
    expect(apps?.querySelector("[data-office-personal]")).not.toBeNull();
    // jsdom cannot navigate; the click only has to reach the link's own handler.
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(async () => { apps?.querySelector<HTMLAnchorElement>("a[href='/apps/office']")?.click(); });
    expect(container.querySelector("#landing-mobile-menu")).toBeNull();
  });

  it("is labelled Apps in English", async () => {
    await setLocale("en");
    await render();
    expect(toggles()[1]).toBe("Apps");
    expect((await openApps()).querySelector("[data-office-personal]")?.textContent).toContain("In development");
  });
});
