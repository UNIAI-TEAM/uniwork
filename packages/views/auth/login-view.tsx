"use client";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useLogin } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { AppLink } from "../navigation";
import { AuthShell } from "./auth-shell";
import { GoogleButton } from "./google-button";
import { PasswordField } from "./password-field";

/** Inline text link with the same 44px coarse-pointer floor the Button primitive carries. */
export const AUTH_LINK =
  "inline-flex items-center font-medium text-brand hover:underline pointer-coarse:min-h-11 pointer-coarse:px-1";

/** Errors the Google callback can carry back on the login URL. */
export type GoogleLoginError = "google_denied" | "google_failed" | "google_unverified";

export function LoginView({
  onSuccess,
  next,
  initialError,
}: {
  onSuccess: (sess: SessionResponse) => void;
  /** Same-origin path to return to after any sign-in; forwarded to Google too. */
  next?: string | null;
  initialError?: GoogleLoginError | null;
}) {
  const { t } = useTranslation();
  const login = useLogin();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Two different failures, two different owners. A rejected login belongs to
  // the email/password pair and marks them invalid; a Google error arrived on
  // the URL before the user typed anything, so it is announced at form level
  // and the fields stay clean until this form is actually submitted.
  const errorMsg =
    login.error instanceof ApiError && login.error.code === "invalid_credentials"
      ? t("auth.invalidCredentials")
      : login.error
        ? t("common.error")
        : null;
  const googleError =
    initialError && !login.isPending && !login.isSuccess && !login.error
      ? t(`auth.google.${initialError.replace("google_", "")}`)
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // The button carries `aria-disabled`, which keeps it in the tab order and
    // therefore still able to receive an Enter key. The guard lives here so a
    // second submit is impossible however it arrives.
    if (login.isPending) return;
    login.mutate({ email, password }, { onSuccess });
  };

  return (
    <AuthShell title={t("auth.login")} description={t("auth.loginSubtitle")}>
      {/* noValidate: the browser's own bubble is untranslated and disappears on
          the next keystroke. Both fields stay `required` so assistive tech
          still announces them as such. */}
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="login-email">{t("auth.email")}</FieldLabel>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              enterKeyHint="next"
              autoFocus
              required
              aria-invalid={errorMsg ? true : undefined}
              aria-describedby={errorMsg ? errorId : undefined}
              className="h-10 text-body pointer-coarse:h-11"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="login-password">{t("auth.password")}</FieldLabel>
            <PasswordField
              id="login-password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              invalid={!!errorMsg}
              describedBy={errorMsg ? errorId : undefined}
            />
          </Field>
          {/* One message for the pair. The server does not say which half was
              wrong, and inventing a per-field answer would leak which emails
              are registered. */}
          <FieldError id={errorId}>{errorMsg}</FieldError>
          {googleError ? <FieldError>{googleError}</FieldError> : null}
        </FieldGroup>

        <div className="flex flex-col gap-4">
          <Button type="submit" size="lg" className="w-full" aria-disabled={login.isPending || undefined}>
            {login.isPending ? (
              <>
                <Loader2 aria-hidden className="animate-spin" />
                {t("auth.signingIn")}
              </>
            ) : (
              t("auth.login")
            )}
          </Button>
          {/* The alternative sign-in sits with the primary action, before the
              secondary links, so a phone user sees both ways in without
              scrolling past the help text. */}
          <GoogleButton next={next} />
          <p className="text-center text-label text-muted-foreground">
            {t("auth.noAccount")}{" "}
            <AppLink href={paths.register()} className={AUTH_LINK}>
              {t("auth.register")}
            </AppLink>
          </p>
          {/* Stated, not linked: there is no password-reset route or handler
              yet. The mailer (server/internal/mail) exists now, so a reset flow
              is buildable — until it is, a locked-out user is told the one
              thing that does work instead of being handed a dead link. */}
          <p className="text-center text-caption text-muted-foreground">
            <span className="font-medium text-foreground">{t("auth.forgotPassword")}</span>{" "}
            {t("auth.forgotPasswordHelp")}
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
