"use client";

import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api";
import { useCloseOrganization } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { useOptionalNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import { SettingsFieldError } from "./settings-layout";

/** One line each, so the owner can scan what they are agreeing to. */
const CONSEQUENCES = [
  "org.close.consequences.archived",
  "org.close.consequences.no_access",
  "org.close.consequences.restore",
  "org.close.consequences.billing",
] as const;

type Refusal = { text: string; hasMembers: boolean };

/**
 * Closing the organization as its last active member (ADR 0032): it is
 * archived, nothing is deleted, and the owner leaves it. The friction is the
 * slug typed back, compared exactly as the server compares it. On success the
 * cache is already cleared (useCloseOrganization), so the owner goes to
 * /get-started rather than back into a workspace they can no longer open.
 */
export function CloseOrganizationDialog({
  orgSlug,
  organizationName,
  open,
  onOpenChange,
  onTransferInstead,
}: {
  orgSlug: string;
  organizationName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * The server refused because somebody else is still active: the way on is
   * a transfer, so the refusal offers it instead of leaving the owner to find
   * the other row.
   */
  onTransferInstead?: () => void;
}) {
  const { t } = useTranslation();
  const navigation = useOptionalNavigation();
  const closeOrg = useCloseOrganization(orgSlug);
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  // Someone joined between opening the dialog and confirming: the server
  // refuses, and the owner has to transfer instead.
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const value = typed.trim();
  const matches = value === orgSlug;
  const showMismatch = value !== "" && !matches && (touched || !orgSlug.startsWith(value));
  // A refusal for other members cannot be fixed by pressing again; one for a
  // changed slug can, once the field is retyped (which clears it).
  const ids = useId();
  const fieldId = `${ids}-confirm`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const refusalId = `${ids}-refusal`;
  // Why the action is held back, in words on it: the refusal already on
  // screen when other members are still active (said once, not twice),
  // otherwise the slug still to type.
  const blockedByMembers = refusal?.hasMembers === true;
  const missing = blockedByMembers ? refusal.text : !matches ? t("org.close.reason_slug") : null;
  const reasonId = blockedByMembers ? refusalId : `${ids}-reason`;

  const reset = () => {
    setTyped("");
    setTouched(false);
    setRefusal(null);
    onOpenChange(false);
  };

  const changeOpen = (next: boolean) => {
    if (next) onOpenChange(true);
    else if (!closeOrg.isPending) reset();
  };

  const transferInstead = onTransferInstead
    ? () => {
        reset();
        onTransferInstead();
      }
    : undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (missing || closeOrg.isPending) return;
    setRefusal(null);
    closeOrg.mutate(value, {
      onSuccess: () => {
        toast.success(t("org.close.done"));
        reset();
        navigation?.replace(paths.getStarted());
      },
      onError: (err) => {
        if (errorCode(err) === "organization_has_members") {
          setRefusal({ text: t("org.reasons.organization_has_members"), hasMembers: true });
          return;
        }
        if (errorCode(err) === "close_confirm_mismatch") {
          // The slug changed while the dialog was open; the field is right
          // about the old one, so the sentence goes below it.
          setRefusal({ text: t("org.close.confirm_mismatch", { slug: orgSlug }), hasMembers: false });
          return;
        }
        toastApiError(err, t("common.error"));
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <FormDialogContent destructive showCloseButton={!closeOrg.isPending}>
        <form onSubmit={submit}>
          <FormDialogHeader
            title={t("org.close.confirm_title", { name: organizationName })}
            description={t("org.close.confirm_lede")}
          />
          <FormDialogBody>
            {/* The same destructive notice the invitation switch shows for a
                close; `note`, not `alert`, so opening the dialog does not
                interrupt the reader with all four lines at once. The bullets
                are its only markers: a leading icon beside the first one
                read as two. */}
            <Alert variant="destructiveSoft" role="note">
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4 text-pretty">
                  {CONSEQUENCES.map((key) => (
                    <li key={key}>{t(key, { name: organizationName })}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
            <Field>
              <FieldLabel htmlFor={fieldId}>{t("org.close.confirm_label")}</FieldLabel>
              {/* What to type sits between the label and the field, so it is
                  read before the caret lands, not discovered after. */}
              <FieldDescription id={hintId}>
                <Trans
                  t={t}
                  i18nKey="org.close.confirm_prompt"
                  values={{ slug: orgSlug }}
                  components={{
                    v: <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-caption text-foreground" />,
                  }}
                />
              </FieldDescription>
              <Input
                id={fieldId}
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setRefusal(null);
                }}
                onBlur={() => setTouched(true)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={showMismatch || undefined}
                aria-describedby={showMismatch ? `${hintId} ${errorId}` : hintId}
              />
              <SettingsFieldError id={errorId}>
                {showMismatch ? t("org.close.confirm_mismatch", { slug: orgSlug }) : null}
              </SettingsFieldError>
            </Field>
            {refusal ? (
              <div role="alert" className="flex flex-col items-start gap-1">
                <SettingsFieldError id={refusalId} live={false}>
                  {refusal.text}
                </SettingsFieldError>
                {refusal.hasMembers && transferInstead ? (
                  <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={transferInstead}>
                    {t("org.transfer.action")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => changeOpen(false)}
            submitType="submit"
            destructive
            submitLabel={t("org.close.action")}
            submittingLabel={t("org.close.action_pending")}
            submitting={closeOrg.isPending}
            submitDisabled={missing !== null}
            reasonId={reasonId}
            leading={
              missing && !blockedByMembers && !closeOrg.isPending ? (
                <span id={reasonId} className="text-pretty">
                  {missing}
                </span>
              ) : null
            }
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
