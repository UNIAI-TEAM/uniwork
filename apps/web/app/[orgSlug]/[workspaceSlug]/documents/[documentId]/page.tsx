"use client";

import { Suspense, lazy } from "react";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

// The detail view owns the lazy editor chunk; this route only reads params.
const DocumentDetailView = lazy(() =>
  import("@uniwork/views/documents/document-detail-view").then((mod) => ({
    default: mod.DocumentDetailView,
  })),
);

export default function DocumentDetailPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const { workspace } = useWorkspace();
  const { replace } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return (
    <Suspense fallback={null}>
      <DocumentDetailView
        wsId={workspace.id}
        documentId={documentId}
        libraryHref={ws.documents()}
        onBackToList={() => replace(ws.documents())}
      />
    </Suspense>
  );
}
