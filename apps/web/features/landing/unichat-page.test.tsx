import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { paths } from "@uniwork/core/paths";
import { QueryProvider } from "@uniwork/core/provider";

// The transport is the only mock (the real config schema reads the answer); the shell is a
// pass-through because header and footer have their own coverage.
const request = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => request(...a),
}));
vi.mock("./marketing-shell", () => ({ MarketingShell: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));

import { UniChatPage } from "./unichat-page";
import viMessages from "@uniwork/core/i18n/locales/vi.json";
import enMessages from "@uniwork/core/i18n/locales/en.json";

const url = (name: string) => `https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-dev.1/${name}`;
const row = (platform: string, kind: string, file: string) => ({ platform, kind, url: url(file), version: "0.1.0-dev.1", unsigned: true });
const installers = {
  dev: [
    row("win32-x64", ".exe", "UniChat_0.1.0-dev.1_unsigned_win32_x64-setup.exe"),
    row("darwin-arm64", ".dmg", "UniChat_0.1.0-dev.1_unsigned_darwin_arm64.dmg"),
    row("darwin-x64", ".dmg", "UniChat_0.1.0-dev.1_unsigned_darwin_x64.dmg"),
    row("linux-x64-deb", ".deb", "UniChat_0.1.0-dev.1_unsigned_linux_x64.deb"),
  ],
};
const stores = { ios: "https://apps.apple.com/app/unichat/id1234567890", android: "https://play.google.com/store/apps/details?id=com.uniworkos.chat", testflight: "", play_internal: "" };
const officeOnly = { office_installers: { stable: [{ platform: "win32-x64", kind: ".exe", url: "https://downloads.test/UniWork-Office.exe" }] } };
const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

// jsdom's own user agent names the host system, so every test pins one.
async function render(config: unknown, userAgent: string = UA.windows): Promise<void> {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  request.mockResolvedValue(config);
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(UniChatPage))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const download = () => container.querySelector("#unichat-download")!;
const hrefs = (scope: ParentNode, selector: string) => [...scope.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => a.getAttribute("href"));
/** The featured platform, then every chip, in document order. */
const order = () => [download().querySelector<HTMLElement>("[data-featured]")?.dataset.featured, ...[...download().querySelectorAll<HTMLElement>(".app-dl-chip")].map((el) => el.dataset.officeOs ?? el.dataset.unichatStore)];

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
  it.each(["vi", "en"] as const)("says the work has a home, then four steps, the downloads and four questions in %s", async (language) => {
    await setLocale(language);
    await render({ flags: {}, unichat_installers: installers, unichat_stores: stores });
    const copy = (language === "vi" ? viMessages : enMessages).landing.unichat;
    expect(container.querySelector("h1")?.textContent).toBe(`${copy.hero.line1}${copy.hero.line2}`);
    expect(container.textContent).toContain(copy.hero.sub);
    expect([...container.querySelectorAll(".uc-step h3")].map((h) => h.textContent?.slice(2))).toEqual([copy.story.task.title, copy.story.project.title, copy.story.followUp.title, copy.story.call.title]);
    expect([...container.querySelectorAll("#unichat-faq .app-faq-q")].map((q) => q.textContent)).toEqual([copy.faq.q1, copy.faq.q2, copy.faq.q3, copy.faq.q4]);
    expect(container.querySelector("#unichat-download-title")?.textContent).toBe(copy.download.title);
    expect(container.textContent).not.toContain("landing.");
  });

  it("names the visitor's system on the download action and opens the chat on the web beside it", async () => {
    await render({ flags: {} });
    const actions = container.querySelector(".uc-hero .app-actions")!;
    expect(hrefs(actions, "a")).toEqual(["#unichat-download", paths.login()]);
    expect(actions.querySelector("a")?.textContent).toBe("Tải cho Windows");
    expect(container.querySelector("[data-app-bar=unichat] .app-bar-cta")?.getAttribute("href")).toBe("#unichat-download");
    expect(hrefs(container, "[data-app-bar=unichat] .app-bar-links a")).toEqual(["#unichat-overview", "#unichat-features", "#unichat-download", "#unichat-faq"]);
    expect(container.querySelector("[data-app-bar=unichat] .app-bar-root")?.getAttribute("href")).toBe(paths.apps.root());
    expect(hrefs(container, ".app-other-card")).toEqual([paths.root(), paths.apps.office()]);
  });

  it("says truthfully that nothing is released when the config publishes nothing", async () => {
    await render({ flags: {}, ...officeOnly });
    expect(hrefs(download(), "a")).toEqual([paths.login()]);
    const notice = download().querySelector("[role=status]");
    expect(notice?.textContent).toContain(viMessages.landing.unichat.download.unavailable);
    expect(notice?.textContent).toContain(viMessages.landing.unichat.mobile.unavailable);
    expect(container.textContent).not.toContain("UniWork-Office.exe");
  });

  it("features the visitor's desktop build and offers every other published build and the public stores", async () => {
    await render({ flags: {}, ...officeOnly, unichat_installers: installers, unichat_stores: stores });
    expect(order()).toEqual(["windows", "macos", "macos", "linux", "ios", "android"]);
    expect(hrefs(download(), "[data-featured] a[download]")).toEqual([installers.dev[0]!.url]);
    expect(download().querySelector("[data-featured] .app-dl-sub")?.textContent).toContain("0.1.0-dev.1");
    expect(hrefs(download(), ".app-dl-chip[data-unichat-store]")).toEqual([stores.ios, stores.android]);
    expect([...download().querySelectorAll(".app-dl-chip[data-unichat-store] > span")].map((s) => s.textContent)).toEqual(["App Store", "Google Play"]);
    expect(download().querySelector(".app-tag")).toBeNull();
    expect(download().textContent).toContain(viMessages.landing.unichat.download.unsigned);
    expect(download().querySelectorAll("[role=status], [role=alert]")).toHaveLength(0);
  });

  it("asks which chip a Mac has when the browser cannot tell", async () => {
    await render({ flags: {}, unichat_installers: installers }, UA.safariMac);
    expect(hrefs(download(), "[data-featured] a[download]")).toEqual([installers.dev[1]!.url, installers.dev[2]!.url]);
    expect(download().querySelector(".app-dl-help")?.textContent).toBe(viMessages.landing.apps.download.macHelp);
  });

  it("puts a phone's own store first, above the desktop builds", async () => {
    await render({ flags: {}, unichat_installers: installers, unichat_stores: stores }, UA.iphone);
    expect(order()).toEqual(["ios", "android", "macos", "macos", "windows", "linux"]);
    expect(download().querySelector("[data-featured] a")?.getAttribute("href")).toBe(stores.ios);
    act(() => root.unmount());
    root = createRoot(container);
    await render({ flags: {}, unichat_installers: installers, unichat_stores: stores }, UA.android);
    expect(order()).toEqual(["android", "ios", "macos", "macos", "windows", "linux"]);
  });

  it("offers the pilot links while no public store page exists, and says who can install them", async () => {
    await render({ flags: {}, unichat_stores: { testflight: "https://testflight.apple.com/join/AbCdEf12", play_internal: "https://play.google.com/apps/internaltest/4701234567890" } });
    expect(download().querySelector("[data-featured] h3")?.textContent).toBe("UniChat chưa có bản cho Windows");
    expect([...download().querySelectorAll(".app-dl-chip")].map((a) => [a.querySelector("span")?.textContent, a.getAttribute("href")])).toEqual([
      ["TestFlight", "https://testflight.apple.com/join/AbCdEf12"],
      [viMessages.landing.apps.store.playInternal, "https://play.google.com/apps/internaltest/4701234567890"],
    ]);
    expect(download().querySelectorAll(".app-dl-chip .app-tag")).toHaveLength(2);
    expect(download().textContent).toContain(viMessages.landing.apps.download.phonePilot);
  });

  it("degrades to the not-released state when the config answer drifts", async () => {
    await render({ unichat_installers: [1], unichat_stores: { ios: "javascript:alert(1)", android: "http://play.google.com/x" } });
    expect(container.querySelector("h1")).not.toBeNull();
    expect(hrefs(download(), "a")).toEqual([paths.login()]);
    expect(download().querySelectorAll("[role=status]")).toHaveLength(1);
  });

  it("replays the stage and follows the chosen step", async () => {
    await render({ flags: {} });
    const art = container.querySelector(".uc-art");
    await act(async () => { container.querySelector<HTMLButtonElement>(".uc-replay")?.click(); });
    expect(container.querySelector(".uc-art")).not.toBe(art);
    // The setup's IntersectionObserver reports every step in view, so the steps are chosen by click here.
    const steps = [...container.querySelectorAll<HTMLButtonElement>(".uc-step button")];
    await act(async () => { steps[0]?.click(); });
    expect(steps.map((step) => step.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    expect(container.querySelector(".uc-sstage .uc-dialog")).not.toBeNull();
    await act(async () => { steps[2]?.click(); });
    expect(steps[2]?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".uc-sstage .uc-fus")).not.toBeNull();
    expect(container.querySelector(".uc-sstage .uc-dialog")).toBeNull();
  });
});
