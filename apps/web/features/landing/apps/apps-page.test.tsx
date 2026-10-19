import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { paths } from "@uniwork/core/paths";
import { QueryProvider } from "@uniwork/core/provider";

// The transport is the only mock (the real config schema reads the answer); the shell is a pass-through.
const request = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => request(...a),
}));
vi.mock("../marketing-shell", () => ({ MarketingShell: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));

import { AppsPage } from "./apps-page";
import viMessages from "@uniwork/core/i18n/locales/vi.json";
import enMessages from "@uniwork/core/i18n/locales/en.json";

const office = { stable: [
  { platform: "darwin-arm64", kind: ".dmg", url: "https://downloads.test/office-arm64.dmg" },
  { platform: "win32-x64", kind: ".exe", url: "https://downloads.test/office-x64.exe" },
] };
const chat = { dev: [{ platform: "win32-x64", kind: ".exe", url: "https://downloads.test/unichat-x64.exe" }] };
const stores = { ios: "https://apps.apple.com/app/unichat/id1234567890", android: "https://play.google.com/store/apps/details?id=com.uniworkos.chat", testflight: "", play_internal: "" };
const pilot = { testflight: "https://testflight.apple.com/join/AbCdEf12", play_internal: "https://play.google.com/apps/internaltest/4701234567890" };
const full = { flags: {}, office_installers: office, unichat_installers: chat, unichat_stores: stores };
const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

// jsdom's own user agent names the host system, so every test pins one.
async function render(config: unknown, userAgent: string = UA.windows): Promise<void> {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  request.mockResolvedValue(config);
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(AppsPage))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const hrefs = (selector: string) => [...container.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => a.getAttribute("href"));
const cell = (app: string, column: number) => container.querySelectorAll(`tr[data-app=${app}] td`)[column]!;

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

describe("the apps hub", () => {
  it.each(["vi", "en"] as const)("puts every app on one shared base, then the builds and four questions in %s", async (language) => {
    await setLocale(language);
    await render(full);
    const hub = (language === "vi" ? viMessages : enMessages).landing.apps;
    expect(container.querySelector("h1")?.textContent).toBe(`${hub.hub.title1}${hub.hub.title2}`);
    expect([...container.querySelectorAll(".hub-card h3")].map((h) => h.textContent)).toEqual([hub.catalog.web.name, hub.catalog.office.name, hub.catalog.unichat.name]);
    expect(container.querySelectorAll(".hub-base-items li")).toHaveLength(4);
    expect([...container.querySelectorAll("#apps-faq .app-faq-q")].map((q) => q.textContent)).toEqual([hub.hub.faq.q1, hub.hub.faq.q2, hub.hub.faq.q3, hub.hub.faq.q4]);
    expect(container.textContent).not.toContain("landing.");
  });

  it("names the visitor's system and leads each installable app to its own download section", async () => {
    await render(full);
    expect(container.querySelector(".hub-hero .app-actions a")?.textContent).toBe("Xem bản tải cho Windows");
    expect(hrefs(".hub-hero .app-actions a")).toEqual(["#apps-download", paths.login()]);
    expect(container.querySelector(".hub-me")?.textContent).toBe("Máy của bạn: Windows");
    expect(hrefs(".hub-card[data-app=office] .hub-card-actions a")).toEqual([`${paths.apps.office()}#office-download`, paths.apps.office()]);
    expect(hrefs(".hub-card[data-app=unichat] .hub-card-actions a")).toEqual([`${paths.apps.unichat()}#unichat-download`, paths.apps.unichat()]);
    expect(container.querySelector(".hub-card[data-app=office] .hub-card-actions a")?.textContent).toBe("Tải cho Windows");
    expect(container.querySelector(".hub-card[data-app=office] .app-tag")?.textContent).toBe("Đang phát triển");
  });

  it("tables every published build per system, tints the visitor's column and marks the empty cells", async () => {
    await render(full);
    expect([...container.querySelectorAll(".hub-table thead th")].map((th) => th.textContent)).toEqual(["Ứng dụng", "macOS", "Windows", "Linux", "iPhone", "Android", "Web"]);
    expect(container.querySelector(".hub-table thead .is-own")?.textContent).toBe("Windows");
    expect(hrefs("tr[data-app=office] a[download]")).toEqual(office.stable.map((row) => row.url));
    expect(cell("office", 1).classList.contains("is-own")).toBe(true);
    expect(cell("office", 3).textContent).toBe("—Không có bản");
    expect(cell("unichat", 0).textContent).toBe("—Không có bản");
    expect(hrefs("tr[data-app=unichat] [data-unichat-store]")).toEqual([stores.ios, stores.android]);
    expect(hrefs("tr[data-app=web] a")).toEqual([paths.login()]);
    expect(container.querySelector(".hub-card[data-app=unichat] .app-tag")).toBeNull();
    expect(container.querySelectorAll(".hub-note")).toHaveLength(1);
  });

  it("says the phone builds are a pilot while only pilot links exist", async () => {
    await render({ ...full, unichat_stores: pilot });
    expect(container.querySelector(".hub-card[data-app=unichat] .hub-card-note")?.textContent).toBe(`Thử nghiệm${viMessages.landing.apps.catalog.unichat.pilot}`);
    expect(cell("unichat", 3).textContent).toBe("TestFlightThử nghiệm");
    expect(container.querySelectorAll(".hub-note")).toHaveLength(2);
  });

  it("shows a phone what installs on it, with the desktop builds one tap away", async () => {
    await render(full, UA.iphone);
    expect(container.querySelector(".hub-table")).toBeNull();
    expect(container.querySelector("#apps-download-title")?.textContent).toBe("Cho chiếc iPhone này");
    expect(container.querySelector(".hub-phone-cta")?.getAttribute("href")).toBe(stores.ios);
    expect(container.querySelector(".hub-phone-cta")?.textContent).toBe("Mở App Store");
    expect(container.querySelector(".hub-phone-row[data-app=office] a")).toBeNull();
    expect(hrefs(".hub-card[data-app=office] .hub-card-actions a")).toEqual([paths.apps.office(), paths.login()]);
    const disclosure = container.querySelector<HTMLButtonElement>(".hub-disc")!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { disclosure.click(); });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(hrefs(".hub-desk a")).toEqual([chat.dev[0]!.url, stores.android, ...office.stable.map((row) => row.url)]);
  });

  it("keeps a loading table until the config arrives, then fills it", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    request.mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(UA.windows);
    await act(async () => { root.render(createElement(QueryProvider, null, createElement(AppsPage))); });
    expect(container.querySelector(".hub-table-box")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    await act(async () => { resolve(full); });
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(container.querySelector(".hub-table-box")?.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelectorAll("[download]")).toHaveLength(3);
  });

  it("recovers the catalogue through its visible retry", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    await render(full);
    expect(container.querySelector("#apps-download [role=alert]")?.textContent).toContain("Không tải được danh sách bản cài đặt");
    await act(async () => { container.querySelector<HTMLButtonElement>("#apps-download [role=alert] button")?.click(); });
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(container.querySelector("#apps-download [role=alert]")).toBeNull();
    expect(container.querySelectorAll("[download]")).toHaveLength(3);
  });

  it("degrades to empty cells when the config answer drifts", async () => {
    await render({ office_installers: [1], unichat_stores: { ios: "javascript:alert(1)" } });
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelectorAll("#apps-download [download], #apps-download [data-unichat-store]")).toHaveLength(0);
    expect(container.querySelectorAll("tr[data-app=office] .hub-none")).toHaveLength(5);
  });
});
