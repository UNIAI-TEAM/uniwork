"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import type { Member } from "@uniwork/core/types/workspace";
import { useInvite, useMembers, useRemoveMember, useUpdateMemberRole } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { EMAIL_RE, EmailChipsInput } from "./email-chips-input";
import { InviteRow, type SentInvite } from "./invite-row";

export function MembersView({ workspaceId, embedded = false }: { workspaceId: string; embedded?: boolean }) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const invite = useInvite(workspaceId);
  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const {
    canInvite,
    decideChangeRole,
    decideRemove,
    isLoading: permissionsLoading,
  } = useWorkspacePermissions(workspaceId);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [sent, setSent] = useState<SentInvite[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const valid = emails.filter((e) => EMAIL_RE.test(e));

  const send = () => {
    if (!valid.length || invite.isPending) return;
    invite.mutate(
      { emails: valid, role },
      {
        onSuccess: (d) => {
          setSent((s) => [...s, ...d.invitations.map((i) => ({ email: i.email }))]);
          setSkipped(d.skipped);
          setEmails([]);
          toast.success(t("workspace.inviteSent", { count: d.invitations.length }));
        },
        onError: () => toast.error(t("common.error")),
      },
    );
  };

  const onChangeRole = (m: Member, next: "admin" | "member") => {
    if (m.role === next || updateRole.isPending) return;
    updateRole.mutate(
      { userId: m.user_id, role: next },
      {
        onSuccess: () => toast.success(t("workspace.roleUpdated")),
        onError: () => toast.error(t("common.error")),
      },
    );
  };

  const onRemove = (m: Member) => {
    if (removeMember.isPending) return;
    if (!window.confirm(t("workspace.removeConfirm", { name: m.display_name }))) return;
    removeMember.mutate(m.user_id, {
      onSuccess: () => toast.success(t("workspace.memberRemoved")),
      onError: () => toast.error(t("common.error")),
    });
  };

  return (
    <div className={embedded ? undefined : "mx-auto max-w-2xl p-6"}>
      {!embedded ? (
        <h1 className="mb-4 text-title font-semibold text-foreground">{t("workspace.members")}</h1>
      ) : null}
      <ul className="mb-6 divide-y divide-border rounded-lg border border-border bg-surface">
        {(members ?? []).map((m) => {
          const canChange = decideChangeRole(m).allowed;
          const canRemove = decideRemove(m).allowed;
          return (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div>
                <div className="text-body text-foreground">{m.display_name}</div>
                <div className="text-caption text-muted-foreground">{m.email}</div>
              </div>
              <div className="flex items-center gap-2">
                {canChange ? (
                  <Select
                    aria-label={t("workspace.changeRole")}
                    value={m.role === "admin" ? "admin" : "member"}
                    onValueChange={(v) => onChangeRole(m, (v as "member" | "admin") ?? "member")}
                    items={[
                      { value: "member", label: t("onboarding.step_invite.role_member") },
                      { value: "admin", label: t("onboarding.step_invite.role_admin") },
                    ]}
                  />
                ) : (
                  <span className="text-caption text-muted-foreground">{m.role}</span>
                )}
                {canRemove ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={removeMember.isPending}
                    onClick={() => onRemove(m)}
                  >
                    {t("workspace.removeMember")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {canInvite.allowed ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="members-invite-emails">{t("workspace.inviteEmails")}</FieldLabel>
            <EmailChipsInput id="members-invite-emails" value={emails} onChange={setEmails} disabled={invite.isPending} placeholder={t("workspace.inviteHint")} />
          </Field>
          <div className="flex items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor="members-invite-role">{t("workspace.role")}</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => setRole((v as "member" | "admin") ?? "member")}
                items={[
                  { value: "member", label: t("onboarding.step_invite.role_member") },
                  { value: "admin", label: t("onboarding.step_invite.role_admin") },
                ]}
              />
            </Field>
            <Button type="button" disabled={!valid.length || invite.isPending} onClick={send}>
              {t("workspace.invite")}
            </Button>
          </div>
          {sent.length > 0 && (
            <Field>
              {/* `FieldTitle`, not `FieldLabel`: `<label for>` is only valid
                  against a labelable element (input/button/select/…), and the
                  target here is a <ul>. `aria-labelledby` takes any target. */}
              <FieldTitle id="members-invite-list-title">{t("workspace.inviteSent", { count: sent.length })}</FieldTitle>
              <ul aria-labelledby="members-invite-list-title" className="flex flex-col gap-2">
                {sent.map((s) => (
                  <InviteRow key={s.email} sent={s} />
                ))}
              </ul>
              {skipped.length > 0 && <FieldDescription>{t("workspace.inviteSkipped", { list: skipped.join(", ") })}</FieldDescription>}
            </Field>
          )}
        </FieldGroup>
      ) : permissionsLoading ? null : (
        // Rendered from the Decision so the reason a member cannot invite is
        // the same sentence everywhere, not view-local copy.
        <p className="text-body text-muted-foreground" role="note">
          {t("workspace.inviteNotAllowed")}
        </p>
      )}
    </div>
  );
}
