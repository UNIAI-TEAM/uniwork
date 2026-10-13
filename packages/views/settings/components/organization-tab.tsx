"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveOrganization } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { ConfirmDialog } from "../../common/form-dialog";
import { useWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import { CloseOrganizationDialog } from "./close-organization-dialog";
import { OrgInvitationsSection } from "./org-invitations-section";
import { OrgMembersSection } from "./org-members-section";
import { decisionReason } from "./permission-reason";
import { SettingsDangerZone, SettingsRow, SettingsTab } from "./settings-layout";
import { TransferOwnershipDialog, useTransferCandidates } from "./transfer-ownership-dialog";

/**
 * Organization membership, as opposed to workspace membership: who belongs to
 * the company, in what role, and whether they may still enter it. Handing the
 * organization over, closing it and leaving it end the tab, in the danger zone.
 */
export function OrganizationTab() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const navigation = useOptionalNavigation();
  const orgSlug = workspace.organization_slug;
  const organizationName = workspace.organization_name;
  const { canLeave, canManageMembers, canTransferOwnership } = usePeoplePermissions(orgSlug);
  const leave = useLeaveOrganization(orgSlug);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const confirmLeave = () => {
    if (!canLeave.allowed || leave.isPending) return;
    leave.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("org.leave.done"));
        setLeaveOpen(false);
        // One organization per account (ADR 0032): having left it, the person
        // belongs to none, so the way on is to create or join one.
        navigation?.replace(paths.getStarted());
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  const leaveRow = (reason: string | null) => (
    <LeaveRow reason={reason} allowed={canLeave.allowed} onOpen={() => setLeaveOpen(true)} />
  );

  return (
    <SettingsTab title={t("settings.page.tabs.organization")} description={t("org.members.description")}>
      <OrgMembersSection orgSlug={orgSlug} />

      {canManageMembers.allowed ? <OrgInvitationsSection orgSlug={orgSlug} /> : null}

      <SettingsDangerZone title={t("org.danger.title")} description={t("org.danger.description")}>
        {canTransferOwnership.allowed ? (
          <OwnerRows orgSlug={orgSlug} organizationName={organizationName} leaveRow={leaveRow} />
        ) : (
          leaveRow(decisionReason(t, canLeave, "leave"))
        )}
      </SettingsDangerZone>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={(open) => {
          if (!leave.isPending) setLeaveOpen(open);
        }}
        title={t("org.leave.confirm_title", { name: organizationName })}
        description={t("org.leave.confirm_body", { name: organizationName })}
        confirmLabel={t("org.leave.action")}
        onConfirm={confirmLeave}
        pending={leave.isPending}
      />
    </SettingsTab>
  );
}

function LeaveRow({ reason, allowed, onOpen }: { reason: string | null; allowed: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <SettingsRow
      label={t("org.leave.title")}
      description={
        <>
          {t("org.leave.description")}
          {reason ? (
            <span id="org-leave-reason" className="mt-1 block text-foreground">
              {reason}
            </span>
          ) : null}
        </>
      }
      size="none"
    >
      <Button
        type="button"
        variant="destructive"
        aria-disabled={!allowed || undefined}
        aria-describedby={reason ? "org-leave-reason" : undefined}
        onClick={onOpen}
      >
        {t("org.leave.action")}
      </Button>
    </SettingsRow>
  );
}

/**
 * Mounted only for the owner, so a plain member never reads the member pages
 * this needs. "No candidate" is said only once every page has been read, and
 * only then is closing offered: an owner with other active members hands the
 * organization over instead (ADR 0032 D5). Leave stays refused either way; the
 * sentence beside it points at whichever way out applies.
 */
function OwnerRows({
  orgSlug,
  organizationName,
  leaveRow,
}: {
  orgSlug: string;
  organizationName: string;
  leaveRow: (reason: string | null) => ReactNode;
}) {
  const { t } = useTranslation();
  const [transferOpen, setTransferOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const { canLeave, decideClose } = usePeoplePermissions(orgSlug);
  const { candidates, none, loading, isError, retry } = useTransferCandidates(orgSlug, transferOpen);
  const canClose = decideClose(!none);
  return (
    <>
      <SettingsRow
        label={t("org.transfer.title")}
        description={
          <>
            {t("org.transfer.description")}
            {none ? (
              <span id="org-transfer-reason" className="mt-1 block text-foreground">
                {t("org.transfer.no_candidate")}
              </span>
            ) : null}
          </>
        }
        size="none"
      >
        <Button
          type="button"
          variant="outline"
          aria-disabled={none || undefined}
          aria-describedby={none ? "org-transfer-reason" : undefined}
          onClick={() => setTransferOpen(true)}
        >
          {t("org.transfer.action")}
        </Button>
      </SettingsRow>
      {canClose.allowed ? (
        <SettingsRow label={t("org.close.title")} description={t("org.close.description")} size="none">
          <Button type="button" variant="destructive" onClick={() => setCloseOpen(true)}>
            {t("org.close.action")}
          </Button>
        </SettingsRow>
      ) : null}
      {leaveRow(canClose.allowed ? t("org.reasons.leave_sole_owner") : decisionReason(t, canLeave, "leave"))}
      <TransferOwnershipDialog
        orgSlug={orgSlug}
        organizationName={organizationName}
        candidates={candidates}
        loadingCandidates={loading}
        candidatesError={isError}
        onRetryCandidates={retry}
        open={transferOpen}
        onOpenChange={setTransferOpen}
      />
      <CloseOrganizationDialog
        orgSlug={orgSlug}
        organizationName={organizationName}
        open={closeOpen}
        onOpenChange={setCloseOpen}
      />
    </>
  );
}
