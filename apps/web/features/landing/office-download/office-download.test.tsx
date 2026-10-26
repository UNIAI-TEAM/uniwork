import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { QueryProvider } from "@uniwork/core/provider";
import viMessages from "@uniwork/core/i18n/locales/vi.json";
import { assetUrl, jsonResponse, manifestUrls, testManifest } from "./test-manifest";

// Two transports and nothing else: the API (public config, for the fallback and apt's
// channel) and `fetch` (the manifest). The real schemas read both answers.
const request = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => request(...a),
}));

import { OfficeDownload } from "./office-download";

const copy = viMessages.landing.office.download;
const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  chromeOS: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};
const installer = (platform: string, kind: string, file: string) => ({ platform, kind, url: `https://uniworkos.com/downloads/office/beta/0.9.0/${file}`, version: "0.9.0" });
const CONFIG = { flags: {}, office_installers: { beta: [installer("win32-x64", ".exe", "Office-0.9.0-x64.exe"), installer("darwin-arm64", ".dmg", "Office-0.9.0-arm64.dmg"), installer("linux-x64-deb", ".deb", "Office-0.9.0-amd64.deb")] } };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function mount({ ua = UA.windows, manifest = testManifest() as unknown, search = "" }: { ua?: string; manifest?: unknown; search?: string } = {}) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  window.history.replaceState(null, "", `/apps/office${search}`);
  if (manifest instanceof Error) fetchMock.mockRejectedValue(manifest);
  else if (manifest instanceof Response) fetchMock.mockResolvedValue(manifest);
  else fetchMock.mockImplementation(async () => jsonResponse(manifest));
  await act(async () => { root.render(createElement(QueryProvider, null, createElement(OfficeDownload))); });
  await settle();
}
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [...container.querySelectorAll<T>(selector)];
const hrefs = (selector: string) => $$<HTMLAnchorElement>(selector).map((a) => a.getAttribute("href"));
const click = (element: Element | null) => act(async () => { (element as HTMLElement | null)?.click(); });
/** The tab coming back into view: what the query re-checks on. */
const returnToTab = () => act(async () => { document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
const openPicker = () => click($(".office-dl-others-trigger"));
const radios = (group: string) => $$(`${group} [role=radio]`);
const checked = (group: string) => $$(`${group} [role=radio]`).find((radio) => radio.getAttribute("aria-checked") === "true");
const pickTile = (name: string) => click(radios(".office-dl-tiles").find((radio) => radio.getAttribute("aria-label") === name) ?? null);

beforeEach(async () => {
  await setLocale("vi");
  vi.stubGlobal("fetch", fetchMock);
  request.mockResolvedValue(CONFIG);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fetchMock.mockReset();
  request.mockReset();
  Reflect.deleteProperty(navigator, "userAgentData");
});

describe("the Office Download section", () => {
  it("reads the same-origin manifest and opens on the most stable published channel, the visitor's system first", async () => {
    await mount();
    expect(fetchMock).toHaveBeenCalledWith("/downloads/office/releases.json", expect.objectContaining({ cache: "no-store", credentials: "omit" }));
    expect($("[role=tab][aria-selected=true]")?.textContent).toBe(copy.channel.beta);
    const spot = $(".office-dl-spot[data-own]");
    expect(spot?.getAttribute("data-os")).toBe("windows");
    expect(spot?.querySelector(".office-dl-spot-meta")?.textContent).toContain("Phiên bản 0.10.0-beta.1");
    expect(hrefs(".office-dl-spot a[download]")).toEqual([assetUrl("beta", "0.10.0-beta.1", "UniWork-Office_0.10.0-beta.1_unsigned_win32_x64-setup.exe")]);
    expect($(".office-dl-spot .apt-install")).toBeNull();
    // "Nền tảng khác" is one row, closed until asked.
    const trigger = $(".office-dl-others-trigger");
    expect(trigger?.textContent).toContain(viMessages.landing.apps.download.others);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect($(".office-dl-tiles")).toBeNull();
  });

  it("leads a Mac whose chip the browser proves with that chip, and shows both chips with help when it cannot", async () => {
    Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { platform: "macOS", mobile: false, getHighEntropyValues: async () => ({ architecture: "x86", bitness: "64" }) } });
    await mount({ ua: UA.macChrome });
    expect($$(".office-dl-spot a[download]").map((a) => a.dataset.file)).toEqual(["mac_intel", "mac_arm"]);
    expect($(".office-dl-spot a.is-hero")?.dataset.file).toBe("mac_intel");
    expect($(".office-dl-spot .app-dl-help")).toBeNull();
    act(() => root.unmount());
    Reflect.deleteProperty(navigator, "userAgentData");
    root = createRoot(container);
    await mount({ ua: UA.macSafari });
    expect($$(".office-dl-spot a[download]").map((a) => a.dataset.file)).toEqual(["mac_arm", "mac_intel"]);
    expect($(".office-dl-spot .app-dl-help")?.textContent).toBe(viMessages.landing.apps.download.macHelp);
  });

  it("gives a Linux visitor the .deb, the .AppImage with its size kept whole, and the apt block of the shown channel", async () => {
    await mount({ ua: UA.linux });
    expect($$(".office-dl-spot a[download]").map((a) => a.dataset.file)).toEqual(["deb", "appimage"]);
    expect($$(".office-dl-spot .office-dl-size").map((size) => size.textContent)).toEqual(["82,6 MB", "118,3 MB"]);
    const apt = $(".office-dl-spot .apt-install");
    expect(apt?.querySelector(".apt-code")?.textContent).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- beta");
    // The block breaks only after "/", never inside a word; what is copied stays the command.
    expect(apt?.querySelector(".apt-code wbr")).not.toBeNull();
    await click($$("[role=tab]").find((tab) => tab.textContent === copy.channel.dev) ?? null);
    expect($(".office-dl-spot .apt-code")?.textContent).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- dev");
  });

  it.each([["a phone", UA.android, true], ["a system with no build", UA.chromeOS, false]] as const)("shows %s the three systems as equal cards, with no picker", async (_, ua, phone) => {
    await mount({ ua });
    expect($$(".office-dl-group").map((group) => group.getAttribute("data-os"))).toEqual(["windows", "macos", "linux"]);
    expect($(".office-dl-spot")).toBeNull();
    expect($(".office-dl-others-trigger")).toBeNull();
    expect($(".office-dl-others > .apt-install")).not.toBeNull();
    expect($(".office-dl-phone") !== null).toBe(phone);
  });

  it("opens the picker on the first other system, as keyboard radio tiles whose chips switch the download link", async () => {
    await mount();
    await openPicker();
    expect($(".office-dl-others-trigger")?.getAttribute("aria-expanded")).toBe("true");
    expect($(".office-dl-tiles")?.getAttribute("role")).toBe("radiogroup");
    expect(radios(".office-dl-tiles").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Windows", "macOS", "Linux"]);
    expect(checked(".office-dl-tiles")?.getAttribute("aria-label")).toBe("macOS");
    expect($(".office-dl-tile[data-os=windows] .office-dl-tile-tag")?.textContent).toBe(copy.picker.recommended);
    // One tab stop for the group; the arrows move the choice.
    expect(radios(".office-dl-tiles").filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    await act(async () => { checked(".office-dl-tiles")?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(checked(".office-dl-tiles")?.getAttribute("aria-label")).toBe("Linux");
    await pickTile("macOS");
    expect(hrefs(".office-dl-picker-button")).toEqual([assetUrl("beta", "0.10.0-beta.1", "UniWork-Office_0.10.0-beta.1_darwin_arm64.dmg")]);
    expect($(".office-dl-picker-info")?.textContent).toContain(viMessages.office.desktop.install.req.macos);
    expect($(".office-dl-picker-info")?.textContent).toContain("0.10.0-beta.1");
    await click(radios(".office-dl-chip-row").find((radio) => radio.getAttribute("aria-label") === copy.history.build.mac_intel) ?? null);
    expect(hrefs(".office-dl-picker-button")).toEqual([assetUrl("beta", "0.10.0-beta.1", "UniWork-Office_0.10.0-beta.1_darwin_x64.dmg")]);
    expect($(".office-dl-picker .apt-install")).toBeNull();
    await pickTile("Linux");
    expect(radios(".office-dl-chip-row").map((radio) => radio.getAttribute("aria-label"))).toEqual([copy.history.build.deb, copy.history.build.appimage]);
    expect($(".office-dl-picker .apt-install")).not.toBeNull();
  });

  it("switches channel through the tabs and `?channel=`, with the latest notes and the earlier versions of that channel", async () => {
    await mount({ search: "?channel=dev" });
    expect($("[role=tab][aria-selected=true]")?.textContent).toBe(copy.channel.dev);
    expect($(".office-dl-spot-meta")?.textContent).toContain("0.11.0-dev.3");
    expect($(".office-dl-whatsnew")?.textContent).toContain("Mở file .xlsx lớn nhanh hơn.");
    expect($$(".office-dl-history-trigger strong").map((version) => version.textContent)).toEqual(["0.11.0-dev.2"]);
    await click($$("[role=tab]").find((tab) => tab.textContent === copy.channel.beta) ?? null);
    expect(new URLSearchParams(window.location.search).get("channel")).toBe("beta");
    expect($(".office-dl-spot-meta")?.textContent).toContain("0.10.0-beta.1");
    expect($(".office-dl-history")?.textContent).toContain(copy.history.none);
  });

  it("marks the unpublished stable channel coming soon, with no build and no apt block", async () => {
    await mount({ ua: UA.linux, search: "?channel=stable" });
    const stable = $$("[role=tab]").find((tab) => tab.textContent?.startsWith(copy.channel.stable));
    expect(stable?.querySelector("small")?.textContent).toBe(copy.soon);
    expect($("[role=tabpanel] [role=status] h3")?.textContent).toBe(copy.states.soonTitle.replace("{{channel}}", copy.channel.stable));
    expect($$("a[download]")).toHaveLength(0);
    expect($(".apt-install")).toBeNull();
    await click($("[role=tabpanel] [role=status] button"));
    expect($("[role=tab][aria-selected=true]")?.textContent).toBe(copy.channel.beta);
  });

  it("holds the loading shell in the loaded shape until the manifest arrives", async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(UA.windows);
    await act(async () => { root.render(createElement(QueryProvider, null, createElement(OfficeDownload))); });
    await settle();
    expect($(".office-dl-skeleton[aria-busy=true] .office-dl-spot.is-skeleton")).not.toBeNull();
    expect($(".office-dl-skeleton .office-dl-row-skeleton")).not.toBeNull();
    expect($("[role=status]")?.textContent).toBe(copy.states.loading);
    expect($$("a[download], [role=alert]")).toHaveLength(0);
    await act(async () => { resolve(jsonResponse(testManifest())); });
    await settle();
    expect($(".office-dl-skeleton")).toBeNull();
    expect($(".office-dl-spot:not(.is-skeleton)")).not.toBeNull();
    expect($(".office-dl-others-trigger")).not.toBeNull();
  });

  it.each([
    ["unreachable", new TypeError("Failed to fetch")],
    ["missing", jsonResponse({ error: "not found" }, 404)],
    ["not a manifest", { channels: "dev" }],
  ] as const)("falls back to the current installers with a quiet note when the manifest is %s, and recovers through its retry", async (_, manifest) => {
    await mount({ manifest });
    const alert = $("[role=alert]");
    expect(alert?.textContent).toContain(copy.states.error);
    expect(alert?.textContent).toContain(copy.states.errorFallback);
    expect(hrefs("a[download]")).toEqual([CONFIG.office_installers.beta[0]!.url]);
    await openPicker();
    await pickTile("Linux");
    expect(hrefs(".office-dl-picker-button")).toEqual([CONFIG.office_installers.beta[2]!.url]);
    expect($(".office-dl-picker .apt-code")?.textContent).toContain("-s -- beta");
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse(testManifest()));
    await click($("[role=alert] button"));
    await settle();
    expect($("[role=alert]")).toBeNull();
    expect(hrefs(".office-dl-spot a[download]")).toEqual([assetUrl("beta", "0.10.0-beta.1", "UniWork-Office_0.10.0-beta.1_unsigned_win32_x64-setup.exe")]);
  });

  it("degrades a drifted manifest build by build, and says so when nothing is published", async () => {
    const drifted = testManifest();
    drifted.channels.beta.releases[0]!.assets[0]!.url = "javascript:alert(1)";
    (drifted.channels as Record<string, unknown>).nightly = { latest: "x", releases: "y" };
    await mount({ ua: UA.linux, manifest: drifted });
    await openPicker();
    expect(radios(".office-dl-tiles").map((radio) => radio.getAttribute("aria-label"))).toEqual(["macOS", "Linux"]);
    expect($$("[role=tab]")).toHaveLength(3);
    act(() => root.unmount());
    root = createRoot(container);
    await mount({ manifest: { schema: 1, channels: {} } });
    expect($("[role=status] h3")?.textContent).toBe(copy.states.emptyTitle);
    expect($$("a[download], [role=alert]")).toHaveLength(0);
  });

  it("offers a newer release found on a later visit as a notice, and swaps it in only on \"Tải lại\"", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await mount({ search: "?channel=dev" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(async () => jsonResponse(testManifest({ newer: true })));
    // A focus within ten minutes reads nothing.
    await returnToTab();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    await returnToTab();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const notice = $(".office-dl-notice[role=status]");
    expect(notice?.textContent).toContain("Có phiên bản mới 0.11.0-dev.4 ở kênh Dev.");
    // The page does not move under the reader.
    expect($(".office-dl-spot-meta")?.textContent).toContain("0.11.0-dev.3");
    expect(document.activeElement).not.toBe(notice?.querySelector("button"));
    await click(notice?.querySelector("button") ?? null);
    expect($(".office-dl-spot-meta")?.textContent).toContain("0.11.0-dev.4");
    expect($(".office-dl-notice")).toBeNull();
    expect($$(".office-dl-history-trigger strong").map((version) => version.textContent)).toEqual(["0.11.0-dev.3", "0.11.0-dev.2"]);
  });

  it("links only to files the manifest lists, and never talks about self-update, signing or checksums", async () => {
    const manifest = testManifest();
    await mount({ ua: UA.linux, search: "?channel=dev" });
    await openPicker();
    await pickTile("macOS");
    await click($(".office-dl-history-trigger"));
    await click($("details.apt-manual summary"));
    const links = hrefs("a[download]");
    expect(links.length).toBeGreaterThan(5);
    const listed = manifestUrls(manifest);
    for (const link of links) expect(listed.has(link ?? "")).toBe(true);
    // "Signed-By:" is a line of the apt source itself, not a word about signing.
    expect(container.textContent).not.toMatch(/tự cập nhật|apt upgrade|keeps itself|ký số|chưa ký|\bsigned\b(?!-by)|unsigned|sha-?256|checksum|SHA256SUMS|git_sha/i);
  });
});
