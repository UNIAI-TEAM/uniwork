"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { useInvite } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@uniwork/ui/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { EMAIL_RE, EmailChipsInput } from "../../workspace/email-chips-input";
import { InviteRow, type SentInvite } from "../../workspace/invite-row";
import { StepFooter, StepHeading, STEP_HINT_ID } from "../components/step-shell";

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
              value={role}
              onValueChange={(v) => setRole((v as "member" | "admin") ?? "member")}
              items={[
                { value: "member", label: t("onboarding.step_invite.role_member") },
                { value: "admin", label: t("onboarding.step_invite.role_admin") },
              ]}
            >
              <SelectTrigger id="invite-role" className="h-10 w-full pointer-coarse:h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t("onboarding.step_invite.role_member")}</SelectItem>
                <SelectItem value="admin">{t("onboarding.step_invite.role_admin")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            aria-disabled={!valid.length || busy || undefined}
            aria-describedby={STEP_HINT_ID}
            onClick={send}
          >
            {busy ? t("onboarding.step_invite.sending") : t("onboarding.step_invite.send")}
          </Button>
          {sent.length > 0 && (
            <Field>
              {/* `FieldTitle`, not `FieldLabel`: `<label for>` is only valid
                  against a labelable element (input/button/select/…), and the
                  target here is a <ul>. The old form rendered an inert
                  `<label for="invite-list">` — clicking it did nothing and the
                  list got no accessible name. `aria-labelledby` takes any
                  target. */}
              <FieldTitle id="invite-list-title">{t("onboarding.step_invite.sent_title", { count: sent.length })}</FieldTitle>
              <FieldDescription>{t("onboarding.step_invite.sent_hint")}</FieldDescription>
              <ul aria-labelledby="invite-list-title" className="flex flex-col gap-2">
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
        <Button size="lg" className="w-full" aria-disabled={!sent.length || busy || undefined} aria-describedby={STEP_HINT_ID} onClick={onFinish}>
          {t("onboarding.step_invite.finish")}
        </Button>
        <Button size="lg" variant="ghost" className="w-full" aria-disabled={busy || undefined} onClick={onSkip}>
          {t("onboarding.step_invite.skip")}
        </Button>
      </StepFooter>
    </>
  );
}
