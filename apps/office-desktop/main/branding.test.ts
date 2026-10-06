import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DESKTOP_IDENTITY_MANIFEST, getChannelIdentity } from "../shared/identity";
import { APP_USER_MODEL_ID, BRAND_PRODUCT_NAME, aboutPanelOptions, applyAppBranding, brandIconPath, brandWindowTitle, formatWindowTitle, printWindowTitle, type BrandableApp } from "./branding";
// @ts-expect-error -- the packaging script is plain ESM without declarations.
import { createPackagerConfig } from "../scripts/package.mjs";

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const channel = DESKTOP_IDENTITY_MANIFEST.build.channel;

function fakeApp(isPackaged = true): BrandableApp & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isPackaged,
    setName: (name) => calls.push(`name:${name}`),
    setAppUserModelId: (id) => calls.push(`aumid:${id}`),
    setAboutPanelOptions: (options) => calls.push(`about:${options.applicationName}:${options.iconPath ?? "-"}`),
    dock: { setIcon: (image) => calls.push(`dock:${image}`) },
  };
}

describe("desktop branding", () => {
  it("names the app after the channel product the installer shortcut carries", () => {
    expect(BRAND_PRODUCT_NAME).toBe(getChannelIdentity(channel).product);
    expect(BRAND_PRODUCT_NAME).toMatch(/^UniWork Office/);
    const config = createPackagerConfig({ platform: "win32", arch: "x64", channel });
    expect(config.nsis.shortcutName).toBe(BRAND_PRODUCT_NAME);
    expect(config.productName).toBe(BRAND_PRODUCT_NAME);
  });

  it("declares the AppUserModelId the installer gives its shortcut", () => {
    const config = createPackagerConfig({ platform: "win32", arch: "x64", channel });
    expect(APP_USER_MODEL_ID).toBe(config.appId);
    for (const profile of ["dev", "beta", "stable"] as const) {
      expect(createPackagerConfig({ platform: "win32", arch: "x64", channel: profile }).appId).toBe(getChannelIdentity(profile).appId);
    }
  });

  it("formats each window kind", () => {
    const product = "UniWork Office (test)";
    expect(formatWindowTitle("main", undefined, product)).toBe(product);
    expect(formatWindowTitle("main", "  ", product)).toBe(product);
    // A document named like the product keeps its name: only empty means "no document".
    expect(formatWindowTitle("main", "UniWork Office", product)).toBe(`UniWork Office - ${product}`);
    expect(formatWindowTitle("main", product, product)).toBe(`${product} - ${product}`);
    expect(formatWindowTitle("print", "UniWork Office", product)).toBe("UniWork Office");
    expect(formatWindowTitle("main", "Báo cáo\nquý.docx", product)).toBe(`Báo cáo quý.docx - ${product}`);
    expect(formatWindowTitle("dialog", "Cập nhật", product)).toBe(`Cập nhật - ${product}`);
    expect(formatWindowTitle("dialog", undefined, product)).toBe(product);
    expect(formatWindowTitle("print", "Báo cáo.docx", product)).toBe("Báo cáo.docx");
    expect(formatWindowTitle("print", "", product)).toBe(product);
    expect(printWindowTitle(undefined)).toBe(BRAND_PRODUCT_NAME);
    expect(printWindowTitle("Kế hoạch.xlsx")).toBe("Kế hoạch.xlsx");
    expect(formatWindowTitle("main", "Hợp đồng.docx")).toBe(`Hợp đồng.docx - ${BRAND_PRODUCT_NAME}`);
  });

  it("never lets an empty title fall back to Electron's default, and keeps a document named Electron", () => {
    for (const kind of ["main", "print", "dialog"] as const) {
      for (const subject of [undefined, "", " \n "]) expect(formatWindowTitle(kind, subject)).toBe(BRAND_PRODUCT_NAME);
    }
    expect(formatWindowTitle("main", "Electron")).toBe(`Electron - ${BRAND_PRODUCT_NAME}`);
  });

  it("picks the icon each platform reads", () => {
    expect(brandIconPath("win32", "/dist")).toBe(join("/dist", "icons", "icon.ico"));
    expect(brandIconPath("linux", "/dist")).toBe(join("/dist", "icons", "icon.png"));
    expect(brandIconPath("darwin", "/dist")).toBe(join("/dist", "icons", "icon.png"));
  });

  it("ships the icon sources the build and the installer read", () => {
    for (const file of ["icon.ico", "icon.png", "icons/16x16.png", "icons/256x256.png", "icons/512x512.png"]) {
      expect(existsSync(join(appDirectory, "build", file)), file).toBe(true);
    }
  });

  it("brands the process per platform before any window exists", () => {
    const win = fakeApp();
    applyAppBranding(win, "win32", "C:/dist/icons/icon.ico");
    expect(win.calls).toEqual([`name:${BRAND_PRODUCT_NAME}`, `aumid:${APP_USER_MODEL_ID}`, `about:${BRAND_PRODUCT_NAME}:C:/dist/icons/icon.ico`]);

    // Linux keeps the packaged name so WM_CLASS still matches StartupWMClass.
    const linux = fakeApp();
    applyAppBranding(linux, "linux", "/dist/icons/icon.png");
    expect(linux.calls).toEqual([`about:${BRAND_PRODUCT_NAME}:/dist/icons/icon.png`]);

    const macDev = fakeApp(false);
    applyAppBranding(macDev, "darwin", "/dist/icons/icon.png");
    expect(macDev.calls).toEqual([`name:${BRAND_PRODUCT_NAME}`, `about:${BRAND_PRODUCT_NAME}:-`, "dock:/dist/icons/icon.png"]);

    const macPackaged = fakeApp(true);
    applyAppBranding(macPackaged, "darwin", "/dist/icons/icon.png");
    expect(macPackaged.calls).toEqual([`name:${BRAND_PRODUCT_NAME}`, `about:${BRAND_PRODUCT_NAME}:-`]);
  });

  it("fills the About panel with version, channel and engine provenance", () => {
    expect(aboutPanelOptions()).toEqual({
      applicationName: BRAND_PRODUCT_NAME,
      applicationVersion: DESKTOP_IDENTITY_MANIFEST.build.appVersion,
      version: `${DESKTOP_IDENTITY_MANIFEST.build.channel} · ${DESKTOP_IDENTITY_MANIFEST.build.buildId}`,
      credits: `Engine ${DESKTOP_IDENTITY_MANIFEST.engine.version}`,
      copyright: "© UniWork",
      website: "https://uniwork.unicomhub.com",
    });
    expect(aboutPanelOptions({ iconPath: "/i.png" }).iconPath).toBe("/i.png");
  });

  it("keeps the main window titled after the active document", () => {
    let listener: ((event: { preventDefault(): void }, title: string) => void) | undefined;
    const setTitle = vi.fn();
    brandWindowTitle({ setTitle, on: (_event, next) => { listener = next; } });
    expect(setTitle).toHaveBeenLastCalledWith(BRAND_PRODUCT_NAME);
    const preventDefault = vi.fn();
    listener?.({ preventDefault }, "Báo cáo.docx");
    expect(preventDefault).toHaveBeenCalled();
    expect(setTitle).toHaveBeenLastCalledWith(`Báo cáo.docx - ${BRAND_PRODUCT_NAME}`);
    // The home tab and the first load (renderer/index.html) hand back an empty title.
    listener?.({ preventDefault }, "");
    expect(setTitle).toHaveBeenLastCalledWith(BRAND_PRODUCT_NAME);
    listener?.({ preventDefault }, "UniWork Office");
    expect(setTitle).toHaveBeenLastCalledWith(`UniWork Office - ${BRAND_PRODUCT_NAME}`);
  });
});
