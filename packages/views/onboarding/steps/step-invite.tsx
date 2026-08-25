"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { useInvite } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "@uniwork/ui/components/ui/sonner";
import { EMAIL_RE, EmailChipsInput } from "../../workspace/email-chips-input";
import { InviteRow, type SentInvite } from "../../workspace/invite-row";
import { StepFooter, StepHeading } from "../components/step-shell";

/**
 * Bước 4 — Mời đồng nghiệp. Gửi từng đợt (chip email + vai trò), hiện link mời
 * để copy. Hoàn tất chỉ mở khi đã gửi ≥1; Bỏ qua luôn có.
 */
export function StepInvite({
  workspace,
  onFinish,
  onSkip,
  onBusyChange,
}: {
  workspace: Workspace;
  onFinish: () => void;
  onSkip: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const invite = useInvite(workspace.id);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [sent, setSent] = useState<SentInvite[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const valid = emails.filter((e) => EMAIL_RE.test(e));
  const busy = invite.isPending;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const send = () => {
    if (!valid.length || busy) return;
    invite.mutate(
      { emails: valid, role },
      {
        onSuccess: (d) => {
          setSent((s) => [...s, ...d.invitations.map((i) => ({ email: i.email, token: i.token }))]);
          setSkipped(d.skipped);
          setEmails([]);
        },
        onError: () => toast.error(t("onboarding.step_invite.send_failed")),
      },
    );
  };
  const hint = sent.length
    ? t("onboarding.step_invite.hint_done")
    : valid.length
      ? t("onboarding.step_invite.hint_ready", { count: valid.length })
      : t("onboarding.step_invite.hint_empty");

  return (
    <>
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading title={t("onboarding.step_invite.headline", { workspace: workspace.name })} description={t("onboarding.step_invite.lede")} />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invite-emails">{t("onboarding.step_invite.emails_label")}</FieldLabel>
            <EmailChipsInput id="invite-emails" value={emails} onChange={setEmails} disabled={busy} placeholder={t("workspace.inviteHint")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-role">{t("onboarding.step_invite.role_label")}</FieldLabel>
            <Select
              className="h-10"
              value={role}
              onValueChange={(v) => setRole((v as "member" | "admin") ?? "member")}
              items={[
                { value: "member", label: t("onboarding.step_invite.role_member") },
                { value: "admin", label: t("onboarding.step_invite.role_admin") },
              ]}
            />
          </Field>
          <Button type="button" variant="outline" size="lg" className="w-full" disabled={!valid.length || busy} onClick={send}>
            {busy ? t("onboarding.step_invite.sending") : t("onboarding.step_invite.send")}
          </Button>
          {sent.length > 0 && (
            <Field>
              <FieldLabel htmlFor="invite-list">{t("onboarding.step_invite.sent_title", { count: sent.length })}</FieldLabel>
              <FieldDescription>{t("onboarding.step_invite.sent_hint")}</FieldDescription>
              <ul id="invite-list" className="flex flex-col gap-2">
                {sent.map((s) => (
                  <InviteRow key={s.token} sent={s} />
                ))}
              </ul>
              {skipped.length > 0 && <FieldDescription>{t("onboarding.step_invite.skipped_note", { count: skipped.length })}</FieldDescription>}
            </Field>
          )}
        </FieldGroup>
      </div>
      <StepFooter hint={hint}>
        <Button size="lg" className="w-full" disabled={!sent.length || busy} onClick={onFinish}>
          {t("onboarding.step_invite.finish")}
        </Button>
        <Button size="lg" variant="ghost" className="w-full" disabled={busy} onClick={onSkip}>
          {t("onboarding.step_invite.skip")}
        </Button>
      </StepFooter>
    </>
  );
}
