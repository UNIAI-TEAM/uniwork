import { BRAND_PRODUCT_NAME } from "./branding";
import { mainStrings, type MainStrings } from "./strings";

/** The application menu in the app language (`t` from main/strings.ts). */
export function createNativeMenuTemplate(channel: "dev" | "beta" | "stable", onSave: () => void, isMac = process.platform === "darwin", onCheckUpdates?: () => void, t: MainStrings = mainStrings("vi"), onPrint?: () => void) {
  const product = { product: BRAND_PRODUCT_NAME };
  const about: Electron.MenuItemConstructorOptions = { role: "about", label: t("officeDesktop.native.menu.about", product) };
  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS turns the first menu into the app menu; give it the product's
    // own items so File is not swallowed under Electron's name. Quit lives
    // there only, so File carries no second Quit on macOS.
    ...(isMac ? [{ label: BRAND_PRODUCT_NAME, submenu: [about, { type: "separator" }, { role: "hide", label: t("officeDesktop.native.menu.hide", product) }, { role: "hideOthers", label: t("officeDesktop.native.menu.hideOthers") }, { role: "unhide", label: t("officeDesktop.native.menu.showAll") }, { type: "separator" }, { role: "quit", label: t("officeDesktop.native.menu.quitApp", product) }] } satisfies Electron.MenuItemConstructorOptions] : []),
    { label: t("officeDesktop.native.menu.file"), submenu: [{ label: t("officeDesktop.native.menu.save"), accelerator: "CmdOrCtrl+S", click: onSave },
      // Print opens the open document's print dialog. The chord stays with
      // print-shortcut.ts (before-input-event, frames included): the menu only
      // shows it, so one key press never prints twice.
      ...(onPrint ? [{ label: t("officeDesktop.native.menu.print"), accelerator: "CmdOrCtrl+P", registerAccelerator: false, click: onPrint } satisfies Electron.MenuItemConstructorOptions] : []), ...(isMac ? [] : [{ role: "quit", label: t("officeDesktop.native.menu.quit") } satisfies Electron.MenuItemConstructorOptions])] },
    { label: t("officeDesktop.native.menu.edit"), submenu: [{ role: "undo", label: t("officeDesktop.native.menu.undo") }, { role: "redo", label: t("officeDesktop.native.menu.redo") }, { type: "separator" }, { role: "cut", label: t("officeDesktop.native.menu.cut") }, { role: "copy", label: t("officeDesktop.native.menu.copy") }, { role: "paste", label: t("officeDesktop.native.menu.paste") }, { role: "selectAll", label: t("officeDesktop.native.menu.selectAll") }] },
  ];
  if (channel === "dev") template.push({ label: t("officeDesktop.native.menu.view"), submenu: [{ role: "reload", label: t("officeDesktop.native.menu.reload") }, { role: "toggleDevTools", label: t("officeDesktop.native.menu.devTools") }] });
  const help: Electron.MenuItemConstructorOptions[] = [...(onCheckUpdates ? [{ label: t("officeDesktop.native.menu.checkUpdates"), click: onCheckUpdates }] : []), ...(isMac ? [] : [about])];
  if (help.length > 0) template.push({ label: t("officeDesktop.native.menu.help"), submenu: help });
  return template;
}
