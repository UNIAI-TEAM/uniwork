"use client";

import type { ReactNode } from "react";
import { useNavigation } from "@uniwork/views/navigation";
import { DocxOpenSwitch, OfficeDocsFrame } from "@uniwork/views/office";
import type { OfficeEditorHostProps } from "../office/editor-host";

/** What the app layer hands the frame host: the pinned build and the route of a document in this workspace. */
export interface DocsFrameHostConfig {
  frameVersion: string;
  documentHref: (documentId: string) => string;
}

function DocsFrameHost(props: OfficeEditorHostProps & DocsFrameHostConfig) {
  const { document, wsId, readonly, className, frameVersion, documentHref } = props;
  const { push } = useNavigation();
  return (
    <OfficeDocsFrame
      wsId={wsId}
      documentId={document.id}
      title={document.title}
      frameVersion={frameVersion}
      readonly={readonly}
      className={className}
      // Save as made a new document and the frame already edits it; follow it so the URL names what is open.
      onSavedAs={(copyId) => push(documentHref(copyId))}
    />
  );
}

/**
 * A .docx opens in the genoffice Docs frame when `office_docs_web` is on for the
 * document's organization; the G3 editor (`fallback`) otherwise, and until the
 * flag's answer arrives. Only mounted when a build is pinned (see document-host).
 */
export function DocxFrameOrG3Host(props: OfficeEditorHostProps & DocsFrameHostConfig & { fallback: ReactNode }) {
  const { fallback, ...hostProps } = props;
  return (
    <DocxOpenSwitch
      organizationId={hostProps.document.organization_id}
      docsFrame={<DocsFrameHost {...hostProps} />}
      fallback={fallback}
    />
  );
}
