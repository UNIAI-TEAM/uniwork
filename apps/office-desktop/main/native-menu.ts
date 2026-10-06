import { BRAND_PRODUCT_NAME } from "./branding";

export function createNativeMenuTemplate(channel: "dev" | "beta" | "stable", onSave: () => void, isMac = process.platform === "darwin", onCheckUpdates?: () => void) {
  const fileLabel = isMac ? "Tệp" : "File";
  const editLabel = isMac ? "Sửa" : "Edit";
  const viewLabel = isMac ? "Xem" : "View";
  const helpLabel = isMac ? "Trợ giúp" : "Help";
  const about: Electron.MenuItemConstructorOptions = { role: "about", label: `Giới thiệu ${BRAND_PRODUCT_NAME}` };
  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS turns the first menu into the app menu; give it the product's
    // own items so File is not swallowed under Electron's name.
    ...(isMac ? [{ label: BRAND_PRODUCT_NAME, submenu: [about, { type: "separator" }, { role: "hide", label: `Ẩn ${BRAND_PRODUCT_NAME}` }, { role: "hideOthers", label: "Ẩn ứng dụng khác" }, { role: "unhide", label: "Hiện tất cả" }, { type: "separator" }, { role: "quit", label: `Thoát ${BRAND_PRODUCT_NAME}` }] } satisfies Electron.MenuItemConstructorOptions] : []),
    { label: fileLabel, submenu: [{ label: "Lưu", accelerator: "CmdOrCtrl+S", click: onSave }, { role: "quit", label: "Thoát" }] },
    { label: editLabel, submenu: [{ role: "undo", label: "Hoàn tác" }, { role: "redo", label: "Làm lại" }, { type: "separator" }, { role: "cut", label: "Cắt" }, { role: "copy", label: "Sao chép" }, { role: "paste", label: "Dán" }, { role: "selectAll", label: "Chọn tất cả" }] },
  ];
  if (channel === "dev") template.push({ label: viewLabel, submenu: [{ role: "reload", label: "Tải lại" }, { role: "toggleDevTools", label: "Công cụ phát triển" }] });
  const help: Electron.MenuItemConstructorOptions[] = [...(onCheckUpdates ? [{ label: "Kiểm tra cập nhật…", click: onCheckUpdates }] : []), ...(isMac ? [] : [about])];
  if (help.length > 0) template.push({ label: helpLabel, submenu: help });
  return template;
}
