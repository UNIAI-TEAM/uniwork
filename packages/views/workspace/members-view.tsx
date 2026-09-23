"use client";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import type { Member } from "@uniwork/core/types/workspace";
import { useInvite, useMembers, useRemoveMember, useUpdateMemberRole } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { ConfirmDialog } from "../common/form-dialog";
import { useOptionalNavigation } from "../navigation";
import { initials } from "../people/actor-chip";
import { InviteForm, type InviteRole } from "../settings/components/invite-form";
import { MemberSearch, matchesMember } from "../settings/components/member-search";
import { decisionReason } from "../settings/components/permission-reason";
import {
  SettingsBadge,
  SettingsCardBody,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsSection,
  SettingsSkeletonRows,
} from "../settings/components/settings-layout";
import { toastApiError } from "../toast-api-error";

/**
 * Workspace membership: who is in, in what role, and the invite form. The
 * API has no list of pending workspace invitations, so "Vừa gửi" shows only
 * what this page sent, and says so.
 */
export function MembersView({ workspaceId, embedded = false }: { workspaceId: string; embedded?: boolean }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const navigation = useOptionalNavigation();
  const { data: members, isLoading } = useMembers(workspaceId);
  const invite = useInvite(workspaceId);
  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const {
    canInvite,
    decideChangeRole,
    decideRemove,
    isLoading: permissionsLoading,
  } = useWorkspacePermissions(workspaceId);
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Member | null>(null);
  const all = members ?? [];
  const shown = all.filter((m) => matchesMember(query, m));
  const removingSelf = removing !== null && removing.user_id === user?.id;
  const removingName = removing?.display_name || removing?.email || "";

  const send = async (emails: string[], role: InviteRole) => {
    try {
      const d = await invite.mutateAsync({ emails, role });
      setSent((s) => [...s, ...d.invitations.map((i) => i.email).filter((e) => !s.includes(e))]);
      setSkipped(d.skipped);
      toast.success(t("workspace.inviteSent", { count: d.invitations.length }));
      return true;
    } catch (err) {
      toastApiError(err, t("common.error"));
      return false;
    }
  };

  const onChangeRole = (m: Member, next: "admin" | "member") => {
    if (m.role === next || updateRole.isPending) return;
    updateRole.mutate(
      { userId: m.user_id, role: next },
      {
        onSuccess: () => toast.success(t("workspace.roleUpdated")),
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  const confirmRemove = () => {
    if (!removing || removeMember.isPending) return;
    const self = removingSelf;
    removeMember.mutate(removing.user_id, {
      onSuccess: () => {
        toast.success(t("workspace.memberRemoved"));
        setRemoving(null);
        if (self) navigation?.replace(paths.workspaces());
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  const inviteReason =
    canInvite.reason === "not_admin_role" ? t("workspace.inviteNotAllowed") : decisionReason(t, canInvite);

  const body = (
    <div className="space-y-8">
      <SettingsSection
        title={isLoading ? null : t("settings.members.count", { count: all.length })}
        action={isLoading || all.length === 0 ? null : <MemberSearch value={query} onChange={setQuery} />}
      >
        {isLoading ? (
          <SettingsSkeletonRows rows={3} withAvatar />
        ) : (
          <SettingsList aria-label={t("workspace.members")}>
            {shown.length === 0 ? (
              <li>
                <SettingsEmpty>
                  {all.length === 0
                    ? t("settings.members.empty")
                    : t("settings.members.no_match", { query: query.trim() })}
                </SettingsEmpty>
              </li>
            ) : null}
            {shown.map((m) => {
              const canChange = decideChangeRole(m).allowed;
              const canRemove = decideRemove(m).allowed;
              const isSelf = m.user_id === user?.id;
              const name = m.display_name || m.email;
              return (
                <SettingsListItem
                  key={m.user_id}
                  leading={
                    <ActorAvatar
                      name={name}
                      initials={initials(name)}
                      avatarUrl={typeof m.avatar_url === "string" ? m.avatar_url : null}
                      size="lg"
                    />
                  }
                  title={name}
                  badge={isSelf ? <SettingsBadge tone="brand">{t("settings.members.you")}</SettingsBadge> : null}
                  meta={m.email}
                  actions={
                    <>
                      {canChange ? (
                        <div className="w-36">
                          <Select
                            aria-label={t("workspace.changeRole")}
                            value={m.role === "admin" ? "admin" : "member"}
                            disabled={updateRole.isPending}
                            onValueChange={(v) => onChangeRole(m, v === "admin" ? "admin" : "member")}
                            items={[
                              { value: "member", label: t("people.role_member") },
                              { value: "admin", label: t("people.role_admin") },
                            ]}
                          />
                        </div>
                      ) : (
                        <span className="text-caption text-muted-foreground">
                          {t(`people.role_${m.role}`, { defaultValue: m.role })}
                        </span>
                      )}
                      {canRemove ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(m)}>
                          {isSelf ? t("settings.members.leave") : t("workspace.removeMember")}
                        </Button>
                      ) : null}
                    </>
                  }
                />
              );
            })}
          </SettingsList>
        )}
      </SettingsSection>

      {permissionsLoading ? (
        <SettingsSkeletonRows rows={1} />
      ) : canInvite.allowed ? (
        <SettingsSection title={t("settings.members.invite_title")} description={t("settings.members.invite_description")}>
          <InviteForm
            id="members-invite"
            submitLabel={t("workspace.invite")}
            roleLabel={t("settings.members.invite_role")}
            pending={invite.isPending}
            onSend={send}
          >
            {skipped.length > 0 ? (
              <SettingsCardBody className="text-caption text-muted-foreground">
                {t("workspace.inviteSkipped", { list: skipped.join(", ") })}
              </SettingsCardBody>
            ) : null}
          </InviteForm>
        </SettingsSection>
      ) : inviteReason ? (
        <p className="text-body text-muted-foreground" role="note">
          {inviteReason}
        </p>
      ) : null}

      {sent.length > 0 ? (
        <SettingsSection title={t("settings.members.sent_title")} description={t("settings.members.sent_description")}>
          <SettingsList aria-label={t("settings.members.sent_title")}>
            {sent.map((email) => (
              <SettingsListItem
                key={email}
                leading={<IconTile icon={MailCheck} size="sm" shape="circle" tone="success" />}
                title={email}
                meta={t("workspace.inviteEmailed")}
              />
            ))}
          </SettingsList>
        </SettingsSection>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !removeMember.isPending) setRemoving(null);
        }}
        title={removingSelf ? t("settings.members.leave_title") : t("settings.members.remove_title", { name: removingName })}
        description={
          removingSelf ? t("settings.members.leave_body") : t("settings.members.remove_body", { name: removingName })
        }
        confirmLabel={removingSelf ? t("settings.members.leave") : t("workspace.removeMember")}
        onConfirm={confirmRemove}
        pending={removeMember.isPending}
      />
    </div>
  );

  if (embedded) return body;
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-title font-semibold text-foreground">{t("workspace.members")}</h1>
      {body}
    </div>
  );
}
