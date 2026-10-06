import { Children, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsMenuItems, useHeaderActionsMenuFilled } from "@uniwork/views/layout/header-actions-slot";
import type { OfficePrintPort } from "@uniwork/views/office/print";
import { createDesktopPrintPort, observePrintPort, type DesktopPrintBridge } from "./text-print";

/** The header overflow control. Inline rather than a lucide import: the
 * desktop package does not depend on the icon set directly. */
function MoreIcon() {
  return <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
}

/**
 * The desktop document "Thêm" (⋯) menu, one component for every tab shell.
 * Under a `HeaderActionsSlotProvider` it also renders the items the mounted
 * format view contributes through `HeaderActionsFill menuItems` (Print, ...),
 * so a view's entry shows on desktop exactly as it does in the web page menu.
 * Host items come first, the view's after. With neither there is no trigger:
 * the menu is never empty.
 */
export function DesktopDocumentMenu({ children }: { children?: ReactNode }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office" });
  const contributed = useHeaderActionsMenuFilled();
  if (!contributed && Children.toArray(children).length === 0) return null;
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("ribbon.more")} title={t("ribbon.more")} data-office-document-menu />}>
      <MoreIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-56">
      {children}
      <HeaderActionsMenuItems />
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Windows routes Electron's print through the system dialog, which gets no
 * preview from Chromium ("No preview available") while the printed pages are
 * right; no `webContents.print` option fills it. The renderer has no OS API,
 * so the user agent decides. */
function isWindowsHost(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

/**
 * The desktop print port a shell hands every format view, plus the Windows
 * preview hint it shows while that print's dialog is up. The view still owns
 * every outcome notice (busy, failed); the hint is the only host line.
 */
export function useDesktopPrint(bridge: DesktopPrintBridge | undefined, windows: boolean = isWindowsHost()): { port: OfficePrintPort; hint: ReactNode } {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [shown, setShown] = useState(false);
  const port = useMemo(() => observePrintPort(createDesktopPrintPort(bridge), { onStart: () => setShown(windows), onSettled: () => setShown(false) }), [bridge, windows]);
  const hint = shown ? <p role="status" className="px-4 py-2 text-caption text-muted-foreground" data-testid="print-preview-hint">{t("printPreviewHint")}</p> : null;
  return { port, hint };
}
