import { paths } from "@uniwork/core/paths";
import type { DesktopOS } from "@uniwork/core/office";

export type AppKey = "web" | "office" | "unichat";
export type PhoneOS = "ios" | "android";
/** The public config catalogue a desktop app's installers come from. */
export type InstallerCatalogue = "office_installers" | "unichat_installers";

export interface AppEntry {
  key: AppKey;
  /** Where the app is explained. */
  href: string;
  installers: InstallerCatalogue | null;
  /** Phone builds come from the public config's `unichat_stores`. */
  stores: boolean;
  desktops: readonly DesktopOS[];
}

/**
 * One entry per app of the ecosystem (UNI-1913). The Apps menu, the /apps
 * hub, its download table, "more apps" and the footer read this list, so a
 * new app is one entry here plus its page.
 */
export const APP_CATALOG: readonly AppEntry[] = [
  { key: "web", href: paths.root(), installers: null, stores: false, desktops: [] },
  { key: "office", href: paths.apps.office(), installers: "office_installers", stores: false, desktops: ["macos", "windows", "linux"] },
  { key: "unichat", href: paths.apps.unichat(), installers: "unichat_installers", stores: true, desktops: ["macos", "windows", "linux"] },
];

export const DESKTOP_ORDER: readonly DesktopOS[] = ["macos", "windows", "linux"];
export const PHONE_ORDER: readonly PhoneOS[] = ["ios", "android"];

/** The other phone first: a phone visitor's own store already leads. */
export function otherPhone(phone: PhoneOS): PhoneOS {
  return phone === "ios" ? "android" : "ios";
}
