"use client";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MembershipConflict } from "@uniwork/core/types";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { useTransferCandidates } from "../../settings/components/transfer-ownership-dialog";
import { TransferCandidateField, TransferPasswordField } from "../../settings/components/transfer-owner-fields";
import { SettingsFieldError } from "../../settings/components/settings-layout";
import { roleLabel, type SwitchDraft } from "./switch-draft";

type BlockProps = {
  conflict: MembershipConflict;
  draft: SwitchDraft;
  onChange: (patch: Partial<SwitchDraft>) => void;
  /** The server refused the owner's password on the last attempt. */
  passwordError?: string;
};

/**
 * How one organization the person belongs to is given up, by what the server
 * says it needs (spec 2026-10-13 §4.3): a member leaves, an owner with other
 * members hands it over, a sole owner closes it, and the owner of a suspended
 * organization cannot do either here.
 */
export function ResolveBlock(props: BlockProps) {
  const { t } = useTranslation();
  const { conflict } = props;
  const name = conflict.organization.name;
  const headingId = `switch-${conflict.organization.id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-col gap-0.5">
        <h3 id={headingId} className="text-title-sm font-semibold text-foreground">
          {name}
        </h3>
        <p className="text-caption text-muted-foreground">{t("invitations.switch.role_as", { role: roleLabel(t, conflict.role) })}</p>
      </div>
      <BlockBody {...props} />
    </section>
  );
}

function BlockBody(props: BlockProps) {
  const { t } = useTranslation();
  const name = props.conflict.organization.name;
  switch (props.conflict.required_action) {
    case "leave":
      return <LeaveBlock {...props} />;
    case "transfer":
      return <TransferBlock {...props} />;
    case "close":
      return <CloseBlock {...props} />;
    case "blocked":
      return (
        <p className="flex items-start gap-2 text-body text-foreground">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          {t("invitations.switch.blocked", { name })}
        </p>
      );
    default:
      return <p className="text-body text-foreground">{t("invitations.switch.unknown", { name })}</p>;
  }
}

function LeaveBlock({ conflict, draft, onChange }: BlockProps) {
  const { t } = useTranslation();
  const name = conflict.organization.name;
  const id = `switch-${conflict.organization.id}-leave`;
  return (
    <>
      <p className="text-body text-muted-foreground">{t("invitations.switch.leave_body", { name })}</p>
      {/* The whole row is the label, so the target is the row on a touch screen, not the 16px box. */}
      <Field orientation="horizontal" className="min-h-11">
        <Checkbox
          id={id}
          checked={draft.leaveConfirmed}
          onCheckedChange={(checked) => onChange({ leaveConfirmed: checked === true })}
        />
        <FieldLabel htmlFor={id} className="min-h-11 items-center text-body">
          {t("invitations.switch.leave_confirm", { name })}
        </FieldLabel>
      </Field>
    </>
  );
}

function TransferBlock({ conflict, draft, onChange, passwordError }: BlockProps) {
  const { t } = useTranslation();
  const name = conflict.organization.name;
  const prefix = `switch-${conflict.organization.id}`;
  const { candidates, none, loading, isError, retry } = useTransferCandidates(conflict.organization.slug, true);
  // The name rides along so the confirmation can say who receives the organization.
  const pick = (userId: string) => {
    const member = candidates.find((m) => m.user_id === userId);
    onChange({ toUserId: userId, toUserName: member?.display_name || member?.email || "" });
  };
  return (
    <>
      <p className="text-body text-muted-foreground">{t("invitations.switch.transfer_body", { name })}</p>
      <TransferCandidateField
        id={`${prefix}-target`}
        candidates={candidates}
        value={draft.toUserId}
        onValueChange={pick}
        loading={loading}
        isError={isError}
        onRetry={retry}
      />
      {none ? <p className="text-caption text-muted-foreground">{t("org.transfer.no_candidate")}</p> : null}
      <TransferPasswordField
        id={`${prefix}-password`}
        value={draft.password}
        onValueChange={(password) => onChange({ password })}
        error={passwordError}
      />
    </>
  );
}

function CloseBlock({ conflict, draft, onChange }: BlockProps) {
  const { t } = useTranslation();
  const { name, slug } = conflict.organization;
  const id = `switch-${conflict.organization.id}-slug`;
  const typed = draft.slug.trim();
  const mismatch = typed !== "" && typed !== slug && !slug.startsWith(typed);
  return (
    <>
      <p className="text-body text-muted-foreground">{t("invitations.switch.close_body", { name })}</p>
      <Alert variant="warning">
        <TriangleAlert aria-hidden />
        <AlertDescription>{t("org.close.confirm_body", { name })}</AlertDescription>
      </Alert>
      <Field>
        <FieldLabel htmlFor={id}>{t("org.close.confirm_label")}</FieldLabel>
        <Input
          id={id}
          value={draft.slug}
          onChange={(e) => onChange({ slug: e.target.value })}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? `${id}-hint ${id}-error` : `${id}-hint`}
        />
        <FieldDescription id={`${id}-hint`}>{t("org.close.confirm_hint", { slug })}</FieldDescription>
        {mismatch ? <SettingsFieldError id={`${id}-error`}>{t("org.close.confirm_mismatch", { slug })}</SettingsFieldError> : null}
      </Field>
    </>
  );
}
