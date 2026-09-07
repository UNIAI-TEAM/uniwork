"use client";

import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  useDeactivateOrgMember,
  useInviteToOrganization,
  useLeaveOrganization,
  useOrgInvitations,
  useOrgMembers,
  useReactivateOrgMember,
  useRevokeOrgInvitation,
  useUpdateOrgMemberRole,
} from "@uniwork/core/organizations";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import type { OrgMember } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toast } from "sonner";
import { useWorkspace } from "../../layout/workspace-context";
import { toastApiError } from "../../toast-api-error";
import { EMAIL_RE, EmailChipsInput } from "../../workspace/email-chips-input";
import { SettingsSection, SettingsTab } from "./settings-layout";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";

/**
 * Organization membership, as opposed to workspace membership: who belongs to
 * the company, in what role, and whether they may still enter it.
 */
export function OrganizationTab() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useOrgMembers(orgSlug, "all");
  const { decideChangeRole, decideDeactivate, canLeave, canManageMembers, canTransferOwnership } =
    usePeoplePermissions(orgSlug);
  const updateRole = useUpdateOrgMemberRole(orgSlug);
  const deactivate = useDeactivateOrgMember(orgSlug);
  const reactivate = useReactivateOrgMember(orgSlug);
  const leave = useLeaveOrganization(orgSlug);
  const invite = useInviteToOrganization(orgSlug);
  const revoke = useRevokeOrgInvitation(orgSlug);
  const { data: invitations } = useOrgInvitations(orgSlug, canManageMembers.allowed);
  const [emails, setEmails] = useState<string[]>([]);
  const [inviteRole, setInviteRole] = useState("member");
  const [transferOpen, setTransferOpen] = useState(false);
  const members = (data?.pages ?? []).flatMap((p) => p.members);
  const validEmails = emails.filter((e) => EMAIL_RE.test(e));
  // The owner cannot hand the organization to themselves or to somebody who
  // has been switched off.
  const transferCandidates = members.filter((m) => !m.deactivated_at && m.role !== "owner");

  const sendInvites = () => {
    if (validEmails.length === 0 || invite.isPending) return;
    invite.mutate(
      { emails: validEmails, orgRole: inviteRole },
      {
        onSuccess: (result) => {
          setEmails([]);
          toast.success(t("org.invitations.sent", { count: result?.invitations.length ?? 0 }));
        },
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  const onChangeRole = (member: OrgMember, role: string) => {
    if (member.role === role || updateRole.isPending) return;
    updateRole.mutate(
      { userId: member.user_id, role },
      {
        onSuccess: () => toast.success(t("org.members.role_updated")),
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  const onToggleActive = (member: OrgMember) => {
    const mutation = member.deactivated_at ? reactivate : deactivate;
    if (mutation.isPending) return;
    mutation.mutate(member.user_id, {
      onSuccess: () =>
        toast.success(
          member.deactivated_at ? t("org.members.reactivated") : t("org.members.deactivated"),
        ),
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <SettingsTab title={t("settings.page.tabs.organization")}>
      <SettingsSection
        title={t("org.members.title")}
        description={t("org.members.description")}
      >
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {members.map((member) => {
              const target = { user_id: member.user_id, role: member.role };
              const changeRole = decideChangeRole(target);
              const toggle = decideDeactivate(target);
              return (
                <li
                  key={member.user_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-body text-foreground">
                      {member.display_name}
                      {member.deactivated_at ? (
                        <span className="ml-2 text-caption text-muted-foreground">
                          {t("org.members.status_deactivated")}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-caption text-muted-foreground">{member.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {changeRole.allowed ? (
                      <Select
                        aria-label={t("org.members.change_role")}
                        value={member.role === "admin" ? "admin" : "member"}
                        onValueChange={(v) => onChangeRole(member, (v as string) ?? "member")}
                        items={[
                          { value: "member", label: t("people.role_member") },
                          { value: "admin", label: t("people.role_admin") },
                        ]}
                      />
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        {t(`people.role_${member.role}`, { defaultValue: member.role })}
                      </span>
                    )}
                    {toggle.allowed || member.deactivated_at ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={deactivate.isPending || reactivate.isPending || !toggle.allowed}
                        onClick={() => onToggleActive(member)}
                      >
                        {member.deactivated_at
                          ? t("org.members.reactivate")
                          : t("org.members.deactivate")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {t("people.load_more")}
          </Button>
        ) : null}
      </SettingsSection>

      {canManageMembers.allowed ? (
        <SettingsSection
          title={t("org.invitations.title")}
          description={t("org.invitations.description")}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <EmailChipsInput
                id="org-invite-emails"
                value={emails}
                onChange={setEmails}
                disabled={invite.isPending}
                placeholder={t("workspace.inviteHint")}
              />
            </div>
            <Select
              aria-label={t("org.members.change_role")}
              value={inviteRole}
              onValueChange={(v) => setInviteRole((v as string) ?? "member")}
              items={[
                { value: "member", label: t("people.role_member") },
                { value: "admin", label: t("people.role_admin") },
              ]}
            />
            <Button type="button" disabled={invite.isPending || validEmails.length === 0} onClick={sendInvites}>
              {t("org.invitations.send")}
            </Button>
          </div>
          {invitations && invitations.invitations.length > 0 ? (
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
              {invitations.invitations.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-body text-foreground">{inv.email}</div>
                    <div className="truncate text-caption text-muted-foreground">
                      {t(`people.role_${inv.org_role}`, { defaultValue: inv.org_role })}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate(inv.id, {
                        onSuccess: () => toast.success(t("org.invitations.revoked")),
                        onError: (err) => toastApiError(err, t("common.error")),
                      })
                    }
                  >
                    {t("org.invitations.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </SettingsSection>
      ) : null}

      {canTransferOwnership.allowed ? (
        <SettingsSection title={t("org.transfer.title")} description={t("org.transfer.description")}>
          <Button
            type="button"
            variant="outline"
            disabled={transferCandidates.length === 0}
            onClick={() => setTransferOpen(true)}
          >
            {t("org.transfer.action")}
          </Button>
          {transferCandidates.length === 0 ? (
            <p className="mt-2 text-caption text-muted-foreground">{t("org.transfer.no_candidate")}</p>
          ) : null}
          <TransferOwnershipDialog
            orgSlug={orgSlug}
            organizationName={workspace.organization_name}
            candidates={transferCandidates}
            open={transferOpen}
            onOpenChange={setTransferOpen}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("org.leave.title")} description={t("org.leave.description")}>
        <Button
          type="button"
          variant="outline"
          disabled={!canLeave.allowed || leave.isPending}
          onClick={() =>
            leave.mutate(undefined, {
              onSuccess: () => toast.success(t("org.leave.done")),
              onError: (err) => toastApiError(err, t("common.error")),
            })
          }
        >
          {t("org.leave.action")}
        </Button>
        {!canLeave.allowed && canLeave.message ? (
          <p className="mt-2 text-caption text-muted-foreground">{canLeave.message}</p>
        ) : null}
      </SettingsSection>
    </SettingsTab>
  );
}
