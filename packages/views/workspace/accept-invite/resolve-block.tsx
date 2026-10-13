"use client";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MembershipConflict } from "@uniwork/core/types";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { useTransferCandidates } from "../../settings/components/transfer-ownership-dialog";
import { TransferCandidateField, TransferPasswordField } from "../../settings/components/transfer-owner-fields";
import { SettingsFieldError } from "../../settings/components/settings-layout";
import { cn } from "@uniwork/ui/lib/utils";
import { RoleBadge } from "./org-mark";
import type { SwitchDraft } from "./switch-draft";

type BlockProps = {
  conflict: MembershipConflict;
  draft: SwitchDraft;
  onChange: (patch: Partial<SwitchDraft>) => void;
  /** The server refused the owner's password on the last attempt. */
  passwordError?: string;
  /** The account has no password, so a transfer cannot be confirmed here. */
  passwordless?: boolean;
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
  // Closing is the one choice that ends the organization for everyone, so it
  // alone is set apart with the destructive edge; leaving and handing over
  // sit on a quiet tinted plane inside the card.
  const closes = conflict.required_action === "close";
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-4 rounded-xl p-4 sm:p-5",
        closes ? "bg-surface ring-1 ring-destructive/30" : "bg-muted/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={headingId} className="text-balance text-body-lg font-semibold text-foreground [overflow-wrap:anywhere]">
          {name}
        </h3>
        <RoleBadge role={conflict.role} />
        {closes ? <Badge variant="destructive">{t("invitations.switch.close_badge")}</Badge> : null}
      </div>
      <BlockBody {...props} />
    </section>
  );
}

/**
 * What cannot be undone, or cannot be done here: the destructive notice on its
 * soft surface. A note, not an alert: it is part of the step, which the step
 * heading already announces when it takes focus.
 */
function DestructiveNotice({ children }: { children: ReactNode }) {
  return (
    <Alert
      variant="destructive"
      role="note"
      className="border-destructive/25 bg-destructive-soft *:data-[slot=alert-description]:text-destructive-soft-foreground"
    >
      <CircleAlert aria-hidden />
      <AlertDescription className="text-pretty">{children}</AlertDescription>
    </Alert>
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
      return <DestructiveNotice>{t("invitations.switch.blocked", { name })}</DestructiveNotice>;
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
      <p className="text-pretty text-body text-muted-foreground">{t("invitations.switch.leave_body", { name })}</p>
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

function TransferBlock({ conflict, draft, onChange, passwordError, passwordless = false }: BlockProps) {
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
      <p className="text-pretty text-body text-muted-foreground">{t("invitations.switch.transfer_body", { name })}</p>
      <TransferCandidateField
        id={`${prefix}-target`}
        candidates={candidates}
        value={draft.toUserId}
        onValueChange={pick}
        loading={loading}
        isError={isError}
        onRetry={retry}
        empty={none ? t("org.transfer.no_candidate") : undefined}
      />
      {passwordless ? (
        <DestructiveNotice>{t("invitations.switch.no_password", { name })}</DestructiveNotice>
      ) : (
        <TransferPasswordField
          id={`${prefix}-password`}
          value={draft.password}
          onValueChange={(password) => onChange({ password })}
          error={passwordError}
        />
      )}
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
      <p className="text-pretty text-body text-muted-foreground">{t("invitations.switch.close_body", { name })}</p>
      <DestructiveNotice>{t("org.close.confirm_body", { name })}</DestructiveNotice>
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
