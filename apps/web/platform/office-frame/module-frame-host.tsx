"use client";

import { paths } from "@uniwork/core/paths";
import type { Document } from "@uniwork/core/types/document";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { launchCommentId } from "@uniwork/core/office";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { useReportFrameComments } from "@uniwork/views/documents";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { downloadDocumentFile } from "@uniwork/core/api/endpoints/documents";
import { DesktopOpenAction, OfficeFrameUnavailable, type FrameDesktopOpenProps, OfficeModuleFrame, OfficeModuleOpenSwitch, OfficeTooLargeNotice, OfficeTooLargeProvider } from "@uniwork/views/office";
import { desktopOpenAllowed, useFrameDesktopOpen } from "./desktop-open-props";
import { pinnedFrameVersion } from "./frame-versions";

/** What the document page hands its Office host. */
export interface OfficeEditorHostProps {
  document: Document;
  wsId: string;
  readonly: boolean;
  className?: string;
  /** The document page's resolved Office format when it has one; the host
   * trusts it instead of re-reading the flags, so a format whose gate the
   * leave guards still hold stays routed to its module. */
  officeFormat?: string | null;
}

type ModuleHostProps = OfficeEditorHostProps & { module: OfficeModule };

function ModuleFrameHost(props: ModuleHostProps & { frameVersion: string; desktopOpen: FrameDesktopOpenProps }) {
  const { module, document, wsId, readonly, className, frameVersion, desktopOpen } = props;
  const { workspace } = useWorkspace();
  const { push, searchParams } = useNavigation();
  const reportFrameComments = useReportFrameComments();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return (
    <OfficeModuleFrame
      module={module}
      wsId={wsId}
      fileRef={{ kind: "document", id: document.id }}
      title={document.title}
      frameVersion={frameVersion}
      readonly={readonly}
      className={className}
      libraryHref={ws.documents()}
      myLevel={document.my_level}
      fileSizeBytes={document.file?.size_bytes}
      // An unnamed blank's first save asks for its name on the page (UNI-1847, SAVE-01).
      documentDetail={document}
      // A comment deep link (?comment=<id>): the editor's panel reveals it when it has comments.
      revealCommentId={searchParams.get("comment")}
      // A frame that serves comments is the page's one comments panel: the page hides its own.
      onFrameCommentsChange={reportFrameComments}
      desktopOpen={desktopOpen}
      // Save as made a new document and the frame already edits it; follow it so the URL names what is open.
      onSavedAs={(copyId) => push(ws.document(copyId))}
    />
  );
}

async function downloadFile(document: Document) {
  const blob = await downloadDocumentFile(document.id);
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url; link.download = document.file?.filename ?? document.title;
  window.document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A document of a genoffice module (docx, pdf, md, html, pptx, xlsx) opens in
 * its module frame (UNI-1013..1016); the web has no other editor. Every case
 * the frame cannot open carries the same two ways on: "Open in UniWork Office"
 * (the document page's launch-ticket action, only for a user who may edit) and
 * the file's own download, provided here for the refusal notice and every
 * frame failure. A frame that reports `open_refused` (or `too_large` on the
 * worksheet XML gate) gets the refusal notice; a module with no installed
 * build or whose flag is off gets the unavailable notice; any other failure
 * the frame's own error with Retry.
 */
export function OfficeModuleHost(props: ModuleHostProps) {
  const { module, document, readonly } = props;
  const { searchParams } = useNavigation();
  // A `?comment=` link hands its comment to the app too, so "Open in UniWork Office" lands on the thread.
  const desktopOpen = { ...useFrameDesktopOpen(document), commentId: launchCommentId(searchParams.get("comment")) };
  const frameVersion = pinnedFrameVersion(module);
  const actions = {
    desktopAction: desktopOpenAllowed({ open: true, readonly })
      ? <DesktopOpenAction {...desktopOpen} documentId={document.id} placement="inline" />
      : null,
    onDownload: () => downloadFile(document),
  };
  const tooLarge = <OfficeTooLargeNotice format={officeModuleSpec(module).format} />;
  return (
    <OfficeTooLargeProvider value={actions}>
      {!frameVersion ? (
        <OfficeFrameUnavailable module={module} reason="not_installed" />
      ) : (
        <OfficeModuleOpenSwitch
          module={module}
          organizationId={document.organization_id}
          frame={<ModuleFrameHost {...props} frameVersion={frameVersion} desktopOpen={desktopOpen} />}
          tooLarge={tooLarge}
        />
      )}
    </OfficeTooLargeProvider>
  );
}
