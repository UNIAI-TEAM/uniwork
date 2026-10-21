"use client";

import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, errorClassOf, errorCode, errorFields } from "@uniwork/core/api";
import type { PageExportFormat } from "@uniwork/core/api/endpoints/documents-page-export";
import { useExportDocumentPage, usePageExportUnavailable } from "@uniwork/core/documents/hooks";
import type { Document } from "@uniwork/core/types/document";
import { downloadBlob } from "../editor/utils/mermaid-export";

// Refusals that mean "this deployment cannot render the format" rather than
// "try again": no engine, an engine the server refuses, no PDF renderer
// staged, an engine of another contract, an engine without export.
const UNAVAILABLE = new Set([
  "office_not_configured",
  "office_unavailable",
  "engine_incompatible",
  "protocol_mismatch",
  "contract_mismatch",
  "unsupported_operation",
]);
// No engine at all, or one the server cannot use: neither format will work.
const NO_ENGINE = new Set(["office_not_configured", "office_unavailable"]);

/** The locale key for a failed export: the server's retryable flag decides "try again". */
function exportErrorKey(error: unknown): string {
  const code = errorCode(error) ?? "";
  if (UNAVAILABLE.has(code)) return "documents.actions.export_unavailable";
  if (errorClassOf(error) === "quota" || code === "upload_bounds") return "documents.actions.export_too_large";
  // A failure that never reached the server (offline) or one it flags retryable is worth another try.
  if (!(error instanceof ApiError) || errorFields(error)?.retryable === true) return "documents.actions.export_failed";
  return "documents.actions.export_failed_permanent";
}

/** A title as a file name: no path or reserved characters, never empty. */
function fileName(title: string, format: PageExportFormat): string {
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in a file name
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().slice(0, 150);
  return `${safe || "UniNote"}.${format}`;
}

/**
 * Exports a UniNote page (UNI-2004) and hands the file to the browser, named
 * by the server (the page title) or by the title the client has. One export
 * runs at a time; a format the deployment cannot render is reported once and
 * then left out of the menu for the rest of the session.
 */
export function usePageExport(doc: Document): {
  exportPage: (format: PageExportFormat) => void;
  exporting: boolean;
  unavailable: ReadonlySet<PageExportFormat>;
} {
  const { t } = useTranslation();
  const mutation = useExportDocumentPage(doc.id);
  // The state flag lags a render; the ref stops a second click in the same tick.
  const running = useRef(false);
  const formats = usePageExportUnavailable((s) => s.formats);
  const markUnavailable = usePageExportUnavailable((s) => s.markUnavailable);
  const unavailable = useMemo<ReadonlySet<PageExportFormat>>(() => new Set(formats), [formats]);
  const exportPage = (format: PageExportFormat) => {
    if (running.current) return;
    running.current = true;
    const label = format.toUpperCase();
    const toastId = toast.loading(t("documents.actions.exporting", { format: label }));
    void mutation
      .mutateAsync(format)
      .then(
        ({ blob, filename }) => {
          toast.dismiss(toastId);
          downloadBlob(blob, filename ?? fileName(doc.title, format));
        },
        (error: unknown) => {
          const code = errorCode(error) ?? "";
          if (UNAVAILABLE.has(code)) {
            markUnavailable(NO_ENGINE.has(code) ? ["docx", "pdf"] : [format]);
          }
          toast.error(t(exportErrorKey(error), { format: label }), { id: toastId });
        },
      )
      .finally(() => {
        running.current = false;
      });
  };
  return { exportPage, exporting: mutation.isPending, unavailable };
}
