"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import type { FolderAccessSummary } from "./folder-contents-access-model";
import { knownWarnings } from "./folder-contents-access-model";

/**
 * The dry-run answer of the folder contents access dialog (UNI-2244 §7): what
 * will change, what is skipped, who loses access (replace only) and one line
 * per warning. It only draws `summary`; the dialog owns the buttons.
 */
export function FolderContentsAccessSummary({ summary }: { summary: FolderAccessSummary }) {
  const { t } = useTranslation();
  const { preview, mode } = summary;
  const nothing = preview.changed === 0;
  const parts = [
    t("documents.folderAccess.summary_changed", { count: preview.changed }),
    t("documents.folderAccess.summary_skipped", { count: preview.skipped_not_manageable }),
  ];
  if (preview.skipped_locked > 0) parts.push(t("documents.folderAccess.summary_locked", { count: preview.skipped_locked }));
  const warnings = knownWarnings(preview);

  return (
    <section aria-label={t("documents.folderAccess.confirm")} className="flex min-w-0 flex-col gap-3" data-testid="folder-access-summary">
      <p className="text-body font-medium break-words text-foreground">{parts.join(" · ")}</p>
      {nothing ? (
        <p role="status" className="text-body break-words text-muted-foreground">
          {t("documents.folderAccess.nothing_to_change")}
        </p>
      ) : null}
      {mode === "replace" && preview.losing_users > 0 ? (
        <p className="text-body break-words text-foreground">
          {t("documents.folderAccess.summary_losing", { count: preview.losing_users })}
        </p>
      ) : null}
      {warnings.map((code) => (
        <Alert key={code} variant="warning" role="note" data-testid={`folder-access-warning-${code}`}>
          <TriangleAlert aria-hidden />
          <AlertDescription className="break-words">
            {code === "downgrade"
              ? t("documents.folderAccess.warning_downgrade", { count: preview.downgraded_users })
              : t(`documents.folderAccess.warning_${code}`)}
          </AlertDescription>
        </Alert>
      ))}
    </section>
  );
}
