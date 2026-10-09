"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { createDocumentOfficeEditorHost, LoadingEditor } from "../office/document-office-host";
import type { OfficeEditorHostProps } from "../office/editor-host";

// The app-layer wiring of the Docs frame (UNI-1013). The document host in
// platform/office is browser-isolated (scripts/office/check-boundaries.mjs), so
// the build pin and the workspace routes are read here and injected into it.

const DocxFrameOrG3Host = dynamic(() => import("./docs-frame-host").then((module) => module.DocxFrameOrG3Host), { ssr: false, loading: LoadingEditor });

/**
 * The pinned frame build, inlined by next.config.mjs from docs.pin.json; empty
 * when no bundle is installed, in which case the frame is never offered.
 */
function pinnedDocsFrameVersion(): string {
  return process.env.NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION ?? "";
}

function PinnedDocsFrame(props: OfficeEditorHostProps & { fallback: ReactNode }) {
  const { workspace } = useWorkspace();
  const frameVersion = pinnedDocsFrameVersion();
  // No pinned build: the G3 editor alone, and no flag is asked.
  if (!frameVersion) return props.fallback;
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return <DocxFrameOrG3Host {...props} frameVersion={frameVersion} documentHref={(id) => ws.document(id)} />;
}

export const DocumentOfficeEditorHost = createDocumentOfficeEditorHost(PinnedDocsFrame);
