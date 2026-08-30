"use client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForgotPassword } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { AppLink } from "../navigation";
import { AuthShell } from "./auth-shell";
import { AUTH_LINK } from "./login-view";

export function ForgotPasswordView() {
  const { t } = useTranslation();
  const forgot = useForgotPassword();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Never reveal whether the address has an account: the "sent" state shows
  // unconditionally after a 200, whatever the server actually did with it.
  if (sentTo) {
    return (
      <AuthShell title={t("auth.forgot.sentTitle")} description={t("auth.forgot.sentBody", { email: sentTo })}>
        <div className="flex flex-col gap-4">
          <p className="text-label text-muted-foreground">{t("auth.forgot.googleHint")}</p>
          <AppLink href={paths.login()} className={AUTH_LINK}>
            {t("auth.forgot.backToLogin")}
          </AppLink>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.forgot.title")} description={t("auth.forgot.subtitle")}>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (forgot.isPending) return;
          forgot.mutate(email, { onSuccess: () => setSentTo(email) });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="forgot-email">{t("auth.email")}</FieldLabel>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              className="h-10 text-body pointer-coarse:h-11"
            />
          </Field>
          <FieldError>{forgot.error ? t("common.error") : null}</FieldError>
        </FieldGroup>
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
        <p className="text-center text-label text-muted-foreground">
          <AppLink href={paths.login()} className={AUTH_LINK}>
            {t("auth.forgot.backToLogin")}
          </AppLink>
        </p>
      </form>
    </AuthShell>
  );
}
