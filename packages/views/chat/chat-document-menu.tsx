"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, MonitorUp, RotateCcwClock, Share2, SquarePen, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isLegacyOfficeFormat } from "@uniwork/core/office/office-modules";
import type { Document } from "@uniwork/core/types/document";
import { paths } from "@uniwork/core/paths";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import type { FrameDesktopOpenProps } from "../office";
import { DesktopOpenAction, type DesktopOpenOutcome } from "../office/desktop-open-action";
import { ChatDocumentShare } from "./chat-document-share";
import { ChatDocumentUploadVersion } from "./chat-document-upload-version";
import type { ChatMenuParts } from "./chat-message-menu-items";
import { LegacyFormatDialog } from "../office/legacy-format-dialog";
import type { ChatMessage } from "./chat-messages";
type Surface = "share" | "upload" | "office" | "legacy";
/** The host-bound "Chỉnh sửa trong UniWork Office" wiring — the document page's own builder. */
export type ChatDocumentDesktopOpen = (
  document: Pick<Document, "id" | "organization_id" | "current_version">,
) => FrameDesktopOpenProps;

/**
 * A document card's role menu (UNI-2012 S7, contract D3): the entries the
 * message's `document` block grants, rendered into the message's own menu
 * (right click and "…") through `documentItems`, and the surfaces they open
 * (`surfaces`), which the row mounts outside the menu so closing the menu
 * never unmounts a dialog. Every gate is a field the server already put on
 * the block — no per-card document read — and every flag is opt-in: an
 * absent one hides its entry. A reader without access gets no entries (the
 * locked card keeps its request-access button), and so does a card without
 * a block. Inside the UniChat shell (D7) the host passes no `desktopOpen`,
 * so the Office entry hides, and the page entries leave the shell for the
 * browser through the shell's own navigation policy.
 */
export function useChatDocumentMenu({
  workspaceId,
  roomId,
  message,
  desktopOpen,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  /** The host's "Chỉnh sửa trong UniWork Office" wiring; absent (the UniChat shell, D7) hides the entry. */
  desktopOpen?: ChatDocumentDesktopOpen;
}): { documentItems?: (parts: ChatMenuParts) => ReactNode[]; surfaces: ReactNode; onOpenLegacy?: () => void } {
  const { t } = useTranslation();
  const workspace = useOptionalWorkspace()?.workspace;
  const navigation = useNavigation();
  const [requests, setRequests] = useState<Record<Surface, number>>({ share: 0, upload: 0, office: 0, legacy: 0 });
  const [legacyOpen, setLegacyOpen] = useState(false);
  const ask = (surface: Surface) => setRequests((current) => ({ ...current, [surface]: current[surface] + 1 }));
  const doc = message.document;
  if (!doc || doc.viewer_has_access === false) return { surfaces: null };

  const ws = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
  const go = (href: string) => () => navigation.push(href);
  const openPage = ws ? go(ws.document(doc.document_id)) : null;
  const openHistory = ws ? go(ws.documentVersions(doc.document_id)) : null;
  const canEdit = doc.viewer_level === "edit" || doc.viewer_level === "manage";
  const isLegacy = isLegacyOfficeFormat({ format: doc.format, filename: doc.title ?? message.body });
  // The web editor opens only what the frame can load: an explicit false
  // (version 0, archived, module off) or a legacy format (.doc/.xls/.ppt)
  // leaves an editor the read-and-comment page; absent keeps the level's label.
  const editOnWeb = canEdit && !isLegacy && doc.can_open_in_app !== false;
  const canUpload = doc.viewer_can_upload_version === true && Boolean(doc.revision);
  const canShare = doc.viewer_can_manage === true;
  // The server alone decides openability (module + version + not archived):
  // an absent `can_open_in_app` is drift, not consent, and mints no session (RFC-03);
  // legacy formats (.doc/.xls/.ppt) open in UniWork Office when a version exists.
  const desktop =
    canEdit && desktopOpen && workspace && doc.viewer_has_access === true && (doc.can_open_in_app === true || (isLegacy && (doc.version_number ?? 0) > 0))
      ? desktopOpen({ id: doc.document_id, organization_id: workspace.organization_id, current_version: doc.version_number ?? 1 })
      : undefined;
  const desktopForModal =
    requests.legacy > 0 && isLegacy && desktopOpen && workspace && doc.viewer_has_access === true
      ? (desktop ?? desktopOpen({ id: doc.document_id, organization_id: workspace.organization_id, current_version: doc.version_number ?? 1 }))
      : undefined;
  const onOpenLegacy = isLegacy
    ? () => {
        ask("legacy");
        setLegacyOpen(true);
      }
    : undefined;
  if (!openPage && !canUpload && !canShare && !desktop) return { surfaces: null };

  const icon = "size-4.5";
  const documentItems = (P: ChatMenuParts) => [
    desktop ? (
      <P.Item key="office" onClick={() => ask("office")}>
        <MonitorUp className={icon} aria-hidden />
        {t("chat.document_menu.edit_in_office")}
      </P.Item>
    ) : null,
    openPage ? (
      <P.Item key="page" onClick={openPage}>
        {editOnWeb ? <SquarePen className={icon} aria-hidden /> : <ExternalLink className={icon} aria-hidden />}
        {editOnWeb ? t("chat.document_menu.edit_on_web") : t("chat.document_menu.open_to_view")}
      </P.Item>
    ) : null,
    canUpload ? (
      <P.Item key="upload" onClick={() => ask("upload")}>
        <Upload className={icon} aria-hidden />
        {t("documents.actions.upload_version")}
      </P.Item>
    ) : null,
    openHistory ? (
      <P.Item key="history" onClick={openHistory}>
        <RotateCcwClock className={icon} aria-hidden />
        {t("chat.document_menu.version_history")}
      </P.Item>
    ) : null,
    canShare ? (
      <P.Item key="share" onClick={() => ask("share")}>
        <Share2 className={icon} aria-hidden />
        {t("documents.actions.share")}
      </P.Item>
    ) : null,
  ];

  const surfaces = (
    <>
      {requests.share > 0 && canShare ? (
        <ChatDocumentShare workspaceId={workspaceId} documentId={doc.document_id} request={requests.share} />
      ) : null}
      {requests.upload > 0 && canUpload && doc.revision ? (
        <ChatDocumentUploadVersion
          workspaceId={workspaceId}
          roomId={roomId}
          documentId={doc.document_id}
          revision={doc.revision}
          request={requests.upload}
          onOpenDocument={openPage ?? undefined}
        />
      ) : null}
      {requests.office > 0 && desktop ? (
        <ChatDocumentOfficeLaunch desktop={desktop} documentId={doc.document_id} request={requests.office} />
      ) : null}
      {requests.legacy > 0 && isLegacy ? (
        <LegacyFormatDialog
          open={legacyOpen}
          onOpenChange={setLegacyOpen}
          documentId={doc.document_id}
          savedVersion={doc.version_number ?? 1}
          operation={canEdit ? "edit" : "view"}
          desktopOpen={desktopForModal}
        />
      ) : null}
    </>
  );
  return { documentItems, surfaces, onOpenLegacy };
}

/**
 * The desktop hand-off behind "Chỉnh sửa trong UniWork Office": the page's own
 * flow (launch session, deep link, install prompt) with no trigger of its own.
 * Mounted on the first ask; each ask runs the flow once.
 */
function ChatDocumentOfficeLaunch({
  desktop,
  documentId,
  request,
}: {
  desktop: FrameDesktopOpenProps;
  documentId: string;
  request: number;
}) {
  const requestRef = useRef<(() => Promise<DesktopOpenOutcome>) | null>(null);
  // The child fills the ref in its own effect, which runs before this one.
  useEffect(() => {
    if (request > 0) void requestRef.current?.();
  }, [request]);
  return (
    <DesktopOpenAction {...desktop} documentId={documentId} placement="menu" operation="edit" requestRef={requestRef} />
  );
}
