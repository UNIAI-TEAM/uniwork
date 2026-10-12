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

async function render(config: unknown): Promise<void> {
  request.mockResolvedValue(config);
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(OfficePage))); });
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

describe("the Office page", () => {
  it("lays out the sections in order, each with its own copy", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("h1")?.textContent).toBe("UniWork Office");
    const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent);
    expect(headings).toEqual([
      "Sáu trình soạn thảo. Một workspace.",
      "Từ việc cần làm đến file hoàn chỉnh",
      "AI có sẵn, file vẫn nằm trong workspace của nhóm",
      "Tải UniWork Office",
      "Làm việc cùng UniWork",
    ]);
    expect(container.querySelectorAll("[role=tab]")).toHaveLength(6);
    expect(container.querySelectorAll(".office-block")).toHaveLength(6);
    expect(container.querySelectorAll(".office-task")).toHaveLength(6);
    expect(container.querySelector("[data-faq]")?.getAttribute("data-count")).toBe("6");
  });

  it("offers the published installers per OS, straight from the config, and hides the rest", async () => {
    await render({ flags: {}, office_installers: installers });
    expect([...container.querySelectorAll(".office-hero-downloads [data-office-os]")].map((el) => el.getAttribute("data-office-os"))).toEqual(["macos", "windows", "linux"]);
    // This browser proves nothing about its Mac chip, so macOS offers both builds instead of a guess.
    expect(hrefs(".office-hero-downloads .office-os-button")).toEqual([url("UniWork-Office-1.2.0-arm64.dmg"), url("UniWork-Office-1.2.0-x64.dmg"), url("UniWork-Office-1.2.0-x64.exe"), url("UniWork-Office-1.2.0-amd64.deb")]);
    expect(hrefs(".office-os[data-office-os=windows] .office-os-variants a")).toEqual([url("UniWork-Office-1.2.0-x64.exe")]);
    // Not published: no Windows zip, no AppImage, so no link to either.
    const all = hrefs("a");
    expect(all.some((href) => href?.endsWith(".zip") || href?.endsWith(".AppImage"))).toBe(false);
    expect(container.querySelector(".office-download-column[data-office-os=windows] small")?.textContent).toContain("chưa ký số");
    expect(container.querySelector("#office-download-title")?.parentElement?.textContent).toContain("Phiên bản 1.2.0");
  });

  it("says so instead of showing dead buttons when nothing is published", async () => {
    await render({ flags: {}, office_installers: { stable: [] } });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelectorAll("[role=status]")).toHaveLength(2);
    expect(container.textContent).toContain("Bản cài đặt đang được chuẩn bị");
  });

  it("degrades to the same state when the config answer drifts", async () => {
    await render({ unexpected: true });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelector("h1")?.textContent).toBe("UniWork Office");
  });

  it("opens the editor a task card names", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Văn bản");
    const link = container.querySelectorAll<HTMLButtonElement>(".office-task-link")[1];
    await act(async () => { link?.click(); });
    expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Bảng tính");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("speaks English and keeps clear of claims UniWork does not make", async () => {
    await setLocale("en");
    browser(MAC_SAFARI, { platform: "macOS", architecture: "arm" });
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("h2")?.textContent).toBe("Six editors. One workspace.");
    expect(container.querySelector(".office-os-button")?.textContent).toBe("Download for macOS");
    for (const language of ["vi", "en"] as const) {
      await setLocale(language);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(container.textContent).not.toMatch(/github|genspark|genoffice|open[- ]source|mã nguồn mở|miễn phí|ad-free|không quảng cáo/i);
      // Image generation is off today: the page names only the cloud tools that ship.
      expect(container.textContent).not.toMatch(/image generation|generate images?|generated images?|ai image|tạo ảnh|sinh ảnh|ảnh bằng ai|ảnh do ai/i);
      // Content does go to a model provider when AI is used, so neither "stays in your workspace" nor "only when you ask" may come back.
      expect(container.textContent).not.toMatch(/data stays in your workspace|dữ liệu vẫn ở workspace|only sent to AI|chỉ được gửi cho AI/i);
    }
  });

  it("says where AI content goes in the privacy copy, in both languages", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("[data-faq]")?.textContent).toContain("khóa API riêng");
    expect(container.querySelector("#office-ai-title")?.textContent).toBe("AI có sẵn, file vẫn nằm trong workspace của nhóm");
    await setLocale("en");
    await tick();
    expect(container.querySelector("#office-ai-title")?.textContent).toBe("AI built in, your files stay in your team's workspace");
    expect(container.querySelector("[data-faq]")?.textContent).toContain("your own API key");
    expect(container.querySelector(".office-ai-points")?.textContent).toContain("without going through UniWork servers");
  });

  it("names the cloud tools that ship and states the offline claim with its limits, in both languages", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector(".office-ai-points")?.textContent).toContain("tìm kiếm web, tìm kiếm ảnh và chuyển giọng nói thành văn bản");
    expect(container.querySelector(".office-trust")?.textContent).toContain("Sửa file trên máy không cần kết nối; AI cloud và tài liệu UniWork cần kết nối");
    await setLocale("en");
    await tick();
    expect(container.querySelector(".office-ai-points")?.textContent).toContain("web search, image search and transcription");
    expect(container.querySelector(".office-trust")?.textContent).toContain("Edit files on your computer without a connection; cloud AI and UniWork documents need one");
    expect(container.querySelector("[data-faq]")?.textContent).toContain("Cloud AI and UniWork documents");
  });

  it.each([
    ["Apple Silicon", "arm", "UniWork-Office-1.2.0-arm64.dmg"],
    ["Intel", "x86", "UniWork-Office-1.2.0-x64.dmg"],
  ])("picks the %s build for a Mac whose chip the browser proves, keeping the variants beneath", async (_chip, architecture, file) => {
    browser(MAC_SAFARI, { platform: "macOS", architecture });
    await render({ flags: {}, office_installers: installers });
    expect(hrefs(".office-os[data-office-os=macos] .office-os-button")).toEqual([url(file)]);
    expect(hrefs(".office-os[data-office-os=macos] .office-os-variants a")).toEqual([url("UniWork-Office-1.2.0-arm64.dmg"), url("UniWork-Office-1.2.0-x64.dmg")]);
    expect(container.querySelector(".office-os-help")).toBeNull();
  });

  it("shows both Mac builds with a hint when the chip cannot be told", async () => {
    browser(MAC_SAFARI);
    await render({ flags: {}, office_installers: installers });
    const mac = container.querySelector(".office-os[data-office-os=macos]");
    expect([...mac?.querySelectorAll(".office-os-button") ?? []].map((a) => a.textContent)).toEqual(["Tải cho Mac Apple Silicon", "Tải cho Mac Intel"]);
    expect(mac?.querySelector(".office-os-help")?.textContent).toContain("Giới thiệu về máy Mac");
  });

  it("shows the only published Mac build as the one button", async () => {
    browser(MAC_SAFARI);
    await render({ flags: {}, office_installers: { stable: installers.stable.filter((row) => row.platform !== "darwin-x64") } });
    expect(hrefs(".office-os[data-office-os=macos] .office-os-button")).toEqual([url("UniWork-Office-1.2.0-arm64.dmg")]);
  });

  it("leads Linux with the visitor's format and falls back to the first published one", async () => {
    browser(LINUX_UA, { platform: "Linux", architecture: "x86" });
    const both = [...installers.stable, { platform: "linux-x64-appimage", kind: ".AppImage", url: url("UniWork-Office-1.2.0.AppImage"), version: "1.2.0" }];
    await render({ flags: {}, office_installers: { stable: both } });
    expect(hrefs(".office-os[data-office-os=linux] .office-os-button")).toEqual([url("UniWork-Office-1.2.0-amd64.deb")]);
    act(() => root.unmount());
    root = createRoot(container);
    await render({ flags: {}, office_installers: { stable: both.filter((row) => row.platform !== "linux-x64-deb") } });
    expect(hrefs(".office-os[data-office-os=linux] .office-os-button")).toEqual([url("UniWork-Office-1.2.0.AppImage")]);
  });

  it("renders the OS button shell at once, so nothing shifts when the config arrives", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    request.mockReturnValue(new Promise((done) => { resolve = done; }));
    await act(async () => { root.render(createElement(QueryProvider, null, createElement(OfficePage))); });
    await tick();
    const hero = container.querySelector(".office-hero-downloads");
    expect(hero?.getAttribute("aria-busy")).toBe("true");
    expect(hero?.querySelectorAll(".office-os")).toHaveLength(3);
    expect(hero?.querySelectorAll(".office-os-button.office-skeleton")).toHaveLength(3);
    expect(container.querySelectorAll(".office-download-columns[aria-busy] .office-download-column")).toHaveLength(3);
    expect(container.querySelectorAll("[download], [role=alert], [role=status]")).toHaveLength(0);
    await act(async () => { resolve({ flags: {}, office_installers: installers }); });
    await tick();
    const loaded = container.querySelector(".office-hero-downloads");
    expect(loaded?.hasAttribute("aria-busy")).toBe(false);
    expect(loaded?.querySelectorAll(".office-os")).toHaveLength(3);
    expect(loaded?.querySelector(".office-skeleton")).toBeNull();
  });

  it("shows a visible error with a retry when the config cannot be loaded", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    const alerts = container.querySelectorAll("[role=alert]");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.textContent).toContain("Không tải được danh sách bản cài đặt");
    expect(container.textContent).not.toContain("đang được chuẩn bị");
    const retry = alerts[0]?.querySelector("button");
    expect(retry?.textContent).toBe("Thử lại");
    await act(async () => { retry?.click(); });
    await tick();
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(0);
    expect(container.querySelectorAll(".office-hero-downloads [download]").length).toBeGreaterThan(0);
  });

  it("drops a frame whose image had already failed before it could report an error", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll(".office-shot")).toHaveLength(0);
  });

  it("serves one screenshot per editor and language, and drops a frame whose image fails", async () => {
    await render({ flags: {}, office_installers: installers });
    const sources = [...container.querySelectorAll<HTMLImageElement>(".office-blocks img")].map((img) => new URL(img.src).pathname);
    expect(sources).toEqual(["docs", "sheets", "slides", "pdf", "html", "markdown"].map((name) => `/landing/office/${name}.vi.webp`));
    const first = container.querySelector<HTMLImageElement>(".office-blocks img");
    await act(async () => { first?.dispatchEvent(new Event("error")); });
    expect(container.querySelectorAll(".office-blocks img")).toHaveLength(5);
  });
});
