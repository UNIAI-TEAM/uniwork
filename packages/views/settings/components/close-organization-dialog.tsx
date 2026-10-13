"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api";
import { useCloseOrganization } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import { useOptionalNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import { SettingsFieldError } from "./settings-layout";

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
}: {
  orgSlug: string;
  organizationName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigation = useOptionalNavigation();
  const closeOrg = useCloseOrganization(orgSlug);
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  // Someone joined between opening the dialog and confirming: the server
  // refuses, and the owner has to transfer instead.
  const [refusal, setRefusal] = useState<string | null>(null);
  const value = typed.trim();
  const matches = value === orgSlug;
  const showMismatch = value !== "" && !matches && (touched || !orgSlug.startsWith(value));
  const ready = matches && !closeOrg.isPending;

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

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setRefusal(null);
    closeOrg.mutate(value, {
      onSuccess: () => {
        toast.success(t("org.close.done"));
        reset();
        navigation?.replace(paths.getStarted());
      },
      onError: (err) => {
        if (errorCode(err) === "organization_has_members") {
          setRefusal(t("org.reasons.organization_has_members"));
          return;
        }
        if (errorCode(err) === "close_confirm_mismatch") {
          // The slug changed while the dialog was open; the field is right
          // about the old one, so the sentence goes below it.
          setRefusal(t("org.close.confirm_mismatch", { slug: orgSlug }));
          return;
        }
        toastApiError(err, t("common.error"));
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent showCloseButton={!closeOrg.isPending}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("org.close.confirm_title", { name: organizationName })}</DialogTitle>
            <DialogDescription>{t("org.close.confirm_body", { name: organizationName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Field>
              <FieldLabel htmlFor="close-org-confirm">{t("org.close.confirm_label")}</FieldLabel>
              <Input
                id="close-org-confirm"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setRefusal(null);
                }}
                onBlur={() => setTouched(true)}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showMismatch || undefined}
                aria-describedby={showMismatch ? "close-org-hint close-org-error" : "close-org-hint"}
              />
              <FieldDescription id="close-org-hint">{t("org.close.confirm_hint", { slug: orgSlug })}</FieldDescription>
              {showMismatch ? (
                <SettingsFieldError id="close-org-error">
                  {t("org.close.confirm_mismatch", { slug: orgSlug })}
                </SettingsFieldError>
              ) : null}
            </Field>
            {refusal ? (
              <div role="alert">
                <SettingsFieldError id="close-org-refusal">{refusal}</SettingsFieldError>
              </div>
            ) : null}
          </div>
          <DialogFooter showCloseButton={false}>
            <DialogClose
              render={<Button type="button" variant="ghost" aria-disabled={closeOrg.isPending || undefined} />}
            >
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              aria-disabled={!ready || undefined}
              aria-busy={closeOrg.isPending || undefined}
            >
              {t("org.close.action")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
