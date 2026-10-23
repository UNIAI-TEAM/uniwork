"use client";

import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { AccessReportView } from "@uniwork/views/documents/access-report/access-report-view";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useDocumentsTabTitle } from "@/platform/office-frame/tab-title";

/** Route wiring only: the folder and the filters ride the query string the view reads. */
export default function DocumentsAccessReportPage() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  useDocumentsTabTitle(t("documents.accessReport.title"));
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return (
    <AccessReportView
      wsId={workspace.id}
      workspaceName={workspace.name}
      workspaceSlug={workspace.slug}
      libraryHref={ws.documents()}
      documentHref={(id) => ws.document(id)}
    />
  );
}
