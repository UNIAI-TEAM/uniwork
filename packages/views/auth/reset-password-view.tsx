"use client";
import { Link2Off, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import { useResetPassword } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { isMFAChallenge, type SessionResponse } from "@uniwork/core/types";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink, useNavigation } from "../navigation";
import { AuthShell } from "./auth-shell";
import { AUTH_LINK } from "./login-view";
import { PasswordField } from "./password-field";

/** Mirrors `validatePassword` on the server; the server still decides. */
const MIN = 8;

type ClientError = "tooShort" | "mismatch" | null;

export function ResetPasswordView({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: (sess: SessionResponse) => void;
}) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const reset = useResetPassword();
  const errorId = useId();
  const hintId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [clientError, setClientError] = useState<ClientError>(null);
  const invalidToken = reset.error instanceof ApiError && reset.error.code === "invalid_token";
  const errorMsg = clientError
    ? t(`auth.reset.${clientError}`, { min: MIN })
    : reset.error
      ? (apiErrorMessage(reset.error) ?? t("common.error"))
      : null;
  // The message sits under the field that owns it: the first for length, the
  // second for the pair. A server error belongs to neither and marks both.
  const owner: "password" | "confirm" | "form" | null =
    clientError === "tooShort" ? "password" : clientError === "mismatch" ? "confirm" : reset.error ? "form" : null;
  const passwordInvalid = owner === "password" || owner === "form";
  const confirmInvalid = owner === "confirm" || owner === "form";

  if (invalidToken) {
    return (
      <AuthShell title={t("auth.reset.invalidTitle")} description={t("auth.reset.invalidToken")}>
        <div className="flex flex-col gap-6">
          <p className="flex items-start gap-3 text-body text-muted-foreground">
            <Link2Off aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t("auth.reset.invalidHint")}
          </p>
          <div className="flex flex-col gap-4">
            {/* A link dressed as the primary button: it navigates, so it stays
                an <a> for assistive tech instead of a Button with role swapped. */}
            <AppLink href={paths.forgotPassword()} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
              {t("auth.reset.requestNew")}
            </AppLink>
            <p className="text-center text-body text-muted-foreground">
              <AppLink href={paths.login()} className={AUTH_LINK}>
                {t("auth.forgot.backToLogin")}
              </AppLink>
            </p>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.reset.title")} description={t("auth.reset.subtitle")}>
      {/* noValidate: the browser's own bubble is untranslated; the fields stay
          `required`/`minLength` so assistive tech still announces them. */}
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (reset.isPending) return;
          // The message is announced by the alert; focus follows it to the
          // field that owns it so the fix is one keystroke away.
          if (password.length < MIN) {
            setClientError("tooShort");
            passwordRef.current?.focus();
            return;
          }
          if (password !== confirm) {
            setClientError("mismatch");
            confirmRef.current?.focus();
            return;
          }
          setClientError(null);
          reset.mutate(
            { token, password },
            {
              // MFA on: the challenge is in the cookie; the login page finishes it.
              onSuccess: (out) => (isMFAChallenge(out) ? push(`${paths.login()}?mfa=1`) : onSuccess(out)),
            },
          );
        }}
      >
        <FieldGroup>
          <Field data-invalid={passwordInvalid || undefined}>
            <FieldLabel htmlFor="reset-password">{t("auth.reset.newPassword")}</FieldLabel>
            <PasswordField
              ref={passwordRef}
              id="reset-password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                if (clientError) setClientError(null);
              }}
              autoComplete="new-password"
              minLength={MIN}
              autoFocus
              invalid={passwordInvalid}
              describedBy={owner === "password" ? errorId : owner === "form" ? `${errorId} ${hintId}` : hintId}
            />
            {/* The length error says what the hint says; show one, not both. */}
            {owner === "password" ? (
              <FieldError id={errorId}>{errorMsg}</FieldError>
            ) : (
              <FieldDescription id={hintId} className="text-label">
                {t("auth.reset.hint", { min: MIN })}
              </FieldDescription>
            )}
          </Field>
          <Field data-invalid={confirmInvalid || undefined}>
            <FieldLabel htmlFor="reset-confirm">{t("auth.reset.confirmPassword")}</FieldLabel>
            <PasswordField
              ref={confirmRef}
              id="reset-confirm"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                if (clientError) setClientError(null);
              }}
              autoComplete="new-password"
              minLength={MIN}
              invalid={confirmInvalid}
              describedBy={confirmInvalid ? errorId : undefined}
            />
            {owner === "confirm" ? <FieldError id={errorId}>{errorMsg}</FieldError> : null}
          </Field>
          {owner === "form" ? <FieldError id={errorId}>{errorMsg}</FieldError> : null}
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
