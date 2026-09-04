"use client";
import { Loader2, MailCheck } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useForgotPassword } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { AppLink } from "../navigation";
import { AuthShell } from "./auth-shell";
import { AUTH_LINK } from "./login-view";

/** Mirrors the server's per-user resend gap; a click inside it is silently dropped there. */
const RESEND_SECONDS = 60;

export function ForgotPasswordView() {
  const { t } = useTranslation();
  const forgot = useForgotPassword();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const errorMsg = forgot.error ? t("common.error") : null;

  const send = (onSent: () => void) => {
    if (forgot.isPending) return;
    forgot.mutate(email, { onSuccess: onSent });
  };

  // Never reveal whether the address has an account: the "sent" state shows
  // unconditionally after a 200, whatever the server actually did with it.
  if (sentTo) {
    return (
      <AuthShell title={t("auth.forgot.sentTitle")} description={t("auth.forgot.sentBody", { email: sentTo })}>
        <div className="flex flex-col gap-6">
          <p role="status" className="flex items-start gap-3 text-body text-muted-foreground">
            <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
            {resent ? t("auth.forgot.resent") : t("auth.forgot.spamHint")}
          </p>
          <FieldError>{errorMsg}</FieldError>
          <div className="flex flex-col gap-4">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => {
                if (cooldown > 0) return;
                send(() => {
                  setResent(true);
                  setCooldown(RESEND_SECONDS);
                });
              }}
              aria-disabled={cooldown > 0 || forgot.isPending || undefined}
            >
              {forgot.isPending ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  {t("auth.forgot.sending")}
                </>
              ) : cooldown > 0 ? (
                t("auth.forgot.resendIn", { seconds: cooldown })
              ) : (
                t("auth.forgot.resend")
              )}
            </Button>
            <p className="text-center text-body text-muted-foreground">{t("auth.forgot.googleHint")}</p>
            <p className="flex flex-wrap items-center justify-center gap-x-1 text-label text-muted-foreground">
              {t("auth.forgot.wrongEmail")}
              {/* Button primitive for the 44px coarse-pointer floor, same as verify. */}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-1 text-label text-brand"
                onClick={() => {
                  setSentTo(null);
                  setResent(false);
                  forgot.reset();
                }}
              >
                {t("auth.forgot.editEmail")}
              </Button>
            </p>
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
    <AuthShell title={t("auth.forgot.title")} description={t("auth.forgot.subtitle")}>
      {/* noValidate: the browser's own bubble is untranslated; the field stays
          `required` so assistive tech still announces it. */}
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          send(() => {
            setSentTo(email);
            setCooldown(RESEND_SECONDS);
          });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="forgot-email">{t("auth.email")}</FieldLabel>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              enterKeyHint="send"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              aria-invalid={errorMsg ? true : undefined}
              aria-describedby={errorMsg ? errorId : undefined}
              className="h-10 text-body pointer-coarse:h-11"
            />
          </Field>
          <FieldError id={errorId}>{errorMsg}</FieldError>
        </FieldGroup>
        <div className="flex flex-col gap-4">
          <Button type="submit" size="lg" className="w-full" aria-disabled={forgot.isPending || undefined}>
            {forgot.isPending ? (
              <>
                <Loader2 aria-hidden className="animate-spin" />
                {t("auth.forgot.sending")}
              </>
            ) : (
              t("auth.forgot.submit")
            )}
          </Button>
          <p className="text-center text-body text-muted-foreground">
            <AppLink href={paths.login()} className={AUTH_LINK}>
              {t("auth.forgot.backToLogin")}
            </AppLink>
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
