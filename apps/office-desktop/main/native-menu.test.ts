import { describe, expect, it } from "vitest";
import { BRAND_PRODUCT_NAME } from "./branding";
import { createNativeMenuTemplate } from "./native-menu";
import { mainStrings } from "./strings";

type Item = Electron.MenuItemConstructorOptions;
const submenu = (item: Item | undefined) => item?.submenu as Item[];
const quits = (template: Item[]) => template.flatMap((menu) => submenu(menu) ?? []).filter((item) => item.role === "quit");

describe("native menu branding", () => {
  it("gives macOS an app menu named after the product, with About", () => {
    const template = createNativeMenuTemplate("dev", () => undefined, true);
    expect(template[0]?.label).toBe(BRAND_PRODUCT_NAME);
    const items = submenu(template[0]);
    expect(items[0]).toEqual({ role: "about", label: `Giới thiệu ${BRAND_PRODUCT_NAME}` });
    expect(items.at(-1)).toEqual({ role: "quit", label: `Thoát ${BRAND_PRODUCT_NAME}` });
    expect(template[1]?.label).toBe("Tệp");
  });

  it("has exactly one Quit on every platform (macOS keeps it in the app menu)", () => {
    const mac = createNativeMenuTemplate("dev", () => undefined, true, () => undefined);
    expect(quits(mac)).toEqual([{ role: "quit", label: `Thoát ${BRAND_PRODUCT_NAME}` }]);
    expect(submenu(mac[1]).map((item) => item.label)).toEqual(["Lưu"]);
    const windows = createNativeMenuTemplate("dev", () => undefined, false, () => undefined);
    expect(quits(windows)).toEqual([{ role: "quit", label: "Thoát" }]);
  });

  it("puts About under Help on Windows and Linux", () => {
    const template = createNativeMenuTemplate("stable", () => undefined, false);
    expect(template[0]?.label).toBe("Tệp");
    expect(template.at(-1)).toEqual({ label: "Trợ giúp", submenu: [{ role: "about", label: `Giới thiệu ${BRAND_PRODUCT_NAME}` }] });
    const withUpdates = createNativeMenuTemplate("stable", () => undefined, false, () => undefined);
    expect(submenu(withUpdates.at(-1)).map((item) => item.role ?? item.label)).toEqual(["Kiểm tra cập nhật…", "about"]);
  });

  it("follows the app language", () => {
    const en = mainStrings("en");
    const windows = createNativeMenuTemplate("dev", () => undefined, false, () => undefined, en);
    expect(windows.map((menu) => menu.label)).toEqual(["File", "Edit", "View", "Help"]);
    expect(submenu(windows[1]).map((item) => item.label).filter(Boolean)).toEqual(["Undo", "Redo", "Cut", "Copy", "Paste", "Select All"]);
    expect(submenu(windows.at(-1)).map((item) => item.label)).toEqual(["Check for Updates…", `About ${BRAND_PRODUCT_NAME}`]);
    const mac = createNativeMenuTemplate("stable", () => undefined, true, undefined, en);
    expect(submenu(mac[0]).map((item) => item.label).filter(Boolean)).toEqual([`About ${BRAND_PRODUCT_NAME}`, `Hide ${BRAND_PRODUCT_NAME}`, "Hide Others", "Show All", `Quit ${BRAND_PRODUCT_NAME}`]);
    // No Vietnamese left in the English menu.
    expect(JSON.stringify([windows, mac])).not.toMatch(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i);
  });

  it("never names a menu after Electron", () => {
    for (const isMac of [true, false]) {
      expect(JSON.stringify(createNativeMenuTemplate("dev", () => undefined, isMac, () => undefined))).not.toContain("Electron");
    }
  });
});
