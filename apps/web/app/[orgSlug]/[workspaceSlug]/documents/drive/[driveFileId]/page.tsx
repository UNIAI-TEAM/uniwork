"use client";

import { useParams } from "next/navigation";
import { useDriveFile } from "@uniwork/core/drive-library";
import { DriveFileDetailView } from "@uniwork/views/documents/drive/drive-file-detail-view";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useDocumentsTabTitle } from "@/platform/office-frame/tab-title";

export default function DriveFileDetailPage() {
  const { driveFileId } = useParams<{ driveFileId: string }>();
  const { workspace } = useWorkspace();
  useDocumentsTabTitle(useDriveFile(workspace.id, driveFileId).data?.name);

  return <DriveFileDetailView wsId={workspace.id} driveFileId={driveFileId} />;
}
