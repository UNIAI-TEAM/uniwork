"use client";

import { useMemo } from "react";
import { DocxOpenSwitch, OfficeDocsFrame } from "@uniwork/views/office";
import type { OfficeEditorHostProps } from "../office/editor-host";
import { createDocsFrameApi } from "./docs-frame-api";

/**
 * The pinned frame build, inlined by next.config.mjs from docs.pin.json; empty
 * when no bundle is pinned, in which case the frame is never offered.
 */
export function pinnedDocsFrameVersion(): string {
  return process.env.NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION ?? "";
}

function DocsFrameHost(props: OfficeEditorHostProps & { frameVersion: string }) {
  const { document, wsId, readonly, className, frameVersion } = props;
  const api = useMemo(() => createDocsFrameApi(), []);
  return (
    <OfficeDocsFrame
      wsId={wsId}
      documentId={document.id}
      title={document.title}
      frameVersion={frameVersion}
      api={api}
      readonly={readonly}
      className={className}
    />
  );
}

/**
 * A .docx opens in the genoffice Docs frame when `office_docs_web` is on for the
 * document's organization and a build is pinned; the G3 editor (`fallback`)
 * otherwise, and until the flag's answer arrives.
 */
export function DocxFrameOrG3Host(props: OfficeEditorHostProps & { fallback: React.ReactNode }) {
  const frameVersion = pinnedDocsFrameVersion();
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
