import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsMenuItems, useHeaderActionsMenuFilled } from "@uniwork/views/layout/header-actions-slot";
import { printOrientationFromCopy, type OfficePrintPort, type OfficePrintRequest } from "@uniwork/views/office/print";
import { createDesktopPrintPort, observePrintPort, printRequestPage, type DesktopPrintBridge } from "./text-print";

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

/** A print_timeout that lands while the window already has focus means the dialog
 * is gone (its callback never fired): the hint ends after this grace unless the
 * window blurs first, which hands the decision back to the next focus. */
const LINGER_FOCUSED_GRACE_MS = 3000;

/** Windows routes Electron's print through the system dialog, which gets no
 * preview from Chromium ("No preview available") while the printed pages are
 * right; no `webContents.print` option fills it. The renderer has no OS API,
 * so the user agent decides. */
function isWindowsHost(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

type DialogOrientation = "portrait" | "landscape" | "mixed";

/** The orientation line a print needs: a copy that holds both portrait and
 * landscape pages is mixed whatever its first page is (one job cannot be right
 * for both), else the page the print lays out decides. */
function dialogOrientation(request: OfficePrintRequest): DialogOrientation {
  if (printOrientationFromCopy(request.html) === "mixed") return "mixed";
  return printRequestPage(request)?.landscape === true ? "landscape" : "portrait";
}

/**
 * The desktop print port a shell hands every format view, plus the Windows
 * preview hint it shows while a print dialog is up. The view still owns every
 * outcome notice (busy, failed); the hint is the only host line.
 *
 * Prints are counted, not flagged: a second Print answered `print_busy` at once
 * must not hide the hint of the dialog that is still open. A `print_timeout`
 * means the same dialog outlived the callback wait, so the hint lingers until
 * a print settles with any other outcome or the app window regains focus after
 * the dialog (the rule main's own busy guard uses). A timeout answered while the
 * window is already focused ends it after a short grace instead.
 *
 * The dialog opens on the printer's default orientation whatever the print
 * options say (Electron passes them to Chromium's silent path only), so a
 * landscape page adds a line asking for Landscape, and a copy that mixes
 * portrait and landscape pages adds the line saying which pages get turned. The print that opened the
 * dialog decides it; one answered print_busy while it is up does not.
 */
export function useDesktopPrint(bridge: DesktopPrintBridge | undefined, windows: boolean = isWindowsHost()): { port: OfficePrintPort; hint: ReactNode } {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [inFlight, setInFlight] = useState(0);
  const [lingering, setLingering] = useState(false);
  const [orientation, setOrientation] = useState<DialogOrientation>("portrait");
  // "Is a dialog up" lives in refs updated synchronously by the same callbacks
  // that set the state: a print that fails in the tick it started (too large, no
  // bridge) is batched into one render with open false -> false, so an effect
  // keyed on `open` would never see it and the next print would keep a stale line.
  const pending = useRef(0);
  const lingerRef = useRef(false);
  const changeLingering = useCallback((next: boolean) => { lingerRef.current = next; setLingering(next); }, []);
  const port = useMemo(() => observePrintPort(createDesktopPrintPort(bridge), {
    onStart: (request) => {
      if (pending.current === 0 && !lingerRef.current) setOrientation(dialogOrientation(request));
      pending.current += 1;
      setInFlight((count) => count + 1);
    },
    onSettled: (outcome) => {
      pending.current = Math.max(0, pending.current - 1);
      setInFlight((count) => Math.max(0, count - 1));
      const reason = outcome?.outcome === "failed" ? outcome.reason : undefined;
      if (reason === "print_timeout") changeLingering(true);
      else if (reason !== "print_busy") changeLingering(false);
    },
  }), [bridge, changeLingering]);
  useEffect(() => {
    if (!lingering) return undefined;
    let sawBlur = !document.hasFocus();
    let grace = sawBlur ? undefined : setTimeout(() => changeLingering(false), LINGER_FOCUSED_GRACE_MS);
    const onBlur = () => { sawBlur = true; clearTimeout(grace); grace = undefined; };
    const onFocus = () => { if (sawBlur) changeLingering(false); };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(grace); window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus); };
  }, [lingering, changeLingering]);
  const shown = windows && (inFlight > 0 || lingering);
  const hint = shown ? <p role="status" className="pointer-events-none fixed bottom-6 left-1/2 z-50 max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg bg-popover px-3 py-2 text-caption text-popover-foreground shadow-md ring-1 ring-foreground/10" data-testid="print-preview-hint">{t("printPreviewHint")}{orientation === "portrait" ? null : <span className="mt-1 block">{t(orientation === "mixed" ? "printMixedOrientationHint" : "printLandscapeHint")}</span>}</p> : null;
  return { port, hint };
}
