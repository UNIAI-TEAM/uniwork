"use client";

import { useState } from "react";
import {
  ArchiveRestore,
  Copy,
  History,
  MoreHorizontal,
  ScrollText,
  Share2,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { useNavigation } from "../navigation";
import { AccessLogSheet } from "./access-log-sheet";
import { DocumentArchiveDialog } from "./document-archive-dialog";
import { DocumentCopyDialog } from "./document-copy-dialog";
import { ShareDialog } from "./share-dialog";
import { VersionHistorySheet } from "./version-history-sheet";

export interface DocumentActionsMenuProps {
  wsId: string;
  doc: Document;
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
  const canEdit = doc.my_level === "edit" || doc.my_level === "manage";
  const canManage = doc.my_level === "manage";
  const owned = !!doc.owner_kind;
  const archived = !!doc.archived_at;
  const [panel, setPanel] = useState<PanelId>(null);
  const [copyUnavailable, setCopyUnavailable] = useState(false);

  const items: { id: Exclude<PanelId, null>; label: string; icon: typeof History; destructive?: boolean }[] = [];
  items.push({ id: "versions", label: t("documents.actions.versions"), icon: History });
  if (canManage && !owned && !archived) {
    items.push({ id: "share", label: t("documents.actions.share"), icon: Share2 });
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
          <MoreHorizontal aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              variant={item.destructive ? "destructive" : "default"}
              className="gap-2 px-2 py-2"
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
      {!owned && canManage ? (
        <ShareDialog
          open={panel === "share"}
          onOpenChange={(next) => setPanel(next ? "share" : null)}
          wsId={wsId}
          doc={doc}
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
