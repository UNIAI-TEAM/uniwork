"use client";

import { useState } from "react";
import {
  ArchiveRestore,
  Copy,
  RotateCcwClock,
  MessageSquare,
  Ellipsis,
  ScrollText,
  Share2,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import type { DocumentAdminScopeFake } from "@uniwork/core/documents/doc05-fake";
import { useFlag } from "@uniwork/core/feature-flags";
import { canAdministerDocument } from "@uniwork/core/permissions";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsMenuItems, useHeaderActionsSlotFilled } from "../layout/header-actions-slot";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { documentCommentsTitleKey, useDocumentCommentsChrome } from "./document-comments-context";
import { AccessLogSheet } from "./access-log-sheet";
import { DocumentArchiveDialog } from "./document-archive-dialog";
import { DocumentCopyDialog } from "./document-copy-dialog";
import { ShareDialog } from "./share-dialog";
import { useAccessRequestsDeepLink } from "./use-access-requests-deeplink";
import { VersionHistorySheet } from "./version-history-sheet";

export interface DocumentActionsMenuProps {
  wsId: string;
  doc: Document & DocumentAdminScopeFake;
  /** Route of a document id, for opening a freshly created copy. */
  documentHrefFor?: (documentId: string) => string;
  /** Called after a verified archive so the host can leave the trashed doc. */
  onArchived?: () => void;
}

type PanelId = "versions" | "share" | "logs" | "archive" | "restore" | "copy" | null;

/**
 * The document header's actions menu (G1-08, UNI-682).
 *
 * Which entries exist is a permission and ownership decision, not cosmetics:
 * a viewer sees the version history (a read), while share, links, access log,
 * archive and copy are manage/edit surfaces. An owned (work-product) document
 * has no share, link, archive or move entry at all - its access is delegated
 * through the owning screen, and the menu never offers a control the server
 * would only refuse. The panels stay mounted-while-open only, and each of
 * them re-checks the live level so a permission change mid-dialog degrades
 * inside the dialog rather than leaving a dead button.
 *
 * The copy entry is the G2-07a surface: it hides itself for the rest of the
 * session when the route answers 404/501, so a deployment without the copy
 * command shows no button that cannot work.
 */
export function DocumentActionsMenu({
  wsId,
  doc,
  documentHrefFor,
  onArchived,
}: DocumentActionsMenuProps) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const sessionUserId = useAuthStore((st) => st.user?.id ?? null);
  const userId = useOptionalWorkspace()?.user.id ?? sessionUserId;
  const canEdit = doc.my_level === "edit" || doc.my_level === "manage";
  const canManage = doc.my_level === "manage";
  // Share opens for DOC-05 admin_scope too (a break-glass admin holds view):
  // the dialog's access list and owner transfer are canAdminister() surfaces
  // (access addendum §2.5). Every other entry keeps its own gate.
  const canAdminister = canAdministerDocument(doc, { userId, orgRole: null, wsRole: null }).allowed;
  const owned = !!doc.owner_kind;
  const archived = !!doc.archived_at;
  const [panel, setPanel] = useState<PanelId>(null);
  const [copyUnavailable, setCopyUnavailable] = useState(false);
  const [focusRequests, setFocusRequests] = useState(false);
  // The inbox link for a manager (`?access=requests`, access addendum §3.4):
  // open Share at the requests section, then drop the parameter. An archived
  // or owned document, or a caller who cannot administer, loses it silently.
  useAccessRequestsDeepLink({
    allowed: canAdminister && !owned && !archived,
    onOpen: () => {
      setFocusRequests(true);
      setPanel("share");
    },
  });
  const folded = useHeaderActionsSlotFilled();
  const comments = useDocumentCommentsChrome();
  const commentsEnabled = useFlag("documents", false);

  const items: { id: Exclude<PanelId, null>; label: string; icon: typeof RotateCcwClock; destructive?: boolean }[] = [];
  items.push({ id: "versions", label: t("documents.actions.versions"), icon: RotateCcwClock });
  if (canAdminister && !owned && !archived) {
    items.push({ id: "share", label: t("documents.actions.share"), icon: Share2 });
  }
  if (canManage && !owned && !archived) {
    items.push({ id: "logs", label: t("documents.actions.access_log"), icon: ScrollText });
  }
  if (canEdit && !owned && !archived && doc.kind === "file" && !copyUnavailable) {
    items.push({ id: "copy", label: t("documents.actions.copy"), icon: Copy });
  }
  if (canManage && !owned && !archived) {
    items.push({ id: "archive", label: t("documents.actions.archive"), icon: Trash2, destructive: true });
  }
  if (canManage && !owned && archived) {
    items.push({ id: "restore", label: t("documents.actions.restore"), icon: ArchiveRestore });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("documents.actions.menu_label")}
            />
          }
        >
          <Ellipsis aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {/* An embedded Office editor's entries: phone-only desktop actions
              and the file commands its canvas replaced (download, upload). */}
          <HeaderActionsMenuItems />
          {folded && comments && commentsEnabled ? (
            <DropdownMenuItem className="gap-2 px-2 py-2 pointer-coarse:min-h-11 sm:hidden" onClick={() => comments.setOpen(!comments.open)}>
              <MessageSquare aria-hidden className="size-3.5" />
              {t(documentCommentsTitleKey(doc))}
            </DropdownMenuItem>
          ) : null}
          {items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              variant={item.destructive ? "destructive" : "default"}
              className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
              onClick={() => setPanel(item.id)}
            >
              <item.icon aria-hidden className="size-3.5" />
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <VersionHistorySheet
        open={panel === "versions"}
        onOpenChange={(next) => setPanel(next ? "versions" : null)}
        wsId={wsId}
        doc={doc}
      />
      {!owned && canAdminister ? (
        <ShareDialog
          open={panel === "share"}
          onOpenChange={(next) => {
            setPanel(next ? "share" : null);
            if (!next) setFocusRequests(false);
          }}
          wsId={wsId}
          doc={doc}
          focusRequests={focusRequests}
        />
      ) : null}
      <AccessLogSheet
        open={panel === "logs"}
        onOpenChange={(next) => setPanel(next ? "logs" : null)}
        wsId={wsId}
        doc={doc}
      />
      <DocumentCopyDialog
        open={panel === "copy"}
        onOpenChange={(next) => setPanel(next ? "copy" : null)}
        wsId={wsId}
        doc={doc}
        onUnavailable={() => setCopyUnavailable(true)}
        onCopied={(copy) => {
          const href = documentHrefFor?.(copy.id);
          if (href) push(href);
        }}
      />
      <DocumentArchiveDialog
        open={panel === "archive" || panel === "restore"}
        onOpenChange={(next) => setPanel((current) => (next ? current : null))}
        wsId={wsId}
        doc={doc}
        mode={panel === "restore" ? "restore" : "archive"}
        onArchived={onArchived}
      />
    </>
  );
}
