import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { QueryProvider } from "@uniwork/core/provider";

// The transport is the only mock (the real config schema reads the answer); the shell is a
// pass-through because header, footer and closing banner have their own coverage.
const request = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => request(...a),
}));
vi.mock("./marketing-shell", () => ({ MarketingShell: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
// The FAQ keeps its own coverage; the stand-in prints the answers so the copy scan reads them too.
vi.mock("./faq", async () => {
  const { useTranslation } = await import("react-i18next");
  return {
    Faq: ({ namespace, count }: { namespace: string; count: number }) => {
      const { t } = useTranslation();
      return createElement("div", { "data-faq": namespace, "data-count": count }, Array.from({ length: count }, (_, i) => t(`${namespace}.a${i + 1}`)).join(" "));
    },
  };
});

import { OfficePage } from "./office-page";
import { OfficeHeroDownloads } from "./office-downloads";
import viMessages from "@uniwork/core/i18n/locales/vi.json";
import enMessages from "@uniwork/core/i18n/locales/en.json";

const url = (name: string) => `https://downloads.uniwork.test/office/${name}`;
const installers = {
  stable: [
    { platform: "darwin-arm64", kind: ".dmg", url: url("UniWork-Office-1.2.0-arm64.dmg"), version: "1.2.0" },
    { platform: "darwin-x64", kind: ".dmg", url: url("UniWork-Office-1.2.0-x64.dmg"), version: "1.2.0" },
    { platform: "win32-x64", kind: ".exe", url: url("UniWork-Office-1.2.0-x64.exe"), version: "1.2.0", unsigned: true },
    { platform: "linux-x64-deb", kind: ".deb", url: url("UniWork-Office-1.2.0-amd64.deb"), version: "1.2.0" },
  ],
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scrollIntoView = vi.fn();
let root: Root;
let container: HTMLDivElement;

async function render(config: unknown, component = OfficePage): Promise<void> {
  request.mockResolvedValue(config);
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(component))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const hrefs = (selector: string) => [...container.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => a.getAttribute("href"));
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
/** The visitor's browser: a user agent and, for Chromium, the client hints it would answer. */
function browser(userAgent: string, hints?: { platform: string; architecture: string }): void {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  if (hints) Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { platform: hints.platform, mobile: false, getHighEntropyValues: () => Promise.resolve({ architecture: hints.architecture, bitness: "64" }) } });
}

beforeEach(async () => {
  Element.prototype.scrollIntoView = scrollIntoView;
  await setLocale("vi");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "userAgentData");
  act(() => root.unmount());
  container.remove();
  request.mockReset();
  scrollIntoView.mockReset();
});

const renderHero = (config: unknown) => render(config, OfficeHeroDownloads);

describe("the Office page", () => {
  it("keeps one editor selector and the selected example, without a second use-case grid", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("h1")?.textContent).toBe("UniWork Office");
    expect(container.querySelectorAll("[role=tab]")).toHaveLength(6);
    expect(container.querySelectorAll("[role=tabpanel]")).toHaveLength(1);
    expect(container.querySelector(".office-editor-example")?.getAttribute("data-office-example")).toBe("draft");
    expect(container.querySelectorAll(".office-task, .office-trust, .office-editions")).toHaveLength(0);
    expect(container.querySelector("[data-faq]")?.getAttribute("data-count")).toBe("6");
  });

  it("offers every published variant in the catalogue, without guessed download links", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(hrefs(".office-download-columns a[download]")).toEqual(installers.stable.map(row => row.url));
    expect(container.querySelector(".office-hero-actions a")?.getAttribute("href")).toBe("#office-download");
    expect(hrefs(".office-hero-actions a")).toContain("/request-demo");
    expect(container.querySelector(".office-download-column[data-office-os=windows] small")?.textContent).toContain("chưa ký số");
    expect(container.querySelector("#office-download-title")?.parentElement?.textContent).toContain("Phiên bản 1.2.0");
  });

  it("keeps the page usable when no installers are published", async () => {
    await render({ flags: {}, office_installers: { stable: [] } });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(container.textContent).toContain(viMessages.landing.office.download.unavailable);
  });

  it("degrades to the same state when the config answer drifts", async () => {
    await render({ unexpected: true });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelector("h1")?.textContent).toBe("UniWork Office");
  });

  it("changes the example, capabilities and media together when an editor is selected", async () => {
    await render({ flags: {}, office_installers: installers });
    await act(async () => { container.querySelectorAll<HTMLButtonElement>("[role=tab]")[1]?.click(); });
    expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Bảng tính");
    expect(container.querySelector(".office-editor-example")?.getAttribute("data-office-example")).toBe("data");
    expect(container.querySelector("[role=tabpanel]")?.textContent).toContain(viMessages.landing.office.tasks.data.description);
    expect(container.querySelector("#office-editor-summary-title")?.textContent).toBe(viMessages.landing.office.editors.sheets.title);
    expect(new URL(container.querySelector<HTMLImageElement>(".office-shot img")!.src).pathname).toBe("/landing/office/sheets.vi.webp");
  });

  it.each(["vi", "en"] as const)("keeps storage, connectivity and AI routing facts accessible in %s", async language => {
    await setLocale(language);
    await render({ flags: {}, office_installers: installers });
    const messages = language === "vi" ? viMessages : enMessages;
    expect(container.querySelectorAll(".office-connection-points li")).toHaveLength(3);
    expect(container.querySelector(".office-file-flow")?.textContent).toContain(messages.landing.office.connection.flow.note);
    const triggers = container.querySelectorAll<HTMLButtonElement>(".office-connection [data-slot=accordion-trigger]");
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { triggers[0]?.click(); });
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("true");
    const ai = container.querySelector(".office-connection [data-slot=accordion-content][data-open]");
    expect(ai?.textContent).toContain(messages.landing.office.ai.account.description);
    expect(ai?.textContent).toContain(messages.landing.office.faq.a4);
    await act(async () => { triggers[1]?.click(); });
    expect(container.querySelector(".office-connection [data-slot=accordion-content][data-open]")?.textContent).toContain(messages.landing.office.ai.files.description);
    expect(container.textContent).not.toMatch(/github|genspark|genoffice|open[- ]source|mã nguồn mở|miễn phí|ad-free|không quảng cáo|image generation|tạo ảnh|sinh ảnh|data stays in your workspace|dữ liệu vẫn ở workspace|only sent to AI|chỉ được gửi cho AI/i);
  });

  it("keeps the catalogue's loading shell until the config arrives", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    request.mockReturnValue(new Promise(done => { resolve = done; }));
    await act(async () => { root.render(createElement(QueryProvider, null, createElement(OfficePage))); });
    await tick();
    expect(container.querySelectorAll(".office-download-columns[aria-busy] .office-download-column")).toHaveLength(3);
    expect(container.querySelectorAll("[download], [role=alert], [role=status]")).toHaveLength(0);
    await act(async () => { resolve({ flags: {}, office_installers: installers }); });
    await tick();
    expect(container.querySelector(".office-download-columns")?.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelectorAll("[download]")).toHaveLength(4);
  });

  it("recovers the installer catalogue through its visible retry", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(1);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Không tải được danh sách bản cài đặt");
    await act(async () => { container.querySelector<HTMLButtonElement>("[role=alert] button")?.click(); });
    await tick();
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(0);
    expect(container.querySelectorAll("[download]")).toHaveLength(4);
  });

  it("keeps editor details available after a failed image, then recovers on tab change", async () => {
    await render({ flags: {}, office_installers: installers });
    await act(async () => { container.querySelector(".office-shot img")?.dispatchEvent(new Event("error")); });
    expect(container.querySelector(".office-preview-error")?.textContent).toBe(viMessages.landing.office.editors.imageUnavailable);
    expect(container.querySelector(".office-editor-example")?.textContent).toContain(viMessages.landing.office.tasks.draft.description);
    await act(async () => { container.querySelectorAll<HTMLButtonElement>("[role=tab]")[1]?.click(); });
    expect(container.querySelector(".office-preview-error")).toBeNull();
    expect(container.querySelectorAll(".office-shot img")).toHaveLength(2);
  });
});

// Standalone download-button behavior remains covered independently of the page's catalogue.
describe("OfficeHeroDownloads", () => {
  it.each([
    ["Apple Silicon", "arm", "UniWork-Office-1.2.0-arm64.dmg"],
    ["Intel", "x86", "UniWork-Office-1.2.0-x64.dmg"],
  ])("picks the %s build for a Mac whose chip the browser proves, keeping the variants beneath", async (_chip, architecture, file) => {
    browser(MAC_SAFARI, { platform: "macOS", architecture });
    await renderHero({ flags: {}, office_installers: installers });
    expect(hrefs(".office-os[data-office-os=macos] .office-os-button")).toEqual([url(file)]);
    expect(hrefs(".office-os[data-office-os=macos] .office-os-variants a")).toEqual([url("UniWork-Office-1.2.0-arm64.dmg"), url("UniWork-Office-1.2.0-x64.dmg")]);
    expect(container.querySelector(".office-os-help")).toBeNull();
  });

  it("shows both Mac builds with a hint when the chip cannot be told", async () => {
    browser(MAC_SAFARI);
    await renderHero({ flags: {}, office_installers: installers });
    const mac = container.querySelector(".office-os[data-office-os=macos]");
    expect([...mac?.querySelectorAll(".office-os-button") ?? []].map((a) => a.textContent)).toEqual(["Tải cho Mac Apple Silicon", "Tải cho Mac Intel"]);
    expect(mac?.querySelector(".office-os-help")?.textContent).toContain("Giới thiệu về máy Mac");
  });

  it("shows the only published Mac build as the one button", async () => {
    browser(MAC_SAFARI);
    await renderHero({ flags: {}, office_installers: { stable: installers.stable.filter((row) => row.platform !== "darwin-x64") } });
    expect(hrefs(".office-os[data-office-os=macos] .office-os-button")).toEqual([url("UniWork-Office-1.2.0-arm64.dmg")]);
  });

  it("leads Linux with the visitor's format and falls back to the first published one", async () => {
    browser(LINUX_UA, { platform: "Linux", architecture: "x86" });
    const both = [...installers.stable, { platform: "linux-x64-appimage", kind: ".AppImage", url: url("UniWork-Office-1.2.0.AppImage"), version: "1.2.0" }];
    await renderHero({ flags: {}, office_installers: { stable: both } });
    expect(hrefs(".office-os[data-office-os=linux] .office-os-button")).toEqual([url("UniWork-Office-1.2.0-amd64.deb")]);
    act(() => root.unmount());
    root = createRoot(container);
    await renderHero({ flags: {}, office_installers: { stable: both.filter((row) => row.platform !== "linux-x64-deb") } });
    expect(hrefs(".office-os[data-office-os=linux] .office-os-button")).toEqual([url("UniWork-Office-1.2.0.AppImage")]);
  });

});
