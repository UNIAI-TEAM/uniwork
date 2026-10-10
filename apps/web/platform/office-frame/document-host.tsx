"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { paths } from "@uniwork/core/paths";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleForFormat } from "@uniwork/core/office/office-modules";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { createDocumentOfficeEditorHost, LoadingEditor } from "../office/document-office-host";
import type { OfficeEditorHostProps } from "../office/editor-host";
import { pinnedFrameVersion } from "./frame-versions";

// The app-layer wiring of the genoffice frames (UNI-1013 Docs, UNI-1014/1015/1016
// the other modules). The document host in platform/office is browser-isolated
// (scripts/office/check-boundaries.mjs), so the build pins and the workspace
// routes are read here and injected into it.

const DocxFrameOrG3Host = dynamic(() => import("./docs-frame-host").then((module) => module.DocxFrameOrG3Host), { ssr: false, loading: LoadingEditor });
const ModuleFrameOrG3Host = dynamic(() => import("./module-frame-host").then((module) => module.ModuleFrameOrG3Host), { ssr: false, loading: LoadingEditor });

function PinnedFrame(props: OfficeEditorHostProps & { module: OfficeModule; fallback: ReactNode }) {
  const { workspace } = useWorkspace();
  const frameVersion = pinnedFrameVersion(props.module);
  // No pinned build for this module: the G3 editor alone, and no flag is asked.
  if (!frameVersion) return props.fallback;
  if (props.module === "docs") {
    const { module: _docs, ...docsProps } = props;
    const ws = paths.workspace(workspace.organization_slug, workspace.slug);
    return <DocxFrameOrG3Host {...docsProps} frameVersion={frameVersion} documentHref={(id) => ws.document(id)} />;
  }
  return <ModuleFrameOrG3Host {...props} />;
}

export const DocumentOfficeEditorHost = createDocumentOfficeEditorHost<OfficeModule>({ moduleForFormat: officeModuleForFormat, Frame: PinnedFrame });
