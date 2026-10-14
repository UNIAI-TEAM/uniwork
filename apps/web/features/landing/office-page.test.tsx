import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { paths } from "@uniwork/core/paths";
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

const EDITORS = ["docs", "sheets", "slides", "pdf", "html", "markdown"] as const;
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
const tabs = () => [...container.querySelectorAll<HTMLElement>("[role=tab]")];
const selectedTab = () => container.querySelector("[role=tab][aria-selected=true]")?.textContent;
/** The screenshot paths of the editor whose tab is showing: light first, then dark. */
const shots = () => [...container.querySelectorAll<HTMLImageElement>(".office-tabs img")].map((img) => new URL(img.src).pathname);

beforeEach(async () => {
  Element.prototype.scrollIntoView = scrollIntoView;
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
  scrollIntoView.mockReset();
});

describe("the Office page", () => {
  it("lays out the sections in order, each with its own copy", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("h1")?.textContent).toBe("UniWork Office");
    const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent);
    expect(headings).toEqual([
      "Soạn văn bản với AI ngay bên cạnh",
      "Từ việc cần làm đến file hoàn chỉnh",
      "AI có sẵn, file vẫn nằm trong workspace của nhóm",
      "Tải UniWork Office",
      "Làm việc cùng UniWork",
    ]);
    expect(tabs()).toHaveLength(6);
    expect(container.querySelectorAll("ul.office-tasks > li.office-task")).toHaveLength(6);
    expect(container.querySelector("ol")).toBeNull();
    expect(container.querySelectorAll(".office-works article")).toHaveLength(3);
    expect(container.querySelector("[data-faq]")?.getAttribute("data-count")).toBe("6");
  });

  it("leads with the promise, a trial button to the download block and a demo request, above the editor preview", async () => {
    await render({ flags: {}, office_installers: installers });
    const hero = container.querySelector(".office-hero");
    expect(hero?.querySelector("h1")?.textContent).toBe("UniWork Office");
    expect(hero?.querySelector(".office-sub")?.textContent).toBe("Soạn thảo tài liệu, bảng tính và bài trình bày với AI. Kết nối cùng workspace UniWork.");
    const trial = hero?.querySelector<HTMLAnchorElement>(".office-trial-action");
    expect(trial?.textContent).toBe("Tải dùng thử");
    expect(trial?.getAttribute("href")).toBe("#office-download");
    expect(container.querySelector("#office-download")).not.toBeNull();
    const demo = hero?.querySelector<HTMLAnchorElement>(".office-explore-action");
    expect(demo?.textContent).toBe("Yêu cầu demo");
    expect(demo?.getAttribute("href")).toBe(paths.requestDemo());
    // The six-tab preview sits in the hero; the installers are not repeated there.
    expect(hero?.querySelector("#office-editors [role=tablist]")).not.toBeNull();
    expect(hero?.querySelector("[download]")).toBeNull();
    expect(hero?.querySelector(".office-hero-downloads")).toBeNull();
  });

  it("follows the selected tab with the editor summary, three points each", async () => {
    await render({ flags: {}, office_installers: installers });
    const summary = () => container.querySelector(".office-editor-summary");
    expect(summary()?.querySelector("h2")?.textContent).toBe("Soạn văn bản với AI ngay bên cạnh");
    expect(summary()?.querySelectorAll(".office-editor-points li")).toHaveLength(3);
    await act(async () => { tabs()[1]?.click(); });
    expect(selectedTab()).toBe("Bảng tính");
    expect(summary()?.querySelector("h2")?.textContent).toBe("Bảng tính trả lời được câu hỏi về số liệu");
    expect(summary()?.querySelectorAll(".office-editor-points li")).toHaveLength(3);
  });

  it("offers the published installers per OS, straight from the config, and hides the rest", async () => {
    await render({ flags: {}, office_installers: installers });
    const columns = ".office-download-columns .office-download-column";
    expect([...container.querySelectorAll(columns)].map((el) => el.getAttribute("data-office-os"))).toEqual(["macos", "windows", "linux"]);
    expect(hrefs(`${columns} a`)).toEqual([url("UniWork-Office-1.2.0-arm64.dmg"), url("UniWork-Office-1.2.0-x64.dmg"), url("UniWork-Office-1.2.0-x64.exe"), url("UniWork-Office-1.2.0-amd64.deb")]);
    expect(hrefs(`${columns}[data-office-os=macos] a`)).toEqual([url("UniWork-Office-1.2.0-arm64.dmg"), url("UniWork-Office-1.2.0-x64.dmg")]);
    expect(hrefs(`${columns}[data-office-os=windows] a`)).toEqual([url("UniWork-Office-1.2.0-x64.exe")]);
    // Not published: no Windows zip, no AppImage, so no link to either.
    const all = hrefs("a");
    expect(all.some((href) => href?.endsWith(".zip") || href?.endsWith(".AppImage"))).toBe(false);
    // Only the unsigned Windows build carries the warning.
    expect(container.querySelector(`${columns}[data-office-os=windows] small`)?.textContent).toContain("chưa ký số");
    expect(container.querySelectorAll(`${columns}[data-office-os=macos] small, ${columns}[data-office-os=linux] small`)).toHaveLength(0);
    expect(container.querySelector("#office-download-title")?.parentElement?.textContent).toContain("Phiên bản 1.2.0");
  });

  it("lists every published Linux format and leaves out the one that is not published", async () => {
    const both = [...installers.stable, { platform: "linux-x64-appimage", kind: ".AppImage", url: url("UniWork-Office-1.2.0.AppImage"), version: "1.2.0" }];
    await render({ flags: {}, office_installers: { stable: both } });
    expect(hrefs(".office-download-column[data-office-os=linux] a")).toEqual([url("UniWork-Office-1.2.0-amd64.deb"), url("UniWork-Office-1.2.0.AppImage")]);
    act(() => root.unmount());
    root = createRoot(container);
    await render({ flags: {}, office_installers: { stable: both.filter((row) => row.platform !== "linux-x64-deb") } });
    expect(hrefs(".office-download-column[data-office-os=linux] a")).toEqual([url("UniWork-Office-1.2.0.AppImage")]);
  });

  it("says so instead of showing dead buttons when nothing is published", async () => {
    await render({ flags: {}, office_installers: { stable: [] } });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(container.querySelector("#office-download [role=status]")?.textContent).toBe("Chưa có bản cài đặt nào được phát hành.");
    expect(container.querySelector("#office-download-title")?.parentElement?.textContent).not.toContain("Phiên bản");
  });

  it("degrades to the same state when the config answer drifts", async () => {
    await render({ unexpected: true });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelector("h1")?.textContent).toBe("UniWork Office");
  });

  it("opens the editor a task card names", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(selectedTab()).toBe("Văn bản");
    const link = container.querySelectorAll<HTMLButtonElement>(".office-task-link")[1];
    await act(async () => { link?.click(); });
    expect(selectedTab()).toBe("Bảng tính");
    expect(container.querySelector(".office-editor-summary h2")?.textContent).toBe("Bảng tính trả lời được câu hỏi về số liệu");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("speaks English and keeps clear of claims UniWork does not make", async () => {
    await setLocale("en");
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("h2")?.textContent).toBe("Write documents with AI beside you");
    expect(container.querySelector(".office-trial-action")?.textContent).toBe("Download trial");
    expect(container.querySelector(".office-explore-action")?.textContent).toBe("Request a demo");
    expect(container.querySelector("#office-download-title")?.textContent).toBe("Download UniWork Office");
    expect(container.querySelector(".office-download-column[data-office-os=macos] h3")?.textContent).toContain("macOS");
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
    // The trust list sits in the AI section, under the points it qualifies.
    const ai = container.querySelector("section[aria-labelledby=office-ai-title]");
    expect(ai?.querySelector(".office-trust")).not.toBeNull();
    expect(ai?.querySelectorAll(".office-trust li")).toHaveLength(3);
    expect(container.querySelector(".office-ai-points")?.textContent).toContain("tìm kiếm web, tìm kiếm ảnh và chuyển giọng nói thành văn bản");
    expect(container.querySelector(".office-trust")?.textContent).toContain("Sửa file trên máy không cần kết nối; AI cloud và tài liệu UniWork cần kết nối");
    await setLocale("en");
    await tick();
    expect(container.querySelector(".office-ai-points")?.textContent).toContain("web search, image search and transcription");
    expect(container.querySelector(".office-trust")?.textContent).toContain("Edit files on your computer without a connection; cloud AI and UniWork documents need one");
    expect(container.querySelector("[data-faq]")?.textContent).toContain("Cloud AI and UniWork documents");
  });

  it("renders the download shell at once, so nothing shifts when the config arrives", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    request.mockReturnValue(new Promise((done) => { resolve = done; }));
    await act(async () => { root.render(createElement(QueryProvider, null, createElement(OfficePage))); });
    await tick();
    expect(container.querySelectorAll(".office-download-columns[aria-busy] .office-download-column")).toHaveLength(3);
    expect(container.querySelectorAll(".office-download-columns .office-skeleton").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[download], [role=alert], [role=status]")).toHaveLength(0);
    // The preview and the promise do not wait for the installers.
    expect(tabs()).toHaveLength(6);
    await act(async () => { resolve({ flags: {}, office_installers: installers }); });
    await tick();
    const loaded = container.querySelector(".office-download-columns");
    expect(loaded?.hasAttribute("aria-busy")).toBe(false);
    expect(loaded?.querySelectorAll(".office-download-column")).toHaveLength(3);
    expect(loaded?.querySelector(".office-skeleton")).toBeNull();
  });

  it("shows a visible error with a retry when the config cannot be loaded", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    const alerts = container.querySelectorAll("[role=alert]");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toContain("Không tải được danh sách bản cài đặt");
    expect(container.textContent).not.toContain("Chưa có bản cài đặt nào");
    const retry = alerts[0]?.querySelector("button");
    expect(retry?.textContent).toBe("Thử lại");
    await act(async () => { retry?.click(); });
    await tick();
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(0);
    expect(container.querySelectorAll(".office-download-columns [download]").length).toBeGreaterThan(0);
  });

  it("drops a frame whose image had already failed before it could report an error", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll(".office-preview-error[role=status]")).toHaveLength(2);
    expect(container.querySelector(".office-preview-error")?.textContent).toBe("Không tải được ảnh xem trước. Tải lại trang để thử lại.");
  });

  it("serves a light and a dark screenshot per editor and language, and drops a frame whose image fails", async () => {
    await render({ flags: {}, office_installers: installers });
    // Only the selected editor's panel is mounted: its two theme variants.
    expect(shots()).toEqual(["/landing/office/docs.vi.webp", "/landing/office/docs.vi.dark.webp"]);
    expect([...container.querySelectorAll<HTMLImageElement>(".office-tabs img")].map((img) => img.dataset.theme)).toEqual(["light", "dark"]);
    for (const [index, editor] of EDITORS.entries()) {
      await act(async () => { tabs()[index]?.click(); });
      expect(shots()).toEqual([`/landing/office/${editor}.vi.webp`, `/landing/office/${editor}.vi.dark.webp`]);
    }
    await setLocale("en");
    await tick();
    expect(shots()).toEqual(["/landing/office/markdown.en.webp", "/landing/office/markdown.en.dark.webp"]);
    const first = container.querySelector<HTMLImageElement>(".office-tabs img");
    await act(async () => { first?.dispatchEvent(new Event("error")); });
    expect(container.querySelectorAll(".office-tabs img")).toHaveLength(1);
    expect(container.querySelectorAll(".office-tabs .office-preview-error")).toHaveLength(1);
  });
});
