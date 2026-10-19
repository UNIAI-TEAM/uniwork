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
vi.mock("./faq", () => ({ Faq: ({ namespace, count }: { namespace: string; count: number }) => createElement("div", { "data-faq": namespace, "data-count": count }) }));

import { UniChatPage } from "./unichat-page";
import viMessages from "@uniwork/core/i18n/locales/vi.json";
import enMessages from "@uniwork/core/i18n/locales/en.json";

const url = (name: string) => `https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-dev.1/${name}`;
const installers = {
  dev: [
    { platform: "win32-x64", kind: ".exe", url: url("UniChat_0.1.0-dev.1_unsigned_win32_x64-setup.exe"), version: "0.1.0-dev.1", unsigned: true },
    { platform: "darwin-arm64", kind: ".dmg", url: url("UniChat_0.1.0-dev.1_unsigned_darwin_arm64.dmg"), version: "0.1.0-dev.1", unsigned: true },
    { platform: "linux-x64-deb", kind: ".deb", url: url("UniChat_0.1.0-dev.1_unsigned_linux_x64.deb"), version: "0.1.0-dev.1", unsigned: true },
  ],
};
const stores = { ios: "https://apps.apple.com/app/unichat/id1234567890", android: "https://play.google.com/store/apps/details?id=com.uniworkos.chat", testflight: "", play_internal: "" };
const officeOnly = { office_installers: { stable: [{ platform: "win32-x64", kind: ".exe", url: "https://downloads.test/UniWork-Office.exe" }] } };
const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

async function render(config: unknown, userAgent?: string): Promise<void> {
  if (userAgent) vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  request.mockResolvedValue(config);
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(UniChatPage))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const hrefs = (selector: string) => [...container.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => a.getAttribute("href"));
/** Desktop OS columns and phone store columns, in document order. */
const columns = () => [...container.querySelectorAll<HTMLElement>("#unichat-download [data-office-os], #unichat-download [data-unichat-store]")].map((el) => el.dataset.officeOs ?? el.dataset.unichatStore);

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

describe("the UniChat page", () => {
  it.each(["vi", "en"] as const)("introduces UniChat with four work points and a short FAQ in %s", async (language) => {
    await setLocale(language);
    await render({ flags: {}, unichat_installers: installers, unichat_stores: stores });
    const copy = (language === "vi" ? viMessages : enMessages).landing.unichat;
    expect(container.querySelector("h1")?.textContent).toBe("UniChat");
    expect(container.textContent).toContain(copy.hero.sub);
    expect([...container.querySelectorAll(".unichat-points h3")].map((h) => h.textContent)).toEqual([copy.points.task.title, copy.points.project.title, copy.points.followUp.title, copy.points.call.title]);
    expect(container.querySelector("[data-faq]")?.getAttribute("data-faq")).toBe("landing.unichat.faq");
    expect(container.querySelector("[data-faq]")?.getAttribute("data-count")).toBe("4");
    expect(container.querySelector("#unichat-download-title")?.textContent).toBe(copy.download.title);
    expect(container.textContent).not.toContain("landing.");
  });

  it("leads to the download block and a demo request, and links the chat preview and the security page", async () => {
    await render({ flags: {} });
    expect(hrefs(".office-hero-actions a")).toEqual(["#unichat-download", paths.requestDemo()]);
    expect(hrefs(".unichat-links a")).toEqual([paths.feature("chat"), paths.security()]);
  });

  it("says truthfully that nothing is released when the config publishes nothing", async () => {
    await render({ flags: {}, ...officeOnly });
    expect(container.querySelectorAll("#unichat-download a")).toHaveLength(0);
    const notices = [...container.querySelectorAll("#unichat-download [role=status]")].map((el) => el.textContent);
    expect(notices).toEqual([viMessages.landing.unichat.download.unavailable, viMessages.landing.unichat.mobile.unavailable]);
    expect(container.textContent).not.toContain("UniWork-Office.exe");
  });

  it("offers every published desktop variant and the public store pages, from the config only", async () => {
    await render({ flags: {}, ...officeOnly, unichat_installers: installers, unichat_stores: stores });
    expect(hrefs("#unichat-download a[download]")).toEqual([installers.dev[1]!.url, installers.dev[0]!.url, installers.dev[2]!.url]);
    expect(hrefs("[data-unichat-store] a")).toEqual([stores.ios, stores.android]);
    expect([...container.querySelectorAll("[data-unichat-store] a")].map((a) => a.textContent)).toEqual(["App Store", "Google Play"]);
    expect(container.querySelectorAll("[data-unichat-store] small")).toHaveLength(0);
    expect(container.querySelector("[data-office-os=windows] small")?.textContent).toBe(viMessages.landing.unichat.download.unsigned);
    expect(container.querySelector("#unichat-download-title")?.parentElement?.textContent).toContain("0.1.0-dev.1");
    expect(container.querySelectorAll("#unichat-download [role=status]")).toHaveLength(0);
  });

  it("puts the visitor's desktop system first", async () => {
    await render({ flags: {}, unichat_installers: installers, unichat_stores: stores }, UA.windows);
    expect(columns()).toEqual(["windows", "macos", "linux", "ios", "android"]);
  });

  it("puts a phone's own store first, above the desktop installers", async () => {
    await render({ flags: {}, unichat_installers: installers, unichat_stores: stores }, UA.iphone);
    expect(columns()).toEqual(["ios", "android", "macos", "windows", "linux"]);
    act(() => root.unmount());
    root = createRoot(container);
    await render({ flags: {}, unichat_installers: installers, unichat_stores: stores }, UA.android);
    expect(columns()).toEqual(["android", "ios", "macos", "windows", "linux"]);
  });

  it("offers the pilot links while no public store page exists, and says who can install them", async () => {
    await render({ flags: {}, unichat_stores: { testflight: "https://testflight.apple.com/join/AbCdEf12", play_internal: "https://play.google.com/apps/internaltest/4701234567890" } });
    expect([...container.querySelectorAll("[data-unichat-store] a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["TestFlight", "https://testflight.apple.com/join/AbCdEf12"],
      [viMessages.landing.unichat.mobile.playInternal, "https://play.google.com/apps/internaltest/4701234567890"],
    ]);
    expect([...container.querySelectorAll("[data-unichat-store] small")].map((s) => s.textContent)).toEqual([viMessages.landing.unichat.mobile.pilot, viMessages.landing.unichat.mobile.pilot]);
  });

  it("degrades to the not-released state when the config answer drifts", async () => {
    await render({ unichat_installers: [1], unichat_stores: { ios: "javascript:alert(1)", android: "http://play.google.com/x" } });
    expect(container.querySelector("h1")?.textContent).toBe("UniChat");
    expect(container.querySelectorAll("#unichat-download a")).toHaveLength(0);
    expect(container.querySelectorAll("#unichat-download [role=status]")).toHaveLength(2);
  });
});
