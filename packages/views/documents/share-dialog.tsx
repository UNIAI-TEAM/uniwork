"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentSettings, useDocumentShares } from "@uniwork/core/documents/hooks-sharing";
import { useOrgWorkspaces } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { canAdministerDocument } from "@uniwork/core/permissions";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { AccessRequestsSection } from "./access-requests-section";
import { ShareAccessList } from "./share-access-list";
import { ShareAddSection } from "./share-add-section";
import {
  hasAdminScope,
  ShareDialogBreakGlassSection,
  useShareWorkspace,
} from "./share-dialog-break-glass";
import type { ShareDialogTarget } from "./share-dialog-target";
import { ShareLinksSection } from "./share-links-section";
import { ShareMembersErrorLine } from "./share-members-error";
import { useShareMembers } from "./use-share-members";

export type { ShareDialogTarget };

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  doc: ShareDialogTarget;
  /** Opened from the inbox link (`?access=requests`): the requests heading takes focus. */
  focusRequests?: boolean;
  /**
   * When opened from the break-glass banner's "Quyền truy cập" action, the
   * dialog opens with the break-glass section revealed so the admin can see
   * and revoke active emergency grants directly.
   */
  initialSection?: "break_glass";
}

/**
 * Document share dialog (SH-W1, UNI-1784):
 * - Header: document title + `"Lưu tại: Workspace {{workspace}}"`.
 * - Area 1 (`ShareAddSection`): unified combobox + chips + custom levels + dry_run preview.
 * - Area 2 (`ShareAccessList`): owner, home workspace ("Nơi lưu"), people, other workspaces,
 *   organization, and break-glass rows (or caller-only access summary for non-managers).
 * - Area 3 (`ShareLinksSection`): public links + organization policy line.
 */
export function ShareDialog({
  open,
  onOpenChange,
  wsId,
  doc,
  focusRequests = false,
  initialSection,
}: ShareDialogProps) {
  const { t, i18n } = useTranslation();
  const { push } = useNavigation();
  const descriptionId = useId();
  const adminNoteId = useId();
  const workspace = useShareWorkspace(doc, wsId);
  const user = useOptionalWorkspace()?.user ?? null;

  // Owned documents inherit access from their parent task or meeting; they
  // have no share dialog (C-01 §5.4).
  const owned = !!doc.owner_kind;
  const canAdminister = canAdministerDocument(doc, {
    userId: user?.id ?? null,
    orgRole: null,
    wsRole: null,
  }).allowed;
  const adminOnly = hasAdminScope(doc) && doc.my_level !== "manage";

  const access = useDocumentShares(wsId, doc.id, { enabled: open && canAdminister && !owned });
  const members = useShareMembers(workspace.organization_slug, open);
  const orgWorkspaces = useOrgWorkspaces(doc.organization_id);
  const docSettings = useDocumentSettings(doc.organization_id, {
    enabled: open && canAdminister && !owned && !!doc.organization_id,
  });

  if (owned) return null;

  // While any page of the member walk is still in flight, an unresolved user_id
  // could simply sit on a page that has not arrived yet; returning null lets
  // the row hold a skeleton instead of flashing "Thành viên không xác định".
  const memberName = (userId: string): string | null =>
    members.nameOf(userId) ??
    (members.namesPending ? null : t("documents.share.person_unknown"));

  const workspaceName = (id: string) =>
    (access.data?.home_workspace?.workspace_id === id &&
      access.data.home_workspace.workspace_name) ||
    orgWorkspaces.data?.find((w) => w.id === id)?.name ||
    (workspace.id === id && workspace.name ? workspace.name : "") ||
    t("documents.share.workspace_unknown");

  const storedWorkspace =
    access.data?.home_workspace?.workspace_name?.trim() ||
    orgWorkspaces.data?.find((w) => w.id === doc.workspace_id)?.name ||
    (workspace.id === doc.workspace_id && workspace.name ? workspace.name : "");

  const docTitle = doc.title?.trim() ?? "";
  const describedBy =
    [storedWorkspace ? descriptionId : "", adminOnly ? adminNoteId : ""]
      .filter(Boolean)
      .join(" ") || undefined;

  const organization = workspace.organization_name
    ? { id: doc.organization_id, name: workspace.organization_name }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={describedBy}
        closeLabel={t("common.close")}
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {docTitle
              ? t("documents.share.title_named", { title: docTitle })
              : t("documents.share.title")}
          </DialogTitle>
          {storedWorkspace ? (
            <DialogDescription id={descriptionId}>
              {t("documents.share.stored_in", { workspace: storedWorkspace })}
            </DialogDescription>
          ) : null}
          {adminOnly ? (
            <p
              id={adminNoteId}
              className="rounded-md bg-muted px-2.5 py-1.5 text-caption text-muted-foreground"
            >
              {t("documents.share.admin_scope_note")}
            </p>
          ) : null}
        </DialogHeader>

        {!canAdminister ? (
          <ShareAccessList
            wsId={wsId}
            docId={doc.id}
            docWorkspaceId={doc.workspace_id}
            doc={doc}
            access={access.data}
            canManage={false}
            adminScope={false}
            memberName={memberName}
            workspaceName={workspaceName}
          />
        ) : access.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-body text-muted-foreground">
            <Spinner />
            {t("documents.share.loading")}
          </div>
        ) : access.isError || !access.data ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-body text-destructive">{t("documents.share.error")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void access.refetch()}
            >
              {t("documents.share.retry")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {members.error ? (
              <ShareMembersErrorLine
                error={members.error}
                retrying={members.retrying}
                onRetry={members.retry}
              />
            ) : null}

            <ShareDialogBreakGlassSection
              wsId={wsId}
              docId={doc.id}
              grants={access.data.break_glass}
              initialOpen={initialSection === "break_glass"}
              resolveName={memberName}
            />

            <ShareAddSection
              wsId={wsId}
              doc={doc}
              open={open}
              shares={access.data.shares ?? []}
              homeWorkspace={access.data.home_workspace}
              alreadySharedUserIds={[access.data.acl_owner?.user_id, user?.id]}
              members={members}
              orgWorkspaces={orgWorkspaces.data ?? []}
              organization={organization}
            />

            <ShareAccessList
              wsId={wsId}
              docId={doc.id}
              docWorkspaceId={doc.workspace_id}
              doc={doc}
              access={access.data}
              canManage={canAdminister}
              adminScope={adminOnly}
              memberName={memberName}
              workspaceName={workspaceName}
              organization={organization}
              orgMembers={members.rows}
            />

            {!doc.archived_at ? (
              <AccessRequestsSection
                wsId={wsId}
                documentId={doc.id}
                focusOnOpen={focusRequests}
              />
            ) : null}

            <ShareLinksSection
              wsId={wsId}
              doc={doc}
              onOpenSettings={() =>
                push(
                  `${paths.workspace(workspace.organization_slug, workspace.slug).settings()}?tab=documents`,
                )
              }
              locale={i18n.language}
              publicLinksEnabled={docSettings.data?.public_links_enabled}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
