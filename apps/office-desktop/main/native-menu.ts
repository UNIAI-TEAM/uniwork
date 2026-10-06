export function createNativeMenuTemplate(channel: "dev" | "beta" | "stable", onSave: () => void, isMac = process.platform === "darwin", onCheckUpdates?: () => void) {
  const fileLabel = isMac ? "Tệp" : "File";
  const editLabel = isMac ? "Sửa" : "Edit";
  const viewLabel = isMac ? "Xem" : "View";
  const helpLabel = isMac ? "Trợ giúp" : "Help";
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: fileLabel, submenu: [{ label: "Lưu", accelerator: "CmdOrCtrl+S", click: onSave }, { role: "quit", label: "Thoát" }] },
    { label: editLabel, submenu: [{ role: "undo", label: "Hoàn tác" }, { role: "redo", label: "Làm lại" }, { type: "separator" }, { role: "cut", label: "Cắt" }, { role: "copy", label: "Sao chép" }, { role: "paste", label: "Dán" }, { role: "selectAll", label: "Chọn tất cả" }] },
  ];
  if (channel === "dev") template.push({ label: viewLabel, submenu: [{ role: "reload", label: "Tải lại" }, { role: "toggleDevTools", label: "Công cụ phát triển" }] });
  if (onCheckUpdates) template.push({ label: helpLabel, submenu: [{ label: "Kiểm tra cập nhật…", click: onCheckUpdates }] });
  return template;
}
