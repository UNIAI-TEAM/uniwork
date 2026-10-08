/** Main-process copy: the native menu, the update dialog and the platform-gate
 * box. The renderer's copy lives in packages/core/i18n/locales and needs
 * i18next; main carries this small table instead, under keys named like the
 * renderer's (`officeDesktop.native.*`), so the two read as one dictionary.
 * The deployment-profile import confirmations live here too: they are native
 * dialogs main opens itself. */
export type DesktopLocale = "vi" | "en";

/** The locales main has copy for. main/strings.test.ts fails when the shared
 * renderer locales (SUPPORTED_LOCALES) and this list differ. */
export const DESKTOP_MAIN_LOCALES: readonly DesktopLocale[] = ["vi", "en"];

/** The desktop app speaks Vietnamese unless the user's language is one it
 * carries: the product's Vietnamese teams are its audience. */
const DESKTOP_MAIN_FALLBACK_LOCALE: DesktopLocale = "vi";

const vi = {
  "officeDesktop.native.menu.about": "Giới thiệu {{product}}",
  "officeDesktop.native.menu.hide": "Ẩn {{product}}",
  "officeDesktop.native.menu.hideOthers": "Ẩn ứng dụng khác",
  "officeDesktop.native.menu.showAll": "Hiện tất cả",
  "officeDesktop.native.menu.quitApp": "Thoát {{product}}",
  "officeDesktop.native.menu.file": "Tệp",
  "officeDesktop.native.menu.save": "Lưu",
  "officeDesktop.native.menu.print": "In…",
  "officeDesktop.native.menu.quit": "Thoát",
  "officeDesktop.native.menu.edit": "Sửa",
  "officeDesktop.native.menu.undo": "Hoàn tác",
  "officeDesktop.native.menu.redo": "Làm lại",
  "officeDesktop.native.menu.cut": "Cắt",
  "officeDesktop.native.menu.copy": "Sao chép",
  "officeDesktop.native.menu.paste": "Dán",
  "officeDesktop.native.menu.selectAll": "Chọn tất cả",
  "officeDesktop.native.menu.view": "Xem",
  "officeDesktop.native.menu.reload": "Tải lại",
  "officeDesktop.native.menu.devTools": "Công cụ phát triển",
  "officeDesktop.native.menu.help": "Trợ giúp",
  "officeDesktop.native.menu.checkUpdates": "Kiểm tra cập nhật…",
  "officeDesktop.native.update.title": "Cập nhật",
  "officeDesktop.native.update.disabled": "Bản dựng này chưa hỗ trợ cập nhật tự động.",
  "officeDesktop.native.update.failed": "Không thể cập nhật. Ứng dụng vẫn đang mở.",
  "officeDesktop.native.update.code": "Mã: {{code}}",
  "officeDesktop.native.update.close": "Đóng",
  "officeDesktop.native.profile.pickTitle": "Chọn tệp cấu hình UniWork Office",
  "officeDesktop.native.profile.pickFilter": "Tệp cấu hình",
  "officeDesktop.native.profile.importTitle": "Kết nối site UniWork",
  "officeDesktop.native.profile.importMessage": "Kết nối UniWork Office với {{host}}?",
  "officeDesktop.native.profile.importDetail": "Địa chỉ: {{rawHost}}\nMã triển khai: {{deploymentId}}\n\nChỉ kết nối nếu đây là site UniWork của tổ chức bạn. UniWork Office sẽ khởi động lại.",
  "officeDesktop.native.profile.connect": "Kết nối",
  "officeDesktop.native.profile.cancel": "Hủy",
  "officeDesktop.native.profile.resetTitle": "Đặt lại kết nối",
  "officeDesktop.native.profile.resetMessage": "Ngắt kết nối khỏi {{host}}?",
  "officeDesktop.native.profile.resetMessageUnknown": "Xóa tệp cấu hình đã chọn?",
  "officeDesktop.native.profile.resetDetail": "Phiên đăng nhập lưu trên máy này cũng bị xóa. UniWork Office sẽ khởi động lại để bạn chọn tệp cấu hình khác.",
  "officeDesktop.native.profile.resetDetailUnknown": "Tệp cấu hình này bị hỏng nên không xác định được site UniWork; phiên đăng nhập đã lưu trên máy (nếu có) được giữ nguyên. UniWork Office sẽ khởi động lại để bạn chọn tệp cấu hình khác.",
  "officeDesktop.native.profile.reset": "Đặt lại",
} as const;

type MainStringKey = keyof typeof vi;

const en: Record<MainStringKey, string> = {
  "officeDesktop.native.menu.about": "About {{product}}",
  "officeDesktop.native.menu.hide": "Hide {{product}}",
  "officeDesktop.native.menu.hideOthers": "Hide Others",
  "officeDesktop.native.menu.showAll": "Show All",
  "officeDesktop.native.menu.quitApp": "Quit {{product}}",
  "officeDesktop.native.menu.file": "File",
  "officeDesktop.native.menu.save": "Save",
  "officeDesktop.native.menu.print": "Print…",
  "officeDesktop.native.menu.quit": "Quit",
  "officeDesktop.native.menu.edit": "Edit",
  "officeDesktop.native.menu.undo": "Undo",
  "officeDesktop.native.menu.redo": "Redo",
  "officeDesktop.native.menu.cut": "Cut",
  "officeDesktop.native.menu.copy": "Copy",
  "officeDesktop.native.menu.paste": "Paste",
  "officeDesktop.native.menu.selectAll": "Select All",
  "officeDesktop.native.menu.view": "View",
  "officeDesktop.native.menu.reload": "Reload",
  "officeDesktop.native.menu.devTools": "Developer Tools",
  "officeDesktop.native.menu.help": "Help",
  "officeDesktop.native.menu.checkUpdates": "Check for Updates…",
  "officeDesktop.native.update.title": "Update",
  "officeDesktop.native.update.disabled": "This build does not support automatic updates yet.",
  "officeDesktop.native.update.failed": "Couldn't update. The app is still open.",
  "officeDesktop.native.update.code": "Code: {{code}}",
  "officeDesktop.native.update.close": "Close",
  "officeDesktop.native.profile.pickTitle": "Choose the UniWork Office configuration file",
  "officeDesktop.native.profile.pickFilter": "Configuration file",
  "officeDesktop.native.profile.importTitle": "Connect to a UniWork site",
  "officeDesktop.native.profile.importMessage": "Connect UniWork Office to {{host}}?",
  "officeDesktop.native.profile.importDetail": "Address: {{rawHost}}\nDeployment: {{deploymentId}}\n\nConnect only if this is your organization's UniWork site. UniWork Office will restart.",
  "officeDesktop.native.profile.connect": "Connect",
  "officeDesktop.native.profile.cancel": "Cancel",
  "officeDesktop.native.profile.resetTitle": "Reset connection",
  "officeDesktop.native.profile.resetMessage": "Disconnect from {{host}}?",
  "officeDesktop.native.profile.resetMessageUnknown": "Remove the chosen configuration file?",
  "officeDesktop.native.profile.resetDetail": "The sign-in saved on this computer is removed too. UniWork Office will restart so you can choose another configuration file.",
  "officeDesktop.native.profile.resetDetailUnknown": "This configuration file is damaged, so its UniWork site can't be identified; any sign-in saved on this computer is kept. UniWork Office will restart so you can choose another configuration file.",
  "officeDesktop.native.profile.reset": "Reset",
};

const TABLES: Readonly<Record<DesktopLocale, Record<MainStringKey, string>>> = { vi, en };

export type MainStrings = (key: MainStringKey, values?: Readonly<Record<string, string>>) => string;

/** Look up main copy for one locale; `{{name}}` takes `values.name`. */
export function mainStrings(locale: DesktopLocale): MainStrings {
  const table = TABLES[locale];
  return (key, values = {}) => table[key].replace(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? match);
}

/** The app language, from the list main/appearance.ts systemLanguages builds:
 * an explicit `--lang` switch alone when present, otherwise the OS preferred
 * languages, most preferred first. The first tag whose primary subtag main
 * (and the renderer) carries wins, so ["fr-FR", "en-US"] is English and
 * ["fr"] or [] is Vietnamese. renderer/appearance.ts pickDesktopLocale applies
 * the same rule to the same list; main/strings.test.ts holds the two together. */
export function resolveDesktopLocale(languages: readonly string[]): DesktopLocale {
  for (const tag of languages) {
    const primary = tag.split(/[-_]/)[0]?.toLowerCase();
    const supported = DESKTOP_MAIN_LOCALES.find((locale) => locale === primary);
    if (supported) return supported;
  }
  return DESKTOP_MAIN_FALLBACK_LOCALE;
}
