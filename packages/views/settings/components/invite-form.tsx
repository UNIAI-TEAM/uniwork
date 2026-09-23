"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { EMAIL_RE, EmailChipsInput } from "../../workspace/email-chips-input";
import { SettingsCard, SettingsCardBody } from "./settings-layout";

export type InviteRole = "member" | "admin";

/**
 * The one invite form in settings, for the organization and the workspace
 * tier alike: emails, role and send on one row from `sm` up, stacked on a
 * phone. The role and the button hold their width so the chips field is the
 * only thing that grows. `onSend` resolves true once the invitations are out,
 * which clears the chips; a failure keeps them for another try.
 */
export function InviteForm({
  id,
  submitLabel,
  roleLabel,
  pending,
  onSend,
  children,
}: {
  id: string;
  submitLabel: string;
  roleLabel: string;
  pending: boolean;
  onSend: (emails: string[], role: InviteRole) => Promise<boolean>;
  /** Rows under the form inside the same card: what was just sent, what was skipped. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<InviteRole>("member");
  const valid = emails.filter((e) => EMAIL_RE.test(e));
  const ready = valid.length > 0 && !pending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    if (await onSend(valid, role)) setEmails([]);
  };

  return (
    <SettingsCard>
      <SettingsCardBody>
        <form onSubmit={(e) => void submit(e)} className="space-y-2">
          <FieldLabel htmlFor={`${id}-emails`}>{t("workspace.inviteEmails")}</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <EmailChipsInput
                id={`${id}-emails`}
                value={emails}
                onChange={setEmails}
                disabled={pending}
                placeholder={t("workspace.inviteHint")}
              />
            </div>
            <div className="w-full shrink-0 sm:w-40">
              <Select
                aria-label={roleLabel}
                value={role}
                disabled={pending}
                onValueChange={(v) => setRole(v === "admin" ? "admin" : "member")}
                items={[
                  { value: "member", label: t("people.role_member") },
                  { value: "admin", label: t("people.role_admin") },
                ]}
              />
            </div>
            <Button
              type="submit"
              className="shrink-0"
              aria-disabled={!ready || undefined}
              aria-busy={pending || undefined}
            >
              {pending ? t("settings.members.sending") : submitLabel}
            </Button>
          </div>
        </form>
      </SettingsCardBody>
      {children}
    </SettingsCard>
  );
}
