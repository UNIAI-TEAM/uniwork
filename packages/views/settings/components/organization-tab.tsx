"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveOrganization, useOrgMembers } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { ConfirmDialog } from "../../common/form-dialog";
import { useWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import { OrgInvitationsSection } from "./org-invitations-section";
import { OrgMembersSection } from "./org-members-section";
import { decisionReason } from "./permission-reason";
import { SettingsDangerZone, SettingsRow, SettingsTab } from "./settings-layout";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";

/**
 * Organization membership, as opposed to workspace membership: who belongs to
 * the company, in what role, and whether they may still enter it. Handing the
 * organization over and leaving it close the tab, in the danger zone.
 */
export function OrganizationTab() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const navigation = useOptionalNavigation();
  const orgSlug = workspace.organization_slug;
  const organizationName = workspace.organization_name;
  // Same query key as the member list, so this reads the cache it fills.
  const { data } = useOrgMembers(orgSlug, "all");
  const { canLeave, canManageMembers, canTransferOwnership } = usePeoplePermissions(orgSlug);
  const leave = useLeaveOrganization(orgSlug);
  const [transferOpen, setTransferOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // The owner cannot hand the organization to themselves or to somebody who
  // has been switched off.
  const transferCandidates = (data?.pages ?? [])
    .flatMap((p) => p.members)
    .filter((m) => !m.deactivated_at && m.role !== "owner");
  const leaveReason = decisionReason(t, canLeave, "leave");
  const canTransferNow = transferCandidates.length > 0;

  const confirmLeave = () => {
    if (!canLeave.allowed || leave.isPending) return;
    leave.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("org.leave.done"));
        setLeaveOpen(false);
        navigation?.replace(paths.workspaces());
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <SettingsTab title={t("settings.page.tabs.organization")} description={t("org.members.description")}>
      <OrgMembersSection orgSlug={orgSlug} />

      {canManageMembers.allowed ? <OrgInvitationsSection orgSlug={orgSlug} /> : null}

      <SettingsDangerZone title={t("org.danger.title")} description={t("org.danger.description")}>
        {canTransferOwnership.allowed ? (
          <SettingsRow
            label={t("org.transfer.title")}
            description={
              <>
                {t("org.transfer.description")}
                {canTransferNow ? null : (
                  <span id="org-transfer-reason" className="mt-1 block text-foreground">
                    {t("org.transfer.no_candidate")}
                  </span>
                )}
              </>
            }
            size="none"
          >
            <Button
              type="button"
              variant="outline"
              aria-disabled={!canTransferNow || undefined}
              aria-describedby={canTransferNow ? undefined : "org-transfer-reason"}
              onClick={() => setTransferOpen(true)}
            >
              {t("org.transfer.action")}
            </Button>
          </SettingsRow>
        ) : null}
        <SettingsRow
          label={t("org.leave.title")}
          description={
            <>
              {t("org.leave.description")}
              {leaveReason ? (
                <span id="org-leave-reason" className="mt-1 block text-foreground">
                  {leaveReason}
                </span>
              ) : null}
            </>
          }
          size="none"
        >
          <Button
            type="button"
            variant="destructive"
            aria-disabled={!canLeave.allowed || undefined}
            aria-describedby={leaveReason ? "org-leave-reason" : undefined}
            onClick={() => setLeaveOpen(true)}
          >
            {t("org.leave.action")}
          </Button>
        </SettingsRow>
      </SettingsDangerZone>

      {canTransferOwnership.allowed ? (
        <TransferOwnershipDialog
          orgSlug={orgSlug}
          organizationName={organizationName}
          candidates={transferCandidates}
          open={transferOpen}
          onOpenChange={setTransferOpen}
        />
      ) : null}
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
