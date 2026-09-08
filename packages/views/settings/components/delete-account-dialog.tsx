"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toastApiError } from "../../toast-api-error";
import { useAuthStore, useDeleteAccount } from "@uniwork/core/auth";
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
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { useNavigation } from "../../navigation";

/**
 * Erasure needs one proof, chosen by what the account has (spec F-01 §2 I9):
 * the password, else a TOTP code, else the typed email address.
 */
export function DeleteAccountDialog() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.delete" });
  const user = useAuthStore((s) => s.user);
  const { push } = useNavigation();
  const del = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState("");
  const mode: "password" | "code" | "email" = user?.has_password ? "password" : user?.mfa_enabled_at ? "code" : "email";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setProof("");
      }}
    >
      <DialogTrigger render={<Button variant="destructive" />}>{t("open")}</DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (del.isPending || !proof.trim()) return;
            const body =
              mode === "password" ? { password: proof } : mode === "code" ? { code: proof.trim() } : { email_confirmation: proof.trim() };
            del.mutate(body, {
              onSuccess: () => push(paths.login()),
              onError: (err) => toastApiError(err, t("failed")),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <Field className="my-4">
            <FieldLabel htmlFor="delete-proof">{t(`proof.${mode}`)}</FieldLabel>
            <Input
              id="delete-proof"
              type={mode === "password" ? "password" : "text"}
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              autoComplete={mode === "password" ? "current-password" : mode === "code" ? "one-time-code" : "email"}
              placeholder={mode === "email" ? (user?.email ?? "") : undefined}
            />
            <FieldDescription>{t("ownerHint")}</FieldDescription>
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>{t("cancel")}</DialogClose>
            <Button type="submit" variant="destructive" aria-disabled={del.isPending || !proof.trim() || undefined}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
