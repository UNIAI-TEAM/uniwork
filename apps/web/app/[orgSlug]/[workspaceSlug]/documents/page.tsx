"use client";

import { paths } from "@uniwork/core/paths";
import { DocumentsPageView } from "@uniwork/views/documents";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { useDocumentsTabTitle } from "@/platform/office/tab-title";

/** Route wiring only: the shell already provides auth, workspace and nav. */
export default function DocumentsPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  useDocumentsTabTitle();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return <DocumentsPageView wsId={workspace.id} onOpen={(id) => push(ws.document(id))} />;
}
