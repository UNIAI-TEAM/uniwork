"use client";

import type { ReactNode } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { DocxOpenSwitch, OfficeDocsFrame } from "@uniwork/views/office";
import type { OfficeEditorHostProps } from "../office/editor-host";
import { frameDesktopOpen, useOfficeDeploymentId } from "../office/desktop-open-props";
import { pinnedFrameVersion } from "./frame-versions";

function DocsFrameHost(props: OfficeEditorHostProps & { frameVersion: string }) {
  const { document, wsId, readonly, className, frameVersion } = props;
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const deploymentId = useOfficeDeploymentId(document.organization_id);
  return (
    <OfficeDocsFrame
      wsId={wsId}
      documentId={document.id}
      title={document.title}
      frameVersion={frameVersion}
      readonly={readonly}
      className={className}
      desktopOpen={frameDesktopOpen(document, deploymentId)}
      // Save as made a new document and the frame already edits it; follow it so the URL names what is open.
      onSavedAs={(copyId) => push(paths.workspace(workspace.organization_slug, workspace.slug).document(copyId))}
    />
  );
}

/**
 * A .docx opens in the genoffice Docs frame when `office_docs_web` is on for the
 * document's organization and a build is pinned; the G3 editor (`fallback`)
 * otherwise, and until the flag's answer arrives.
 */
export function DocxFrameOrG3Host(props: OfficeEditorHostProps & { fallback: ReactNode }) {
  const frameVersion = pinnedFrameVersion("docs");
  if (!frameVersion) return props.fallback;
  const { fallback, ...hostProps } = props;
  return (
    <DocxOpenSwitch
      organizationId={hostProps.document.organization_id}
      docsFrame={<DocsFrameHost {...hostProps} frameVersion={frameVersion} />}
      fallback={fallback}
    />
  );
}
