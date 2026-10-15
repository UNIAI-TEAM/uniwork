"use client";

import { useState, type ReactNode } from "react";
import { useDocumentAdminSummaryFake } from "@uniwork/core/documents/doc05-fake";
import { ShareDialog } from "./share-dialog";
import type { ShareDialogTarget } from "./share-dialog-target";
import { useAccessRequestsDeepLink } from "./use-access-requests-deeplink";

export interface AdminManageAccess {
  /** The admin-summary read answered 200: the caller administers the document. */
  available: boolean;
  /** Opens the share dialog on the admin-summary target. */
  open: () => void;
  /** The dialog; render it once beside the button that calls `open`. */
  dialog: ReactNode;
}

/**
 * The pure admin's way into the share dialog (access addendum §2.5, N-01):
 * a restricted document answers 403 document_restricted, so there is no
 * document to hand the dialog. The target is built from the admin-summary
 * metadata instead, with `my_level: ""` and `admin_scope: true` — the dialog
 * never loads or shows the content.
 *
 * DocumentLockedCard variant="admin" (W-DOC05) renders "Manage access"
 * (`documents.share.admin_manage_button`) after the break-glass button when
 * `available`, calls `open`, and renders `dialog`. The card is not on the
 * root yet, so this hook is the entry it will call.
 *
 * It is also the pure admin's entry for `?access=requests` (§2.5, §3.4): once
 * the summary has answered, an administrable, unarchived document opens the
 * dialog at the requests section and the parameter is dropped; a refusal or an
 * archived document drops it silently.
 */
export function useAdminManageAccess(
  wsId: string,
  documentId: string,
  opts?: { enabled?: boolean },
): AdminManageAccess {
  const summary = useDocumentAdminSummaryFake(wsId, documentId, opts);
  const [isOpen, setOpen] = useState(false);
  const [focusRequests, setFocusRequests] = useState(false);
  const data = summary.data;
  useAccessRequestsDeepLink({
    allowed: !!data && !data.archived_at && !data.owner_kind,
    ready: summary.isSuccess || summary.isError,
    onOpen: () => {
      setFocusRequests(true);
      setOpen(true);
    },
  });
  const target: ShareDialogTarget | null = data
    ? {
        id: data.id,
        title: data.title,
        // Lenient enums: an unknown visibility reads as the narrower one.
        visibility: data.visibility === "workspace" ? "workspace" : "restricted",
        organization_id: data.organization_id,
        revision: data.revision,
        // Any owner kind means a work product owns it: the dialog hides itself.
        owner_kind: data.owner_kind ? "work_product" : null,
        archived_at: data.archived_at,
        my_level: "",
        admin_scope: true,
      }
    : null;

  return {
    available: !!target,
    open: () => setOpen(true),
    dialog: target ? (
      <ShareDialog
        open={isOpen}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFocusRequests(false);
        }}
        wsId={wsId}
        doc={target}
        focusRequests={focusRequests}
      />
    ) : null,
  };
}
