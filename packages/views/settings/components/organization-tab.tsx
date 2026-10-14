"use client";

import { useId, useRef, useState } from "react";
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
import { SettingsDangerZone, SettingsRow, SettingsRowReason, SettingsRowSkeleton, SettingsTab } from "./settings-layout";
import { TransferOwnershipDialog, useTransferCandidates } from "./transfer-ownership-dialog";

/**
 * Organization membership, as opposed to workspace membership: who belongs to
 * the company, in what role, and whether they may still enter it. Handing the
 * organization over, closing it and leaving it end the tab, in the danger zone.
 *
 * The two owner dialogs live here, outside the owner-only rows: a transfer
 * flips the caller's role while its dialog is still open, and the rows that
 * the role takes away must not take the dialog (its success toast, its focus
 * return) with them.
 */
export function OrganizationTab() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const navigation = useOptionalNavigation();
  const orgSlug = workspace.organization_slug;
  const organizationName = workspace.organization_name;
  const { canLeave, canManageMembers, canTransferOwnership, decideClose, isLoading } = usePeoplePermissions(orgSlug);
  const isOwner = canTransferOwnership.allowed;
  const leave = useLeaveOrganization(orgSlug);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const dangerHeading = useRef<HTMLHeadingElement>(null);
  // Read for the owner only, so a plain member never reads the member pages
  // this needs; kept while the transfer dialog is open, which outlives the role.
  const { candidates, none, loading, isError, retry } = useTransferCandidates(
    orgSlug,
    transferOpen,
    isOwner || transferOpen,
  );
  // "Nobody else is active" is known once every page has been read; "somebody
  // is" from the first candidate, usually on page one. Until either holds, the
  // rows that depend on it hold their place instead of popping in.
  const decided = none || candidates.length > 0 || isError;
  const canClose = decideClose(!none);

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

  let rows;
  if (isLoading) {
    // The role decides which rows exist: an owner must not see a member's
    // Leave row first and then watch it change.
    rows = (
      <>
        <SettingsRowSkeleton />
        <SettingsRowSkeleton />
      </>
    );
  } else if (isOwner) {
    rows = (
      <>
        <TransferRow none={none} onOpen={() => setTransferOpen(true)} />
        {!decided ? (
          <SettingsRowSkeleton />
        ) : (
          <>
            {canClose.allowed ? <CloseRow onOpen={() => setCloseOpen(true)} /> : null}
            {leaveRow(canClose.allowed ? t("org.reasons.leave_sole_owner") : decisionReason(t, canLeave, "leave"))}
          </>
        )}
      </>
    );
  } else {
    rows = leaveRow(decisionReason(t, canLeave, "leave"));
  }

  return (
    <SettingsTab title={t("settings.page.tabs.organization")} description={t("org.members.description")}>
      <OrgMembersSection orgSlug={orgSlug} />

      {canManageMembers.allowed ? <OrgInvitationsSection orgSlug={orgSlug} orgId={workspace.organization_id} /> : null}

      {/* A plain member has only the Leave row, so the owner's sentence about
          handing the organization over would describe actions they lack. */}
      <SettingsDangerZone
        title={t("org.danger.title")}
        headingRef={dangerHeading}
        pending={isLoading}
        description={isOwner ? t("org.danger.description") : t("org.danger.description_member")}
      >
        {rows}
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
      <TransferOwnershipDialog
        orgSlug={orgSlug}
        organizationName={organizationName}
        candidates={candidates}
        loadingCandidates={loading}
        candidatesError={isError}
        onRetryCandidates={retry}
        open={transferOpen}
        onOpenChange={setTransferOpen}
        focusAfterTransfer={dangerHeading}
      />
      <CloseOrganizationDialog
        orgSlug={orgSlug}
        organizationName={organizationName}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        // Somebody joined meanwhile: re-read the members so the picker has
        // them, and go straight to the transfer.
        onTransferInstead={() => {
          retry();
          setTransferOpen(true);
        }}
      />
    </SettingsTab>
  );
}

/**
 * Danger-row actions share one width so their edges line up down the right
 * column, whatever the label length.
 */
const DANGER_ACTION = "sm:min-w-36";

function LeaveRow({ reason, allowed, onOpen }: { reason: string | null; allowed: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const descId = useId();
  return (
    <SettingsRow
      label={t("org.leave.title")}
      descriptionId={descId}
      description={
        <>
          {t("org.leave.description")}
          {reason ? <SettingsRowReason>{reason}</SettingsRowReason> : null}
        </>
      }
      size="none"
    >
      <Button
        type="button"
        variant="destructive"
        className={DANGER_ACTION}
        aria-disabled={!allowed || undefined}
        // The consequence and, when there is one, the reason it is refused.
        aria-describedby={descId}
        onClick={onOpen}
      >
        {t("org.leave.action")}
      </Button>
    </SettingsRow>
  );
}

/**
 * The row's button is outline on purpose, while the dialog's confirm is
 * destructive: opening the dialog commits to nothing (it is a form with two
 * frictions), and a red button beside Leave and Close would read as a third
 * one-click way out. The irreversible press is the one inside, and it is red.
 * "No candidate" is said only once every member page has been read.
 */
function TransferRow({ none, onOpen }: { none: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const descId = useId();
  return (
    <SettingsRow
      label={t("org.transfer.title")}
      descriptionId={descId}
      description={
        <>
          {t("org.transfer.description")}
          {none ? <SettingsRowReason>{t("org.transfer.no_candidate")}</SettingsRowReason> : null}
        </>
      }
      size="none"
    >
      <Button
        type="button"
        variant="outline"
        className={DANGER_ACTION}
        aria-disabled={none || undefined}
        aria-describedby={descId}
        onClick={() => {
          if (none) return;
          onOpen();
        }}
      >
        {t("org.transfer.action")}
      </Button>
    </SettingsRow>
  );
}

/**
 * Offered only to an owner who is the last active member: one with others
 * hands the organization over instead (ADR 0032 D5).
 */
function CloseRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const descId = useId();
  return (
    <SettingsRow label={t("org.close.title")} descriptionId={descId} description={t("org.close.description")} size="none">
      <Button type="button" variant="destructive" className={DANGER_ACTION} aria-describedby={descId} onClick={onOpen}>
        {t("org.close.action")}
      </Button>
    </SettingsRow>
  );
}
