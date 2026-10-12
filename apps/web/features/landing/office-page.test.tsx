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
vi.mock("./faq", () => ({ Faq: ({ namespace, count }: { namespace: string; count: number }) => createElement("div", { "data-faq": namespace, "data-count": count }) }));

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

beforeEach(async () => {
  Element.prototype.scrollIntoView = scrollIntoView;
  await setLocale("vi");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
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
      "AI có sẵn, dữ liệu vẫn ở workspace của bạn",
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
    expect(hrefs(".office-hero-downloads .office-os-button")).toEqual([url("UniWork-Office-1.2.0-arm64.dmg"), url("UniWork-Office-1.2.0-x64.exe"), url("UniWork-Office-1.2.0-amd64.deb")]);
    expect(hrefs(".office-os[data-office-os=macos] .office-os-variants a")).toEqual([url("UniWork-Office-1.2.0-arm64.dmg"), url("UniWork-Office-1.2.0-x64.dmg")]);
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
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("h2")?.textContent).toBe("Six editors. One workspace.");
    expect(container.querySelector(".office-os-button")?.textContent).toBe("Download for macOS");
    for (const language of ["vi", "en"] as const) {
      await setLocale(language);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(container.textContent).not.toMatch(/github|genspark|genoffice|open[- ]source|mã nguồn mở|miễn phí|ad-free|không quảng cáo/i);
    }
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
