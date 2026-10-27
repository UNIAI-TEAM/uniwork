import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { paths } from "@uniwork/core/paths";
import { QueryProvider } from "@uniwork/core/provider";

// The transports are the only mocks (the real schemas read the answers): the API for the
// public config, `fetch` for the release manifest. The shell is a pass-through because
// header, footer and closing banner have their own coverage.
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
import { AptInstall } from "./apps/apt-install";
import { assetUrl, jsonResponse, manifestUrls, testManifest } from "./office-download/test-manifest";
import viMessages from "@uniwork/core/i18n/locales/vi.json";
import enMessages from "@uniwork/core/i18n/locales/en.json";

const EDITORS = ["docs", "sheets", "slides", "pdf", "html", "markdown"] as const;
// The editor tabs only: the Download section has its own channel tabs.
const tabs = () => [...container.querySelectorAll<HTMLElement>("#office-editors [role=tab]")];
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
const fetchMock = vi.fn();
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const click = (element: Element | null | undefined) => act(async () => { (element as HTMLElement | null | undefined)?.click(); });
const radios = (group: string) => [...container.querySelectorAll<HTMLElement>(`${group} [role=radio]`)];
async function pickLinux() {
  await click(container.querySelector(".office-dl-others-trigger"));
  await click(radios(".office-dl-tiles").find((radio) => radio.getAttribute("aria-label") === "Linux"));
}
const WINDOWS_BETA = assetUrl("beta", "0.10.0-beta.1", "UniWork-Office_0.10.0-beta.1_unsigned_win32_x64-setup.exe");

beforeEach(async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(WINDOWS);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => jsonResponse(testManifest()));
  Element.prototype.scrollIntoView = scrollIntoView;
  await setLocale("vi");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  act(() => root.unmount());
  container.remove();
  request.mockReset();
  scrollIntoView.mockReset();
});


describe("the Office page", () => {
  it("keeps one editor selector and the selected example, without a second use-case grid", async () => {
    await render({ flags: {}, office_installers: installers });
    expect(container.querySelector("h1")?.textContent).toBe("UniOffice");
    expect(tabs()).toHaveLength(6);
    expect(container.querySelectorAll("#office-editors [role=tabpanel]")).toHaveLength(1);
    expect(container.querySelector(".office-editor-example")?.getAttribute("data-office-example")).toBe("draft");
    expect(container.querySelectorAll(".office-task, .office-trust, .office-editions")).toHaveLength(0);
    expect(container.querySelector("[data-faq]")?.getAttribute("data-count")).toBe("6");
  });

  it("offers the builds the release manifest lists, the visitor's first, without guessed download links", async () => {
    await render({ flags: {}, office_installers: installers });
    // The visitor's Windows build leads, on the most stable channel the manifest publishes.
    expect(hrefs("#office-download .office-dl-spot a[download]")).toEqual([WINDOWS_BETA]);
    expect(container.querySelector("#office-download .office-dl-spot-meta")?.textContent).toContain("Phiên bản 0.10.0-beta.1");
    const listed = manifestUrls(testManifest());
    for (const href of hrefs("#office-download a[download]")) expect(listed.has(href ?? "")).toBe(true);
    expect(container.querySelector(".office-hero-actions a")?.getAttribute("href")).toBe("#office-download");
    expect(hrefs(".office-hero-actions a")).toContain("/request-demo");
  });

  it("keeps the page usable when the manifest publishes nothing", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ schema: 1, channels: {} }));
    await render({ flags: {}, office_installers: { stable: [] } });
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelectorAll("#office-download [role=status]")).toHaveLength(1);
    expect(container.querySelector("#office-download [role=status] h3")?.textContent).toBe(viMessages.landing.office.download.states.emptyTitle);
  });

  it("degrades to the quiet fallback when both the manifest and the config answer drift", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ unexpected: true }));
    await render({ unexpected: true });
    await settle();
    expect(container.querySelectorAll("[download]")).toHaveLength(0);
    expect(container.querySelector("#office-download .office-dl-quiet-alert")?.textContent).toContain(viMessages.landing.office.download.states.error);
    expect(container.querySelector("h1")?.textContent).toBe("UniOffice");
  });

  it("changes the example, capabilities and media together when an editor is selected", async () => {
    await render({ flags: {}, office_installers: installers });
    await act(async () => { tabs()[1]?.click(); });
    expect(container.querySelector("#office-editors [role=tab][aria-selected=true]")?.textContent).toBe("Bảng tính");
    expect(container.querySelector(".office-editor-example")?.getAttribute("data-office-example")).toBe("data");
    expect(container.querySelector("#office-editors [role=tabpanel]")?.textContent).toContain(viMessages.landing.office.tasks.data.description);
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

  it("keeps the section's loading shell until the manifest arrives", async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    await render({ flags: {}, office_installers: installers });
    await settle();
    expect(container.querySelectorAll("#office-download .office-dl-skeleton[aria-busy=true] .office-dl-spot.is-skeleton")).toHaveLength(1);
    expect(container.querySelectorAll("#office-download [download], #office-download .office-dl-quiet-alert")).toHaveLength(0);
    await act(async () => { resolve(jsonResponse(testManifest())); });
    await settle();
    expect(container.querySelector("#office-download .office-dl-skeleton")).toBeNull();
    expect(hrefs("#office-download a[download]")).toEqual([WINDOWS_BETA]);
  });

  it("falls back to the published installers and recovers the manifest through its visible retry", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await render({ flags: {}, office_installers: installers });
    await settle();
    expect(container.querySelectorAll("#office-download .office-dl-quiet-alert")).toHaveLength(1);
    expect(container.querySelector(".office-dl-quiet-alert")?.textContent).toContain("Không tải được danh sách phiên bản");
    // Today's catalogue, never a guessed link: the visitor's Windows installer.
    expect(hrefs("#office-download a[download]")).toEqual([installers.stable[2]!.url]);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse(testManifest()));
    await act(async () => { container.querySelector<HTMLButtonElement>(".office-dl-quiet-alert button")?.click(); });
    await settle();
    expect(container.querySelectorAll(".office-dl-quiet-alert")).toHaveLength(0);
    expect(hrefs("#office-download a[download]")).toEqual([WINDOWS_BETA]);
  });

  it("keeps editor details available after a failed image, then recovers on tab change", async () => {
    await render({ flags: {}, office_installers: installers });
    await act(async () => { container.querySelector(".office-shot img")?.dispatchEvent(new Event("error")); });
    expect(container.querySelector(".office-preview-error")?.textContent).toBe(viMessages.landing.office.editors.imageUnavailable);
    expect(container.querySelector(".office-editor-example")?.textContent).toContain(viMessages.landing.office.tasks.draft.description);
    await act(async () => { tabs()[1]?.click(); });
    expect(container.querySelector(".office-preview-error")).toBeNull();
    expect(container.querySelectorAll(".office-shot img")).toHaveLength(2);
  });
  it("leads with the promise, a trial button to the download block and a demo request, above the editor preview", async () => {
    await render({ flags: {}, office_installers: installers });
    const hero = container.querySelector(".office-hero");
    expect(hero?.querySelector("h1")?.textContent).toBe("UniOffice");
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
    await render({ flags: {}, office_installers: installers });
    await pickLinux();
    const chips = () => radios(".office-dl-chip-row").map((radio) => radio.getAttribute("aria-label"));
    expect(chips()).toEqual([".deb", ".AppImage"]);
    expect(hrefs(".office-dl-picker-button")).toEqual([assetUrl("beta", "0.10.0-beta.1", "uniwork-office_0.10.0-beta.1_linux_x64.deb")]);
    act(() => root.unmount());
    root = createRoot(container);
    fetchMock.mockImplementation(async () => jsonResponse(testManifest({ skip: ["deb"] })));
    await render({ flags: {}, office_installers: installers });
    await pickLinux();
    expect(chips()).toEqual([".AppImage"]);
    expect(hrefs(".office-dl-picker-button")).toEqual([assetUrl("beta", "0.10.0-beta.1", "UniWork-Office_0.10.0-beta.1_linux_x64.AppImage")]);
  });

  describe("the apt install block", () => {
    const mirror = (channel: string, name: string) => `https://uniworkos.com/downloads/office/${channel}/1.2.0/${name}`;
    const deb = (channel: string) => ({ platform: "linux-x64-deb", kind: ".deb", url: mirror(channel, "UniWork-Office-1.2.0-amd64.deb"), version: "1.2.0" });
    const onDownloads = { dev: [{ platform: "win32-x64", kind: ".exe", url: mirror("dev", "UniWork-Office-1.2.0-x64.exe"), version: "1.2.0" }, deb("dev")] };
    const commands = () => [...container.querySelectorAll(".apt-code")].map((pre) => pre.textContent);
    // The block on its own: the Download section decides where it sits and which suite it gets.
    async function renderApt(config: unknown, suite?: "dev" | "beta" | "stable") {
      request.mockResolvedValue(config);
      await act(async () => { root.render(createElement(QueryProvider, null, createElement(AptInstall, suite ? { suite } : {}))); });
      await tick();
    }
    afterEach(() => { Reflect.deleteProperty(navigator, "clipboard"); });

    it("sits in the Linux part of the Download section, on the channel the section shows", async () => {
      await render({ flags: {}, office_installers: installers });
      // A Windows visitor: no apt until Linux is picked among the other systems.
      expect(container.querySelector("#office-download .apt-install")).toBeNull();
      await pickLinux();
      expect(container.querySelector("#office-download .office-dl-picker .apt-install")).not.toBeNull();
      expect(commands()[0]).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- beta");
      expect(commands()[1]).toContain("/apt/latest/beta/uniwork-office_amd64.deb");
      expect(commands()[2]).toContain("Suites: beta\n");
    });

    it("takes the catalogue's most stable channel without a suite prop, and dev when none is published", async () => {
      await renderApt({ flags: {}, office_installers: installers });
      expect(commands()[0]).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh");
      expect(commands()[1]).toContain("/apt/latest/uniwork-office_amd64.deb");
      expect(commands()[1]).not.toContain("/apt/latest/stable/");
      expect(commands()[2]).toContain("Suites: stable\n");
      act(() => root.unmount());
      root = createRoot(container);
      await renderApt({ unexpected: true });
      expect(commands()[0]).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- dev");
      expect(commands()[1]).toContain("/apt/latest/dev/uniwork-office_amd64.deb");
      expect(commands()[2]).toContain("Suites: dev\n");
    });

    it("never shows a stable line for a stable suite prop while the catalogue publishes no stable", async () => {
      await renderApt({ flags: {}, office_installers: onDownloads }, "stable");
      const [script, quick, setup] = commands();
      expect(script).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- dev");
      expect(quick).toContain("/apt/latest/dev/uniwork-office_amd64.deb");
      expect(setup).toContain("Suites: dev\n");
      expect(container.querySelector(".apt-install")?.textContent).not.toMatch(/stable/);
      act(() => root.unmount());
      root = createRoot(container);
      await renderApt({ flags: {}, office_installers: { ...onDownloads, beta: [deb("beta")] } }, "stable");
      const beta = commands();
      expect(beta[0]).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- beta");
      expect(beta[1]).toContain("/apt/latest/beta/uniwork-office_amd64.deb");
    });

    it("keeps a stable suite prop while the catalogue publishes stable", async () => {
      await renderApt({ flags: {}, office_installers: installers }, "stable");
      const [script, quick] = commands();
      expect(script).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh");
      expect(quick).toContain("/apt/latest/uniwork-office_amd64.deb");
    });

    it("takes the suite from its prop", async () => {
      await renderApt({ flags: {}, office_installers: installers }, "beta");
      const [script, quick, setup] = commands();
      expect(script).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- beta");
      expect(quick).toContain("/apt/latest/beta/uniwork-office_amd64.deb");
      expect(setup).toContain("Suites: beta\n");
    });

    it.each(["vi", "en"] as const)("shows two ways in, the key, the source, the install line and the fingerprint in %s", async (language) => {
      await setLocale(language);
      await renderApt({ flags: {}, office_installers: onDownloads });
      const apt = (language === "vi" ? viMessages : enMessages).landing.office.apt;
      expect(container.querySelector(".apt-install h4")?.textContent).toBe(apt.title);
      const [script, quick, setup, install] = commands();
      expect(script).toBe("curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- dev");
      expect(quick).toBe("wget -nv -O /tmp/uniwork-office.deb https://uniworkos.com/downloads/office/apt/latest/dev/uniwork-office_amd64.deb && sudo apt install /tmp/uniwork-office.deb");
      expect(setup).toContain("sudo curl -fsSL -o /usr/share/keyrings/uniwork-office-archive-keyring.gpg https://uniworkos.com/downloads/office/apt/key.gpg &&\nsudo tee /etc/apt/sources.list.d/uniwork-office.sources > /dev/null <<'EOF'");
      expect(setup).toContain("<<'EOF'\n# managed by uniwork-office\nTypes: deb\nURIs: https://uniworkos.com/downloads/office/apt\nSuites: dev\nComponents: main");
      expect(setup).toContain("Signed-By: /usr/share/keyrings/uniwork-office-archive-keyring.gpg");
      expect(install).toBe("sudo apt update && sudo apt install uniwork-office");
      const text = container.querySelector(".apt-install")?.textContent ?? "";
      expect(text).toContain("58A9 0232 2C8D 45C4 33B5 25F5 1198 D109 26F3 4831");
      expect(text).toContain(apt.deb);
      expect(container.querySelector(".apt-intro")?.textContent).toBe(apt.intro);
      // The two ways side by side, "or" between them, each with its label and a visible copy button.
      const ways = container.querySelectorAll(".apt-ways > .apt-block");
      expect(ways).toHaveLength(2);
      expect(ways[0]?.querySelector("h5")?.textContent).toBe(apt.script);
      expect(ways[1]?.querySelector("h5")?.textContent).toBe(apt.quick);
      expect(container.querySelector(".apt-ways > .apt-or")?.textContent).toBe(apt.or);
      expect(ways[0]?.querySelector("button")?.textContent).toBe(apt.copy);
      expect(text).not.toMatch(/recommended|fastest|verified|khuyên|nhanh nhất|xác minh|apt upgrade|tự cập nhật|later versions|phiên bản sau/i);
      expect(text).not.toMatch(/github|landing\./i);
    });

    it("folds the manual steps and the fingerprint into a disclosure that starts collapsed", async () => {
      await renderApt({ flags: {}, office_installers: onDownloads });
      const details = container.querySelector<HTMLDetailsElement>(".apt-install details");
      expect(details).not.toBeNull();
      expect(details?.open).toBe(false);
      expect(details?.querySelector("summary")?.textContent).toBe(viMessages.landing.office.apt.manual);
      // A visible open/closed cue that assistive tech skips; CSS turns it under details[open].
      expect(details?.querySelector("summary > svg.apt-chevron")?.getAttribute("aria-hidden")).toBe("true");
      const inside = [...(details?.querySelectorAll(".apt-code") ?? [])].map((pre) => pre.textContent);
      expect(inside).toEqual([commands()[2], commands()[3]]);
      expect(details?.textContent).toContain("58A9 0232 2C8D 45C4 33B5 25F5 1198 D109 26F3 4831");
      expect(details?.textContent).toContain(viMessages.landing.office.apt.deb);
      // Both one-line ways stay outside the fold.
      expect(details?.contains(container.querySelectorAll(".apt-code")[0] ?? null)).toBe(false);
      expect(details?.contains(container.querySelectorAll(".apt-code")[1] ?? null)).toBe(false);
    });

    it.each(["vi", "en"] as const)("gives every copy button its own name in %s", async (language) => {
      await setLocale(language);
      await renderApt({ flags: {}, office_installers: onDownloads });
      const buttons = [...container.querySelectorAll(".apt-install button")];
      const names = buttons.map((button) => button.getAttribute("aria-label"));
      const apt = (language === "vi" ? viMessages : enMessages).landing.office.apt;
      expect(names).toHaveLength(4);
      expect(new Set(names).size).toBe(4);
      expect(names[0]).toContain(apt.script);
      expect(names[1]).toContain(apt.quick);
      // The visible label is part of the name.
      for (const [index, button] of buttons.entries()) expect(names[index]).toContain(button.textContent);
    });

    it("copies a block and says so, or says it could not", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      await renderApt({ flags: {}, office_installers: onDownloads });
      const buttons = container.querySelectorAll<HTMLButtonElement>(".apt-block button");
      const statuses = container.querySelectorAll(".apt-block [aria-live]");
      await act(async () => { buttons[0]?.click(); });
      expect(writeText).toHaveBeenCalledWith(commands()[0]);
      // "Copied" is the button's own visible text, and it is announced.
      expect(buttons[0]?.textContent).toBe(viMessages.landing.office.apt.copied);
      expect(statuses[0]?.textContent).toBe(viMessages.landing.office.apt.copied);
      await act(async () => { buttons[1]?.click(); });
      expect(writeText).toHaveBeenLastCalledWith(commands()[1]);
      expect(commands()[1]).toContain("wget -nv -O /tmp/uniwork-office.deb");
      await act(async () => { buttons[3]?.click(); });
      expect(writeText).toHaveBeenLastCalledWith("sudo apt update && sudo apt install uniwork-office");
      writeText.mockRejectedValue(new Error("denied"));
      if (!("execCommand" in document)) Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: () => false });
      const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(false);
      await act(async () => { buttons[2]?.click(); });
      // A failure is visible text, not only an announcement.
      expect(statuses[2]?.textContent).toBe(viMessages.landing.office.apt.copyFailed);
      expect(statuses[2]?.classList.contains("sr-only")).toBe(false);
      execCommand.mockRestore();
    });

    it("gives each block its own heading id, so two on one page keep their own label", async () => {
      request.mockResolvedValue({ flags: {}, office_installers: installers });
      await act(async () => { root.render(createElement(QueryProvider, null, createElement("div", null, createElement(AptInstall), createElement(AptInstall, { suite: "beta" })))); });
      const sections = [...container.querySelectorAll(".apt-install")];
      const ids = sections.map((section) => section.querySelector("h4")?.id);
      expect(sections).toHaveLength(2);
      expect(ids[0]).toBeTruthy();
      expect(ids[0]).not.toBe(ids[1]);
      expect(sections.map((section) => section.getAttribute("aria-labelledby"))).toEqual(ids);
    });
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
