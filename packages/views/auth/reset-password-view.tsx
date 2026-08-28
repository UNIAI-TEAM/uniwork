"use client";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useResetPassword } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { AppLink } from "../navigation";
import { AuthShell } from "./auth-shell";
import { AUTH_LINK } from "./login-view";
import { PasswordField } from "./password-field";

const MIN = 8;

export function ResetPasswordView({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: (sess: SessionResponse) => void;
}) {
  const { t } = useTranslation();
  const reset = useResetPassword();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const invalidToken = reset.error instanceof ApiError && reset.error.code === "invalid_token";
  const errorMsg = mismatch ? t("auth.reset.mismatch") : reset.error ? t("common.error") : null;

  if (invalidToken) {
    return (
      <AuthShell title={t("auth.reset.title")} description={t("auth.reset.invalidToken")}>
        <AppLink href={paths.forgotPassword()} className={AUTH_LINK}>
          {t("auth.reset.requestNew")}
        </AppLink>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.reset.title")} description={t("auth.reset.subtitle")}>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (reset.isPending) return;
          if (password !== confirm) {
            setMismatch(true);
            return;
          }
          setMismatch(false);
          reset.mutate({ token, password }, { onSuccess });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="reset-password">{t("auth.reset.newPassword")}</FieldLabel>
            <PasswordField
              id="reset-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={MIN}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="reset-confirm">{t("auth.reset.confirmPassword")}</FieldLabel>
            <PasswordField
              id="reset-confirm"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              minLength={MIN}
              invalid={mismatch}
              describedBy={errorMsg ? errorId : undefined}
            />
          </Field>
          <FieldError id={errorId}>{errorMsg}</FieldError>
        </FieldGroup>
        <Button type="submit" size="lg" className="w-full" aria-disabled={reset.isPending || undefined}>
          {reset.isPending ? (
            <>
              <Loader2 aria-hidden className="animate-spin" />
              {t("auth.reset.submitting")}
            </>
          ) : (
            t("auth.reset.submit")
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
