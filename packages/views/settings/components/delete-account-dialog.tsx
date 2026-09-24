"use client";

import { useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
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
import { SettingsFieldError } from "./settings-layout";

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
  // Every refusal (empty, wrong proof, the server's reason) sits under the
  // field the reader typed in, and focus goes back there. No toast: the
  // dialog would cover it, and one failure has one voice.
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const mode: "password" | "code" | "email" = user?.has_password ? "password" : user?.mfa_enabled_at ? "code" : "email";

  const fail = (message: string) => {
    setError(message);
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setProof("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="destructive" />}>{t("open")}</DialogTrigger>
      <DialogContent>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (del.isPending) return;
            if (!proof.trim()) {
              fail(t(`required.${mode}`));
              return;
            }
            setError(null);
            const body =
              mode === "password" ? { password: proof } : mode === "code" ? { code: proof.trim() } : { email_confirmation: proof.trim() };
            del.mutate(body, {
              onSuccess: () => push(paths.login()),
              onError: (err) => fail(apiErrorMessage(err) ?? t("failed")),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <Field className="my-4">
            <FieldLabel htmlFor={inputId}>{t(`proof.${mode}`)}</FieldLabel>
            <Input
              ref={inputRef}
              id={inputId}
              type={mode === "password" ? "password" : mode === "email" ? "email" : "text"}
              value={proof}
              onChange={(e) => {
                setProof(e.target.value);
                setError(null);
              }}
              autoComplete={mode === "password" ? "current-password" : mode === "code" ? "one-time-code" : "email"}
              autoCapitalize={mode === "password" ? undefined : "none"}
              spellCheck={mode === "password" ? undefined : false}
              placeholder={mode === "email" ? (user?.email ?? "") : undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
            />
            {error ? <SettingsFieldError id={errorId}>{error}</SettingsFieldError> : null}
            <FieldDescription id={hintId}>{t("ownerHint")}</FieldDescription>
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>{t("cancel")}</DialogClose>
            <Button
              type="submit"
              variant="destructive"
              aria-disabled={del.isPending || undefined}
              aria-busy={del.isPending || undefined}
            >
              {del.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
