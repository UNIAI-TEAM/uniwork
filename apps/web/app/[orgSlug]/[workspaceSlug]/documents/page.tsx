"use client";

import { paths } from "@uniwork/core/paths";
import { DocumentsPageView } from "@uniwork/views/documents";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { useDocumentsDesktopOpen, useOfficeHomeLaunch } from "@/platform/office-frame/desktop-open-props";
import { pinnedFrameVersion } from "@/platform/office-frame/frame-versions";
import { useDocumentsTabTitle } from "@/platform/office-frame/tab-title";

/** Route wiring only: the shell already provides auth, workspace and nav. */
export default function DocumentsPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  useDocumentsTabTitle();
  const desktopOpen = useDocumentsDesktopOpen(workspace.organization_id);
  const officeHome = useOfficeHomeLaunch(workspace.organization_id);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return <DocumentsPageView wsId={workspace.id} onOpen={(id) => push(ws.document(id))} desktopOpen={desktopOpen} officeHome={officeHome} officeFrameVersion={pinnedFrameVersion} />;
}
