"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { EMAIL_RE, EmailChipsInput } from "../../workspace/email-chips-input";
import { SettingsCard, SettingsCardBody } from "./settings-layout";

export type InviteRole = "member" | "admin";

/**
 * What `onSend` resolves to. `false`: nothing went out, keep every chip.
 * `true`: sent, clear the valid chips. `{ skipped }`: sent, but the server
 * refused these addresses (already members, not valid) — they stay in the
 * field with a notice, so the reader fixes or removes them.
 */
export type InviteSendResult = boolean | { skipped: string[] };

/**
 * The one invite form in settings, for the organization and the workspace
 * tier alike: emails, role and send on one row from `sm` up, stacked on a
 * phone. The role and the button hold their width so the chips field is the
 * only thing that grows. After a send only the addresses that went out leave
 * the field: an invalid chip was never sent and a skipped one still needs the
 * reader, so both stay.
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
  onSend: (emails: string[], role: InviteRole) => Promise<InviteSendResult>;
  /** Rows under the form inside the same card: what was just sent, what was skipped. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<InviteRole>("member");
  const [skipped, setSkipped] = useState<string[]>([]);
  const valid = emails.filter((e) => EMAIL_RE.test(e));
  const ready = valid.length > 0 && !pending;
  // Only the skipped addresses still in the field: removing one retires it
  // from the notice, so the notice never outlives what it talks about.
  const stillSkipped = skipped.filter((e) => emails.includes(e));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const result = await onSend(valid, role);
    if (result === false) return;
    const refused = result === true ? [] : result.skipped.map((e) => e.toLowerCase());
    setSkipped(refused);
    setEmails((current) => current.filter((e) => !EMAIL_RE.test(e) || refused.includes(e)));
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
                placeholder={t("settings.members.invite_placeholder")}
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
          <FieldDescription>{t("settings.members.invite_separator_hint")}</FieldDescription>
        </form>
        {/* Mounted while empty: a live region inserted together with its
            first message is not reliably announced. */}
        <p
          role="status"
          className="text-caption text-pretty break-words text-muted-foreground [overflow-wrap:anywhere] not-empty:mt-2"
        >
          {stillSkipped.length > 0 ? t("workspace.inviteSkipped", { list: stillSkipped.join(", ") }) : null}
        </p>
      </SettingsCardBody>
      {children}
    </SettingsCard>
  );
}
