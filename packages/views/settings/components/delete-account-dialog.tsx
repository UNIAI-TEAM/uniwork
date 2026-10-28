"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api";
import { ownedOrganization, useDeleteAccount, type OwnedOrganization } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { apiErrorCopy } from "../../api-error-copy";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { useNavigation } from "../../navigation";
import { SettingsFieldError } from "./settings-layout";
import { useStepUpGate } from "./step-up-proof";

/** What erasing the account does, one line each, read before anything is pressed. */
const CONSEQUENCES = [
  "settings.security.delete.consequences.erased",
  "settings.security.delete.consequences.kept",
  "settings.security.delete.consequences.owner",
] as const;

/** What closing the organization with the account does (the close dialog's own lines). */
const CLOSE_CONSEQUENCES = [
  "org.close.consequences.archived",
  "org.close.consequences.no_access",
  "org.close.consequences.restore",
  "org.close.consequences.billing",
] as const;

/**
 * Erasing the account (Nghị định 13, ADR 0047 §5). The question is asked
 * here; who is asking is proved through the shared "Xác nhận là bạn" dialog,
 * nested in this one, never by a field of its own. The server weighs the
 * proof first and only then whether the account still owns an organization
 * (account_deletion.go): the owner of one that others are in hands it over
 * first, and the only member of one closes it in the same request by typing
 * its slug back, proved by the token the first press bought.
 */
export function DeleteAccountDialog() {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const del = useDeleteAccount();
  const gate = useStepUpGate();
  const [open, setOpen] = useState(false);
  // The organization the server said stands in the way; null until it does.
  const [owned, setOwned] = useState<OwnedOrganization | null>(null);
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ids = useId();
  const fieldId = `${ids}-slug`;
  const promptId = `${ids}-prompt`;
  const errorId = `${ids}-error`;
  const reasonId = `${ids}-reason`;
  const failureId = `${ids}-failure`;
  const formRef = useRef<HTMLFormElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);

  const closing = owned?.canClose === true;
  const blocked = owned !== null && !owned.canClose;
  const slug = owned?.slug ?? "";
  const value = typed.trim();
  // Compared exactly, as the server compares close_organization.
  const matches = value === slug;
  const showMismatch = closing && value !== "" && !matches && (touched || !slug.startsWith(value));
  const missing = closing && !matches ? t("org.close.reason_slug") : null;

  // A refusal that names the organization changes what the dialog asks for:
  // focus goes to the slug to type, or to the way out when there is nothing
  // left to press.
  useEffect(() => {
    if (owned?.canClose) slugRef.current?.focus();
    else if (owned) formRef.current?.querySelector<HTMLElement>('[data-slot="dialog-footer"] button')?.focus();
  }, [owned]);

  const changeOpen = (next: boolean) => {
    if (next) {
      // Every opening starts from the question: the organization may have
      // changed hands since a refusal said otherwise.
      setOwned(null);
      setTyped("");
      setTouched(false);
      setFailure(null);
      setOpen(true);
    } else if (!del.isPending) setOpen(false);
  };

  const refused = (err: unknown) => {
    const organization = ownedOrganization(err);
    if (organization) {
      setOwned(organization);
      setTyped("");
      setTouched(false);
      return;
    }
    // Somebody joined the organization meanwhile: it can only be handed over now.
    if (errorCode(err) === "organization_has_members" && owned) return setOwned({ ...owned, canClose: false });
    // The slug changed while the dialog was open; the field is right about the old one.
    if (errorCode(err) === "close_confirm_mismatch") return setFailure(t("org.close.confirm_mismatch", { slug }));
    setFailure(apiErrorCopy(err) ?? t("settings.security.delete.failed"));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (del.isPending || gate.asking || blocked || missing) return;
    setFailure(null);
    void gate.run({
      action: "delete_account",
      command: () => del.mutateAsync(closing ? { close_organization: value } : {}),
      onSuccess: () => push(paths.login()),
      onError: refused,
    });
  };

  const name = owned?.name ?? "";
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>{t("settings.security.delete.open")}</DialogTrigger>
      <FormDialogContent destructive showCloseButton={!del.isPending}>
        <form ref={formRef} noValidate onSubmit={submit}>
          <FormDialogHeader title={t("settings.security.delete.title")} description={t("settings.security.delete.body")} />
          <FormDialogBody>
            {owned === null ? (
              // A note, not an alert: it is read with the question, not over it.
              <Alert variant="destructiveSoft" role="note">
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4 text-pretty">
                    {CONSEQUENCES.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : (
              // Inserted by the server's answer, so it is said as it appears.
              <Alert variant="destructiveSoft" role="alert">
                <AlertDescription className="flex flex-col gap-2 text-pretty [overflow-wrap:anywhere]">
                  {closing ? (
                    <>
                      <p>{t("settings.security.delete.closeNotice", { name })}</p>
                      <ul className="list-disc space-y-1 pl-4">
                        {CLOSE_CONSEQUENCES.map((key) => (
                          <li key={key}>{t(key, { name })}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>{name ? t("settings.security.delete.ownerTransfer", { name }) : t("settings.security.delete.ownerHint")}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {closing ? (
              <Field>
                <FieldLabel htmlFor={fieldId}>{t("org.close.confirm_label")}</FieldLabel>
                {/* What to type sits between the label and the field, as on the close dialog. */}
                <FieldDescription id={promptId}>
                  <Trans
                    t={t}
                    i18nKey="org.close.confirm_prompt"
                    values={{ slug }}
                    components={{
                      v: <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-caption text-foreground" />,
                    }}
                  />
                </FieldDescription>
                <Input
                  ref={slugRef}
                  id={fieldId}
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setFailure(null);
                  }}
                  onBlur={() => setTouched(true)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={showMismatch || undefined}
                  aria-describedby={showMismatch ? `${promptId} ${errorId}` : promptId}
                />
                <SettingsFieldError id={errorId}>
                  {showMismatch ? t("org.close.confirm_mismatch", { slug }) : null}
                </SettingsFieldError>
              </Field>
            ) : null}
            {/* Said where the action is, not in a toast the dialog would cover. */}
            <SettingsFieldError id={failureId}>{failure}</SettingsFieldError>
          </FormDialogBody>
          {blocked ? (
            <FormDialogFooter onCancel={() => changeOpen(false)} cancelLabel={t("common.close")} />
          ) : (
            <FormDialogFooter
              onCancel={() => changeOpen(false)}
              submitType="submit"
              destructive
              submitLabel={t(closing ? "settings.security.delete.closeAndDelete" : "settings.security.delete.confirm")}
              submittingLabel={t("settings.security.delete.deleting")}
              submitting={del.isPending}
              submitDisabled={missing !== null}
              reasonId={reasonId}
              leading={
                missing && !del.isPending ? (
                  <span id={reasonId} className="text-pretty">
                    {missing}
                  </span>
                ) : null
              }
            />
          )}
        </form>
        {gate.dialog}
      </FormDialogContent>
    </Dialog>
  );
}
