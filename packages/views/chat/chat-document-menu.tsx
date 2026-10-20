"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, MonitorUp, RotateCcwClock, Share2, SquarePen, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Document } from "@uniwork/core/types/document";
import { paths } from "@uniwork/core/paths";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import type { FrameDesktopOpenProps } from "../office";
import { DesktopOpenAction, type DesktopOpenOutcome } from "../office/desktop-open-action";
import { ChatDocumentShare } from "./chat-document-share";
import { ChatDocumentUploadVersion } from "./chat-document-upload-version";
import type { ChatMenuParts } from "./chat-message-menu-items";
import type { ChatMessage } from "./chat-messages";

/** The host-bound "Chỉnh sửa trong UniWork Office" wiring — the document page's own builder. */
export type ChatDocumentDesktopOpen = (
  document: Pick<Document, "id" | "organization_id" | "current_version">,
) => FrameDesktopOpenProps;

type Surface = "share" | "upload" | "office";

/**
 * A document card's role menu (UNI-2012 S7, contract D3): the entries the
 * message's `document` block grants, rendered into the message's own menu
 * (right click and "…") through `documentItems`, and the surfaces they open
 * (`surfaces`), which the row mounts outside the menu so closing the menu
 * never unmounts a dialog. Every gate is a field the server already put on
 * the block — no per-card document read — and every flag is opt-in: an
 * absent one hides its entry. A reader without access gets no entries (the
 * locked card keeps its request-access button), and so does a card without
 * a block.
 */
export function useChatDocumentMenu({
  workspaceId,
  roomId,
  message,
  desktopOpen,
  officeApp = true,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  desktopOpen?: ChatDocumentDesktopOpen;
  /** False hides "Chỉnh sửa trong UniWork Office" (the chat-only shell, D7); the web shows it. */
  officeApp?: boolean;
}): { documentItems?: (parts: ChatMenuParts) => ReactNode; surfaces: ReactNode } {
  const { t } = useTranslation();
  const workspace = useOptionalWorkspace()?.workspace;
  const navigation = useNavigation();
  const [requests, setRequests] = useState<Record<Surface, number>>({ share: 0, upload: 0, office: 0 });
  const ask = (surface: Surface) => setRequests((current) => ({ ...current, [surface]: current[surface] + 1 }));
  const doc = message.document;
  if (!doc || doc.viewer_has_access === false) return { surfaces: null };

  const ws = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
  const go = (href: string) => () => navigation.push(href);
  const openPage = ws ? go(ws.document(doc.document_id)) : null;
  const openHistory = ws ? go(ws.documentVersions(doc.document_id)) : null;
  const canEdit = doc.viewer_level === "edit" || doc.viewer_level === "manage";
  const canUpload = doc.viewer_can_upload_version === true && Boolean(doc.revision);
  const canShare = doc.viewer_can_manage === true;
  // The server alone decides openability (module + version + not archived):
  // an absent `can_open_in_app` is drift, not consent, and mints no session (RFC-03).
  const desktop =
    officeApp && canEdit && desktopOpen && workspace && doc.viewer_has_access === true && doc.can_open_in_app === true
      ? desktopOpen({ id: doc.document_id, organization_id: workspace.organization_id, current_version: doc.version_number ?? 0 })
      : undefined;

  if (!openPage && !canUpload && !canShare && !desktop) return { surfaces: null };

  const icon = "size-4.5";
  const documentItems = (P: ChatMenuParts) => (
    <>
      {desktop ? (
        <P.Item onClick={() => ask("office")}>
          <MonitorUp className={icon} aria-hidden />
          {t("chat.document_menu.edit_in_office")}
        </P.Item>
      ) : null}
      {openPage ? (
        <P.Item onClick={openPage}>
          {canEdit ? <SquarePen className={icon} aria-hidden /> : <ExternalLink className={icon} aria-hidden />}
          {canEdit ? t("chat.document_menu.edit_on_web") : t("chat.document_menu.open_to_view")}
        </P.Item>
      ) : null}
      {canUpload ? (
        <P.Item onClick={() => ask("upload")}>
          <Upload className={icon} aria-hidden />
          {t("documents.actions.upload_version")}
        </P.Item>
      ) : null}
      {openHistory ? (
        <P.Item onClick={openHistory}>
          <RotateCcwClock className={icon} aria-hidden />
          {t("chat.document_menu.version_history")}
        </P.Item>
      ) : null}
      {canShare ? (
        <P.Item onClick={() => ask("share")}>
          <Share2 className={icon} aria-hidden />
          {t("chat.document_menu.share")}
        </P.Item>
      ) : null}
    </>
  );

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
    </>
  );
  return { documentItems, surfaces };
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
