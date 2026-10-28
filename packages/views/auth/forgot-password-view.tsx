"use client";
import { MailCheck } from "lucide-react";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import { rememberLinkReset, useForgotPassword } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { AUTH_INPUT, AUTH_PILL, AUTH_PILL_HELD, AuthSubmit } from "./auth-controls";
import { AuthShell } from "./auth-shell";
import { AUTH_LINK } from "./login-view";
import { isLinkStep } from "./post-auth-redirect";

/** Mirrors the server's per-user resend gap; a click inside it is silently dropped there. */
const RESEND_SECONDS = 60;

/**
 * `next` came with "Quên mật khẩu?" from the sign-in page (spec §4.4): the way
 * back keeps it, and the link mode a link step's `next` stands for. The mailed
 * link cannot carry it: in link mode this browser remembers the address the
 * reset went to, and only a reset of that address links the pending sign-in.
 */
export function ForgotPasswordView({ next = null }: { next?: string | null }) {
  const { t } = useTranslation();
  const backToLogin = paths.login({ next, link: isLinkStep(next) });
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

  const errorMsg = forgot.error ? (apiErrorMessage(forgot.error) ?? t("common.error")) : null;

  const send = (onSent: () => void) => {
    if (forgot.isPending) return;
    forgot.mutate(email, {
      onSuccess: () => {
        if (isLinkStep(next)) rememberLinkReset(email);
        onSent();
      },
    });
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
              className={cn(AUTH_PILL, cooldown > 0 && !forgot.isPending && AUTH_PILL_HELD)}
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
                  <Spinner />
                  {t("auth.forgot.sending")}
                </>
              ) : cooldown > 0 ? (
                t("auth.forgot.resendIn", { seconds: cooldown })
              ) : (
                t("auth.forgot.resend")
              )}
            </Button>
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
              <AppLink href={backToLogin} className={AUTH_LINK}>
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
              className={AUTH_INPUT}
            />
          </Field>
          <FieldError id={errorId}>{errorMsg}</FieldError>
        </FieldGroup>
        <div className="flex flex-col gap-4">
          <AuthSubmit pending={forgot.isPending} pendingLabel={t("auth.forgot.sending")}>
            {t("auth.forgot.submit")}
          </AuthSubmit>
          {/* Before the address is sent, where "the email above" is: a Google or
              Apple account needs no reset, and one that wants a password too
              is mailed a link to set one (spec §3.7). */}
          <p className="text-pretty text-center text-caption text-muted-foreground">{t("auth.forgot.googleHint")}</p>
          <p className="text-center text-body text-muted-foreground">
            <AppLink href={backToLogin} className={AUTH_LINK}>
              {t("auth.forgot.backToLogin")}
            </AppLink>
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
