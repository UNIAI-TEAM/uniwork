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
import viMessages from "@uniwork/core/i18n/locales/vi.json";
import enMessages from "@uniwork/core/i18n/locales/en.json";

const EDITORS = ["docs", "sheets", "slides", "pdf", "html", "markdown"] as const;
const tabs = () => [...container.querySelectorAll<HTMLElement>("[role=tab]")];
const shots = () => [...container.querySelectorAll<HTMLImageElement>(".office-tabs img")].map(img => new URL(img.src).pathname);

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

// jsdom's own user agent names the host system, so the visitor is pinned to Windows.
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function render(config: unknown): Promise<void> {
  request.mockResolvedValue(config);
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(OfficePage))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const hrefs = (selector: string) => [...container.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => a.getAttribute("href"));
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(WINDOWS);
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
    // The visitor's Windows build leads; every other published variant follows as a chip.
    expect(hrefs("#office-download [data-featured=windows] a[download]")).toEqual([installers.stable[2]!.url]);
    expect(hrefs("#office-download .app-dl-chip")).toEqual([installers.stable[0]!.url, installers.stable[1]!.url, installers.stable[3]!.url]);
    expect(container.querySelector(".office-hero-actions a")?.getAttribute("href")).toBe("#office-download");
    expect(hrefs(".office-hero-actions a")).toContain("/request-demo");
    expect(container.querySelector("#office-download .app-dl-notes")?.textContent).toBe(viMessages.landing.office.download.unsigned);
    expect(container.querySelector("#office-download [data-featured] .app-dl-sub")?.textContent).toContain("Phiên bản 1.2.0");
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
    expect(container.querySelectorAll("#office-download .app-dl[aria-busy] .app-dl-featured.is-skeleton")).toHaveLength(1);
    expect(container.querySelectorAll("[download], [role=alert], [role=status]")).toHaveLength(0);
    await act(async () => { resolve({ flags: {}, office_installers: installers }); });
    await tick();
    expect(container.querySelector("#office-download .app-dl")?.hasAttribute("aria-busy")).toBe(false);
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
  });

  it("sits in the apps family: the app bar over its sections, and the other apps at the foot", async () => {
    await render({ flags: {}, office_installers: installers });
    const bar = container.querySelector("[data-app-bar=office]");
    expect(bar?.querySelector(".app-bar-root")?.getAttribute("href")).toBe(paths.apps.root());
    expect(hrefs("[data-app-bar=office] .app-bar-links a")).toEqual(["#office-business", "#office-editors", "#office-download", "#office-faq"]);
    for (const id of ["office-business", "office-editors", "office-download", "office-faq"]) expect(container.querySelector(`#${id}`)).not.toBeNull();
    expect(bar?.querySelector(".app-bar-cta")?.getAttribute("href")).toBe("#office-download");
    expect(bar?.querySelector(".app-bar-cta-long")?.textContent).toBe("Tải dùng thử");
    expect(hrefs(".app-other-card")).toEqual([paths.root(), paths.apps.unichat()]);
  });


  it("lists every published Linux format and leaves out the one that is not published", async () => {
    const both = [...installers.stable, { platform: "linux-x64-appimage", kind: ".AppImage", url: url("UniWork-Office-1.2.0.AppImage"), version: "1.2.0" }];
    await render({ flags: {}, office_installers: { stable: both } });
    expect(hrefs(".app-dl-chip[data-office-os=linux]")).toEqual([url("UniWork-Office-1.2.0-amd64.deb"), url("UniWork-Office-1.2.0.AppImage")]);
    act(() => root.unmount());
    root = createRoot(container);
    await render({ flags: {}, office_installers: { stable: both.filter((row) => row.platform !== "linux-x64-deb") } });
    expect(hrefs(".app-dl-chip[data-office-os=linux]")).toEqual([url("UniWork-Office-1.2.0.AppImage")]);
  });


  it("drops a frame whose image had already failed before it could report an error", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    await render({ flags: {}, office_installers: installers });
    // Only the editor preview: the app icons beside the page are not screenshots.
    expect(container.querySelectorAll(".office-tabs img")).toHaveLength(0);
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
