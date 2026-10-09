"use client";

import { Suspense, lazy } from "react";
import { useParams } from "next/navigation";
import { useDocument } from "@uniwork/core/documents/hooks";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { DocumentOfficeEditorHost } from "@/platform/office-frame/document-host";
import { useDocumentsTabTitle } from "@/platform/office/tab-title";

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
  // Same query key as the detail view: a cache read, not a second request.
  useDocumentsTabTitle(useDocument(workspace.id, documentId).data?.title);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return (
    <Suspense fallback={null}>
      <DocumentDetailView
        wsId={workspace.id}
        documentId={documentId}
        libraryHref={ws.documents()}
        documentHref={(id) => ws.document(id)}
        // No ownerHref until C-14 ships a work-product route: the owner crumb
        // is a label rather than a guessed /projects/{work_product_id} URL
        // (FE r1 FE-02).
        onBackToList={() => replace(ws.documents())}
        officeEditorHost={DocumentOfficeEditorHost}
      />
    </Suspense>
  );
}
