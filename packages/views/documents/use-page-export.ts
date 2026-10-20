"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api";
import type { PageExportFormat } from "@uniwork/core/api/endpoints/documents-page-export";
import { useExportDocumentPage } from "@uniwork/core/documents/hooks";
import type { Document } from "@uniwork/core/types/document";

// Refusals that mean "this deployment cannot render the format" rather than
// "try again": no engine, no PDF renderer staged, an engine without export.
const UNAVAILABLE = new Set(["office_not_configured", "engine_incompatible", "unsupported_operation"]);

/** Exports a UniNote page (UNI-2004) and hands the file to the browser, named
 *  by the server (the page title) or by the title the client has. */
export function usePageExport(doc: Document): (format: PageExportFormat) => void {
  const { t } = useTranslation();
  const mutation = useExportDocumentPage(doc.id);
  return (format) => {
    const toastId = toast.loading(t("documents.actions.exporting"));
    void mutation.mutateAsync(format).then(
      ({ blob, filename }) => {
        toast.dismiss(toastId);
        const url = URL.createObjectURL(blob);
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = filename ?? `${doc.title.trim() || "UniNote"}.${format}`;
        anchor.rel = "noopener";
        window.document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      },
      (error: unknown) => {
        const key = UNAVAILABLE.has(errorCode(error) ?? "") ? "documents.actions.export_unavailable" : "documents.actions.export_failed";
        toast.error(t(key), { id: toastId });
      },
    );
  };
}
