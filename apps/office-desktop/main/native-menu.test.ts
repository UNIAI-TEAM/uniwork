import { describe, expect, it } from "vitest";
import { BRAND_PRODUCT_NAME } from "./branding";
import { createNativeMenuTemplate } from "./native-menu";

describe("native menu branding", () => {
  it("gives macOS an app menu named after the product, with About", () => {
    const template = createNativeMenuTemplate("dev", () => undefined, true);
    expect(template[0]?.label).toBe(BRAND_PRODUCT_NAME);
    const items = template[0]?.submenu as Electron.MenuItemConstructorOptions[];
    expect(items[0]).toEqual({ role: "about", label: `Giới thiệu ${BRAND_PRODUCT_NAME}` });
    expect(items.at(-1)).toEqual({ role: "quit", label: `Thoát ${BRAND_PRODUCT_NAME}` });
    expect(template[1]?.label).toBe("Tệp");
  });

  it("puts About under Help on Windows and Linux", () => {
    const template = createNativeMenuTemplate("stable", () => undefined, false);
    expect(template[0]?.label).toBe("File");
    expect(template.at(-1)).toEqual({ label: "Help", submenu: [{ role: "about", label: `Giới thiệu ${BRAND_PRODUCT_NAME}` }] });
    const withUpdates = createNativeMenuTemplate("stable", () => undefined, false, () => undefined);
    expect((withUpdates.at(-1)?.submenu as Electron.MenuItemConstructorOptions[]).map((item) => item.role ?? item.label)).toEqual(["Kiểm tra cập nhật…", "about"]);
  });

  it("never names a menu after Electron", () => {
    for (const isMac of [true, false]) {
      expect(JSON.stringify(createNativeMenuTemplate("dev", () => undefined, isMac, () => undefined))).not.toContain("Electron");
    }
  });
});
