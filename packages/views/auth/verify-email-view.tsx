"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useLogout, useResendVerification, useSession, useVerifyEmail } from "@uniwork/core/auth";
import type { User } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@uniwork/ui/components/ui/input-otp";
import { AuthShell } from "./auth-shell";

const CODE_LENGTH = 6;
/** Mirrors the server's resend gap; the count starts on arrival because register just sent one. */
const RESEND_SECONDS = 60;

export function VerifyEmailView({ onSuccess }: { onSuccess: (user: User) => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const logout = useLogout();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const invalidCode = verify.error instanceof ApiError && verify.error.code === "invalid_code";
  const tooSoon = resend.error instanceof ApiError && resend.error.code === "rate_limited";
  const errorMsg = invalidCode
    ? t("auth.verify.invalidCode")
    : verify.error
      ? t("common.error")
      : tooSoon
        ? t("auth.verify.resendTooSoon")
        : resend.error
          ? t("common.error")
          : null;

  const onChange = (value: string) => {
    setCode(value);
    if (verify.error) verify.reset();
    if (value.length === CODE_LENGTH && !verify.isPending) {
      verify.mutate(value, {
        onSuccess,
        // The wrong code is cleared so the next attempt starts from the first box.
        onError: () => setCode(""),
      });
    }
  };

  const onResend = () => {
    if (cooldown > 0 || resend.isPending) return;
    setResent(false);
    resend.mutate(undefined, {
      onSuccess: () => {
        setResent(true);
        setCooldown(RESEND_SECONDS);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === "rate_limited") setCooldown(RESEND_SECONDS);
      },
    });
  };

  return (
    <AuthShell title={t("auth.verify.title")} description={t("auth.verify.subtitle", { email: user?.email ?? "" })}>
      <div className="flex flex-col gap-6">
        <FieldGroup>
          <Field data-invalid={invalidCode || undefined}>
            <FieldLabel htmlFor="verify-code">{t("auth.verify.codeLabel")}</FieldLabel>
            <InputOTP
              id="verify-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={onChange}
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-invalid={invalidCode || undefined}
              aria-describedby={errorMsg ? errorId : undefined}
              // readOnly, not disabled: the input keeps focus and its place in
              // the tab order while the code is checked, and the wait is
              // announced instead of the field silently greying out.
              readOnly={verify.isPending}
              aria-busy={verify.isPending || undefined}
            >
              <InputOTPGroup>
                {Array.from({ length: CODE_LENGTH }, (_, i) => (
                  <InputOTPSlot key={i} index={i} className="size-11 text-title" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </Field>
          <FieldError id={errorId}>{errorMsg}</FieldError>
          {resent && !errorMsg ? (
            <p role="status" className="text-label text-muted-foreground">
              {t("auth.verify.resent")}
            </p>
          ) : null}
        </FieldGroup>

        <div className="flex flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={onResend}
            aria-disabled={cooldown > 0 || resend.isPending || undefined}
          >
            {verify.isPending ? (
              <>
                <Loader2 aria-hidden className="animate-spin" />
                {t("auth.verify.verifying")}
              </>
            ) : cooldown > 0 ? (
              t("auth.verify.resendIn", { seconds: cooldown })
            ) : (
              t("auth.verify.resend")
            )}
          </Button>
          <p className="text-center text-caption text-muted-foreground">{t("auth.verify.spamHint")}</p>
          <p className="flex flex-wrap items-center justify-center gap-x-1 text-label text-muted-foreground">
            {t("auth.verify.wrongAccount")}
            {/* Button primitive for the 44px coarse-pointer floor; a bare
                <button> in running text was 18px tall on touch. */}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-1 text-label text-brand"
              onClick={() => logout.mutate()}
              aria-disabled={logout.isPending || undefined}
            >
              {t("auth.logout")}
            </Button>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
