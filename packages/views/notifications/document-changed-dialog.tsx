"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useNotificationDocuments } from "@uniwork/core/notifications";
import type { NotificationDocument, Workspace } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { FormDialogBody, FormDialogContent, FormDialogHeader } from "../common/form-dialog";
import { CollectionPageState } from "../layout/collection-page";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { AppLink } from "../navigation";

const DocumentIcon = MODULE_ICONS.documents;

/**
 * Where a listed document opens: its trash view when it was moved there (the
 * reader restores it from the trash), else the document; an archived (shelved)
 * one opens as itself. One command changes one workspace's documents, so the
 * link uses the notification row's workspace when the reader belongs to it and
 * the open one otherwise.
 */
function documentHref(doc: NotificationDocument, workspace: Workspace): string {
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return doc.trashed ? ws.documentsTrash(doc.id) : ws.document(doc.id);
}

/**
 * The documents behind a folded `document_changed` row: the ones the reader
 * can still read, a page at a time. A permanently deleted one stays in the list
 * as muted text, never a link; a title the reader may not see is never shown,
 * the server already left it out. Closed, it fetches nothing.
 */
export function DocumentChangedDialog({
  notificationId,
  open,
  workspace,
  onOpenChange,
}: {
  /** The row whose list this is; it stays set while the dialog closes, so the list does not flash empty. */
  notificationId: string;
  open: boolean;
  /** The workspace the listed documents open in. */
  workspace: Workspace;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const list = useNotificationDocuments(notificationId, { enabled: open });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.documents) ?? [], [list.data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="md">
        <FormDialogHeader title={t("notifications.documents_dialog.title")} />
        <FormDialogBody className="space-y-0 px-2 py-2">
          {list.isLoading ? (
            <div role="status" aria-busy className="flex flex-col gap-1 px-3 py-2">
              <span className="sr-only">{t("notifications.documents_dialog.loading")}</span>
              {["w-3/4", "w-1/2", "w-2/3"].map((w) => (
                <Skeleton key={w} className={cn("h-4 my-2", w)} />
              ))}
            </div>
          ) : list.isError && items.length === 0 ? (
            <CollectionPageState
              icon={DocumentIcon}
              tone="destructive"
              role="alert"
              className="py-8"
              title={t("notifications.documents_dialog.error_title")}
              description={t("notifications.documents_dialog.error")}
              actions={
                <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <CollectionPageState
              icon={DocumentIcon}
              tone={moduleTone("documents")}
              role="status"
              className="py-8"
              title={t("notifications.documents_dialog.empty_title")}
              description={t("notifications.documents_dialog.empty_description")}
            />
          ) : (
            <ul aria-label={t("notifications.documents_dialog.title")}>
              {items.map((doc) => (
                <DocumentItem
                  key={doc.id}
                  doc={doc}
                  href={documentHref(doc, workspace)}
                  onOpen={() => onOpenChange(false)}
                />
              ))}
            </ul>
          )}
          {list.hasNextPage ? (
            <div className="flex justify-center px-3 py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t("notifications.documents_dialog.loading_more") : t("notifications.documents_dialog.load_more")}
              </Button>
            </div>
          ) : null}
        </FormDialogBody>
      </FormDialogContent>
    </Dialog>
  );
}

function DocumentItem({ doc, href, onOpen }: { doc: NotificationDocument; href: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const title = doc.title.trim() || t("notifications.documents_dialog.untitled");
  const rowClass = "flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-body";
  const icon = <DocumentIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
  if (doc.deleted) {
    return (
      <li className={cn(rowClass, "text-muted-foreground")} data-document-state="deleted">
        {icon}
        <span className="min-w-0 flex-1 truncate">{doc.title.trim() ? title : null}</span>
        <span className="shrink-0 text-caption italic">{t("notifications.documents_dialog.deleted")}</span>
      </li>
    );
  }
  return (
    <li>
      <AppLink
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          onOpen();
        }}
        className={cn(
          rowClass,
          "transition-colors duration-(--duration-fast) ease-out-quart hover:bg-surface-hover motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        data-document-state={doc.trashed ? "trashed" : "open"}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{title}</span>
        {doc.trashed ? (
          <span className="shrink-0 text-caption text-muted-foreground">{t("notifications.documents_dialog.in_trash")}</span>
        ) : null}
      </AppLink>
    </li>
  );
}
