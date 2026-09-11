"use client";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import { useRegister } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { AppLink } from "../navigation";
import { AuthShell } from "./auth-shell";
import { GoogleButton } from "./google-button";
import { AUTH_LINK } from "./login-view";
import { PasswordField } from "./password-field";

/** The server's minimum, restated here so the rule is visible before submitting. */
const PASSWORD_MIN = 8;

export function RegisterView({ onSuccess }: { onSuccess: (sess: SessionResponse) => void }) {
  const { t } = useTranslation();
  const reg = useRegister();
  const errorId = useId();
  const hintId = useId();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // A taken email is the one failure that belongs to a specific field, so it is
  // wired to that field. Anything else is a form-level failure: guessing which
  // input caused it would point the user at the wrong box.
  const emailTaken = reg.error instanceof ApiError && reg.error.code === "conflict";
  const errorMsg = emailTaken ? t("auth.emailTaken") : reg.error ? (apiErrorMessage(reg.error) ?? t("common.error")) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reg.isPending) return;
    reg.mutate({ email, password, displayName }, { onSuccess });
  };

  return (
    <AuthShell title={t("auth.register")} description={t("auth.registerSubtitle")}>
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="register-name">{t("auth.displayName")}</FieldLabel>
            <Input
              id="register-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              enterKeyHint="next"
              autoFocus
              required
              className="h-10 text-body pointer-coarse:h-11"
            />
          </Field>
          <Field data-invalid={emailTaken ? true : undefined}>
            <FieldLabel htmlFor="register-email">{t("auth.email")}</FieldLabel>
            <Input
              id="register-email"
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
              required
              aria-invalid={emailTaken || undefined}
              aria-describedby={emailTaken ? errorId : undefined}
              className="h-10 text-body pointer-coarse:h-11"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="register-password">{t("auth.password")}</FieldLabel>
            <PasswordField
              id="register-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              describedBy={hintId}
            />
            <FieldDescription id={hintId} className="text-caption">
              {t("auth.passwordMinHint", { min: PASSWORD_MIN })}
            </FieldDescription>
          </Field>
          <FieldError id={errorId}>{errorMsg}</FieldError>
        </FieldGroup>

        <div className="flex flex-col gap-4">
          <Button
            type="submit"
            size="lg"
            className="h-10 w-full pointer-coarse:h-11 aria-disabled:cursor-progress aria-disabled:opacity-100"
            aria-disabled={reg.isPending || undefined}
          >
            {reg.isPending ? (
              <>
                <Loader2 aria-hidden className="animate-spin" />
                {t("auth.registering")}
              </>
            ) : (
              t("auth.register")
            )}
          </Button>
          <GoogleButton />
          <p className="text-center text-body text-muted-foreground">
            {t("auth.hasAccount")}{" "}
            <AppLink href={paths.login()} className={AUTH_LINK}>
              {t("auth.login")}
            </AppLink>
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
