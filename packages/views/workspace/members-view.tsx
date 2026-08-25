"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useInvite, useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "@uniwork/ui/components/ui/sonner";
import { EMAIL_RE, EmailChipsInput } from "./email-chips-input";
import { InviteRow, type SentInvite } from "./invite-row";

export function MembersView({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const invite = useInvite(workspaceId);
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
          setSent((s) => [...s, ...d.invitations.map((i) => ({ email: i.email, token: i.token }))]);
          setSkipped(d.skipped);
          setEmails([]);
          toast.success(t("workspace.inviteSent", { count: d.invitations.length }));
        },
        onError: () => toast.error(t("common.error")),
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-semibold text-primary">{t("workspace.members")}</h1>
      <ul className="mb-6 divide-y divide-line rounded-lg border border-line bg-surface">
        {(members ?? []).map((m) => (
          <li key={m.user_id} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <div className="text-sm text-primary">{m.display_name}</div>
              <div className="text-[12px] text-tertiary">{m.email}</div>
            </div>
            <span className="text-[12px] text-text-secondary">{m.role}</span>
          </li>
        ))}
      </ul>
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
            <FieldLabel htmlFor="members-invite-list">{t("workspace.inviteLink")}</FieldLabel>
            <ul id="members-invite-list" className="flex flex-col gap-2">
              {sent.map((s) => (
                <InviteRow key={s.token} sent={s} />
              ))}
            </ul>
            {skipped.length > 0 && <FieldDescription>{t("workspace.inviteSkipped", { list: skipped.join(", ") })}</FieldDescription>}
          </Field>
        )}
      </FieldGroup>
    </div>
  );
}
