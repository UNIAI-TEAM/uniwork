"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { exportDocumentAccessReport } from "@uniwork/core/api/endpoints/documents-access-report";
import type { AccessReportExportFormat, AccessReportFilters } from "@uniwork/core/types/document-access-report";

/** Hand a fetched file to the browser to save. */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on the next task: Safari reads the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `access-report-<workspace>-20261015T0340Z.csv`, for a server that did not name the file. */
function fallbackName(workspaceSlug: string, format: AccessReportExportFormat): string {
  const stamp = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}Z`;
  return `access-report-${workspaceSlug}-${stamp}.${format}`;
}

/**
 * CSV / Excel export of the report in view. The server builds the file from
 * the same filters; this only fetches it and saves it under the server's name.
 * One export at a time — `busy` names the format in flight.
 */
export function useAccessReportExport(
  wsId: string,
  workspaceSlug: string,
  query: AccessReportFilters & { folderId?: string },
) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<AccessReportExportFormat | null>(null);
  const { folderId, personId, visibility } = query;
  const levelKey = (query.levels ?? []).join(",");

  const run = useCallback(
    (format: AccessReportExportFormat) => {
      if (busy) return;
      setBusy(format);
      const levels = levelKey ? levelKey.split(",") : [];
      exportDocumentAccessReport(wsId, { folderId, personId, visibility, levels }, format)
        .then(({ blob, filename }) => saveFile(blob, filename ?? fallbackName(workspaceSlug, format)))
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.code === "access_report_too_large") {
            const max = typeof err.fields?.max_rows === "number" ? err.fields.max_rows : 10000;
            toast.error(t("documents.accessReport.too_large", { max }));
            return;
          }
          toast.error(t("documents.accessReport.export_failed"));
        })
        .finally(() => setBusy(null));
    },
    [busy, wsId, workspaceSlug, folderId, personId, visibility, levelKey, t],
  );

  return { busy, run };
}
