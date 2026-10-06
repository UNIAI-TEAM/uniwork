"use client";

// UNI-952 (E-docx): the one DOCX print entry point. The View ribbon (Export and
// print > Print), the Export-PDF dialog's Print button, the page header's
// overflow-menu item and Ctrl/Cmd+P all call `runDocxPrint`, which builds the
// document copy (./docx-print) from the CURRENT format state and hands it to
// the injected port. Outcomes: `cancelled` is silent, `print_busy` shows the
// neutral "already open" status, any other failure the generic error. There
// is no automatic retry, and a second request on the same port while one is
// pending is ignored (one print dialog per port; two editors with their own
// ports never block each other).
// A host without a port gets no entry at all (`context.print` absent).

import { Printer } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { isPrintBusy, type OfficePrintPort } from "../../print";
import { useDocxDocumentScope } from "../editor-store";
import { scopedRibbonController } from "../toolbar/groups/ribbon-open-store";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { printDocxDocument } from "./docx-print";
import { resolveDocxPrintHeaderFooter } from "./docx-print-header-footer";

/** i18next keys this module reads. */
const DOCX_PRINT_KEYS = {
  // The shared, format-neutral Print label every view contributes to the header menu.
  menuItem: "office.common.print",
  busy: "office.docx.export.printBusy",
  failed: "office.docx.export.printFailed",
} as const;

type DocxPrintNoticeKind = "busy" | "failed";

// UNI-957: one notice per document, so a hidden tab never shows another
// document's print outcome.
const printNoticeFor = scopedRibbonController<DocxPrintNoticeKind | null>(null);
// Ports with a job in flight. Both shipped ports settle (the browser one
// synchronously, the desktop one answers print_timeout), so an entry is never
// stuck; keying by port keeps one editor's job from blocking another's.
const pendingPorts = new WeakSet<OfficePrintPort>();

/** How long a print notice stays before it clears itself. */
const NOTICE_MS = 6000;

type DocxPrintContext = Pick<DocxToolbarGroupContext, "commands" | "print" | "docScope">;

/** Build the copy from the live document and print it through the injected port. */
export async function runDocxPrint(context: DocxPrintContext): Promise<void> {
  const { commands, print, docScope } = context;
  if (!commands || !print || pendingPorts.has(print.port)) return;
  const printNotice = printNoticeFor(docScope);
  pendingPorts.add(print.port);
  printNotice.set(null);
  try {
    const outcome = await printDocxDocument({
      port: print.port,
      title: print.title,
      buildCopy: () => {
        // Read the state at click time: the page-setup dialog may have just changed a section.
        const state = commands.getState();
        return commands.buildDocxPrintCopy({
          title: print.title,
          sections: state.docxPageSetup?.sections ?? null,
          headerFooter: resolveDocxPrintHeaderFooter(
            commands.docxPrintHeaderFooterSource(),
            state.docxHeaderFooter ?? null,
            commands.listDocxHeaderFooterEdits(),
          ),
        });
      },
    });
    if (outcome.outcome === "failed") printNotice.set(isPrintBusy(outcome) ? "busy" : "failed");
  } finally {
    pendingPorts.delete(print.port);
  }
}

interface DocxPrintMenuItemProps extends DocxPrintContext {
  /** A document is open (`docxExportReady`). */
  ready: boolean;
}

/** The page header overflow-menu entry. Render it only when `print` is set. */
export function DocxPrintMenuItem({ ready, ...context }: DocxPrintMenuItemProps) {
  const { t } = useTranslation();
  const disabled = !context.commands || !ready;
  return (
    <DropdownMenuItem
      className="gap-2 px-2 py-2"
      data-testid="docx-header-print"
      disabled={disabled}
      onClick={() => {
        void runDocxPrint(context);
      }}
    >
      <Printer aria-hidden className="size-3.5" />
      {t(DOCX_PRINT_KEYS.menuItem)}
    </DropdownMenuItem>
  );
}

/** The print outcome line: a polite status that survives on both hosts (no toast provider assumed). Mounted once by DocxEditor. */
export function DocxPrintNotice() {
  const { t } = useTranslation();
  const printNotice = printNoticeFor(useDocxDocumentScope());
  const notice = useSyncExternalStore(printNotice.subscribe, printNotice.get, printNotice.get);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => printNotice.set(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, printNotice]);
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex justify-center px-4">
      {notice ? (
        <p
          data-testid="docx-print-notice"
          data-print-notice={notice}
          className="max-w-md rounded-md border border-border bg-popover px-3 py-2 text-caption text-popover-foreground shadow-md"
        >
          {t(notice === "busy" ? DOCX_PRINT_KEYS.busy : DOCX_PRINT_KEYS.failed)}
        </p>
      ) : null}
    </div>
  );
}
