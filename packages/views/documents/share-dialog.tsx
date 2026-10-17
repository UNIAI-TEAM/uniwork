"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import {
  useDocumentSettings,
  useDocumentShares,
} from "@uniwork/core/documents/hooks-sharing";
import {
  useOrgMembership,
  useOrgWorkspaces,
  useOrganizations,
} from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useNavigation } from "../navigation";
import { AccessRequestsSection } from "./access-requests-section";
import { ShareAccessList } from "./share-access-list";
import { ShareAddSection } from "./share-add-section";
import {
  resolveDocumentWorkspaceName,
  type ShareDialogDocument,
} from "./share-dialog-target";
import { ShareLinksSection } from "./share-links-section";
import { TransferOwnerDialog } from "./transfer-owner-dialog";
import { useShareMembers } from "./use-share-members";

export type { ShareDialogDocument };

export interface ShareDialogProps {
  wsId: string;
  doc: ShareDialogDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Document share dialog (SH-W1, UNI-1784):
 * - Header: document title + `"Lưu tại: Workspace {{workspace}}"`.
 * - Area 1 (`ShareAddSection`): unified combobox + chips + custom levels + dry_run preview.
 * - Area 2 (`ShareAccessList`): owner, home workspace ("Nơi lưu"), people, other workspaces,
 *   organization, and break-glass rows (or caller-only access summary for non-managers).
 * - Area 3 (`ShareLinksSection`): public links + organization policy line.
 */
export function ShareDialog({ wsId, doc, open, onOpenChange }: ShareDialogProps) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const currentUserId = useAuthStore((s) => s.user?.id ?? "");
  const [transferOpen, setTransferOpen] = useState(false);

  const docId = doc?.id ?? "";
  const sharesQuery = useDocumentShares(wsId, docId, { enabled: open && !!doc });
  const workspaceQuery = useWorkspace(wsId);
  const workspace = workspaceQuery.data;
  const orgWorkspacesQuery = useOrgWorkspaces(doc?.organization_id ?? "");
  const orgWorkspaces = useMemo(
    () => orgWorkspacesQuery.data ?? [],
    [orgWorkspacesQuery.data],
  );
  const orgsQuery = useOrganizations();
  const organization = useMemo(
    () => (orgsQuery.data ?? []).find((o) => o.id === doc?.organization_id) ?? null,
    [orgsQuery.data, doc?.organization_id],
  );
  const orgSlug = workspace?.organization_slug || organization?.slug || "";
  const orgMemberQuery = useOrgMembership(orgSlug);
  const docSettingsQuery = useDocumentSettings(doc?.organization_id ?? "", {
    enabled: open && !!doc?.organization_id,
  });

  useEffect(() => {
    setTransferOpen(false);
  }, [doc?.id, open]);

  const myLevel = sharesQuery.data?.my_level ?? "";
  const canManage = myLevel === "manage";
  const adminScope = sharesQuery.data?.admin_scope === true && !canManage;

  const members = useShareMembers(wsId, open && !!doc && (canManage || adminScope));
  const memberLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.rows) {
      const name = m.display_name?.trim() ?? "";
      const email = m.email?.trim() ?? "";
      const label = name && email ? `${name} (${email})` : name || email || m.user_id;
      if (m.user_id) map.set(m.user_id, label);
    }
    return map;
  }, [members.rows]);

  const workspaceNames = useMemo(() => {
    const map = new Map<string, string>();
    if (workspace?.id && workspace.name) map.set(workspace.id, workspace.name);
    for (const w of orgWorkspaces) {
      if (w.id && w.name) map.set(w.id, w.name);
    }
    const hw = sharesQuery.data?.home_workspace;
    if (hw?.workspace_id && hw.workspace_name) {
      map.set(hw.workspace_id, hw.workspace_name);
    }
    return map;
  }, [workspace?.id, workspace?.name, orgWorkspaces, sharesQuery.data?.home_workspace]);

  if (!doc) return null;

  const aclOwner = sharesQuery.data?.acl_owner ?? null;
  const isOwner = Boolean(currentUserId && aclOwner?.user_id === currentUserId);
  const isAdmin = workspace?.role === "owner" || workspace?.role === "admin";
  const canTransfer = Boolean(aclOwner && (isOwner || isAdmin || adminScope));
  const ownedByWorkProduct = doc.owner_kind === "work_product";

  const canManageOrgSettings = orgMemberQuery.data?.role
    ? orgMemberQuery.data.role === "owner" || orgMemberQuery.data.role === "admin"
    : isAdmin;

  const homeWorkspaceName =
    sharesQuery.data?.home_workspace?.workspace_name?.trim() ||
    resolveDocumentWorkspaceName(doc.workspace_id, workspace?.id, workspace?.name, orgWorkspaces);

  const openOrgDocumentSettings = () => {
    onOpenChange(false);
    if (orgSlug) {
      navigation.push(paths.orgSettings(orgSlug));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {doc.title
                ? t("documents.share.title_named", { title: doc.title })
                : t("documents.share.title")}
            </DialogTitle>
            {homeWorkspaceName ? (
              <p className="text-caption text-muted-foreground">
                {t("documents.share.stored_in", { workspace: homeWorkspaceName })}
              </p>
            ) : null}
            <DialogDescription>{t("documents.share.description")}</DialogDescription>
          </DialogHeader>

          {sharesQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-body text-muted-foreground">
              <Spinner aria-hidden role="presentation" />
              {t("documents.share.loading")}
            </div>
          ) : sharesQuery.isError ? (
            <div className="flex items-center justify-between gap-2 py-2">
              <p role="alert" className="text-body text-destructive">
                {t("documents.share.error")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void sharesQuery.refetch()}
              >
                {t("documents.share.retry")}
              </Button>
            </div>
          ) : (
            <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
              {adminScope ? (
                <p
                  role="note"
                  className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground"
                >
                  {t("documents.share.admin_scope_note")}
                </p>
              ) : null}

              {canManage ? <AccessRequestsSection wsId={wsId} docId={doc.id} /> : null}

              {canManage ? (
                <ShareAddSection
                  wsId={wsId}
                  doc={doc}
                  open={open}
                  shares={sharesQuery.data?.shares ?? []}
                  homeWorkspace={sharesQuery.data?.home_workspace}
                  members={members}
                  orgWorkspaces={orgWorkspaces}
                  organization={organization}
                />
              ) : null}

              <ShareAccessList
                wsId={wsId}
                docId={doc.id}
                docWorkspaceId={doc.workspace_id}
                access={sharesQuery.data}
                canManage={canManage}
                adminScope={adminScope}
                canTransfer={canTransfer}
                ownedByWorkProduct={ownedByWorkProduct}
                onOpenTransfer={() => setTransferOpen(true)}
                memberLabels={memberLabels}
                workspaceNames={workspaceNames}
                organization={organization}
                locale={i18n.language}
              />

              {canManage ? (
                <ShareLinksSection
                  wsId={wsId}
                  doc={doc}
                  onOpenSettings={openOrgDocumentSettings}
                  locale={i18n.language}
                  publicLinksEnabled={docSettingsQuery.data?.public_links_enabled}
                  canManageOrgSettings={canManageOrgSettings}
                />
              ) : null}
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {canTransfer ? (
        <TransferOwnerDialog
          wsId={wsId}
          doc={{
            id: doc.id,
            title: doc.title,
            revision: doc.revision,
            owner_kind: doc.owner_kind,
          }}
          currentOwnerUserId={aclOwner?.user_id ?? null}
          open={transferOpen}
          onOpenChange={setTransferOpen}
        />
      ) : null}
    </>
  );
}
