"use client";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLogout, useResendVerification, useSession, useVerifyEmail } from "@uniwork/core/auth";
import { readSignInFailure, secondsUntil } from "@uniwork/core/auth/sign-in-errors";
import { VERIFICATION_RESEND_GAP_MS, verificationResendAt } from "@uniwork/core/auth/verification-mail";
import { paths } from "@uniwork/core/paths";
import type { User } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@uniwork/ui/components/ui/input-otp";
import { AppLink } from "../navigation";
import { AUTH_LINK, AUTH_PILL, DIGITS_ONLY } from "./auth-controls";
import { AuthShell } from "./auth-shell";
import { FailureSentence, useFailure } from "./continue-parts";

const CODE_LENGTH = 6;
/** The server's resend gap. */
const RESEND_SECONDS = VERIFICATION_RESEND_GAP_MS / 1000;

export function VerifyEmailView({ onSuccess }: { onSuccess: (user: User) => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const logout = useLogout();
  const errorId = useId();
  const [code, setCode] = useState("");
  // A minute after a code this browser just had mailed (register a moment
  // ago, a resend), else at once: a person back days later, whose first code
  // ran out, is not made to wait for nothing. The phone does the same.
  const [cooldown, setCooldown] = useState(() => {
    const now = Date.now();
    return secondsUntil(verificationResendAt(user?.email ?? "", now), now);
  });
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Both calls read through core's table, as on the phone: a wrong code is
  // the boxes', anything else (asked too soon, offline, the server) is said
  // under them too, never as the server's own message.
  const verifyFailure = useFailure(verify.error, "verify_email");
  const resendFailure = useFailure(resend.error, "verify_email");
  const failure = verifyFailure ?? resendFailure;
  const invalidCode = verifyFailure?.kind === "field";
  const errorMsg = failure ? <FailureSentence failure={failure} /> : null;

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
        if (readSignInFailure(err, "verify_email").code === "rate_limited") setCooldown(RESEND_SECONDS);
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
              pattern={DIGITS_ONLY}
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
          {/* The code check reports here, next to the boxes it is reading,
              not on the resend button below. */}
          {verify.isPending ? (
            <p role="status" className="flex items-center gap-2 text-label text-muted-foreground">
              <Spinner className="size-3.5" />
              {t("auth.verify.verifying")}
            </p>
          ) : resent && !errorMsg ? (
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
            className={AUTH_PILL}
            onClick={onResend}
            aria-disabled={cooldown > 0 || resend.isPending || undefined}
          >
            {/* This button resends; it reports the resend. The code check has
                its own status under the field (and `aria-busy`, read-only boxes) and
                used to borrow this label, so "Verifying…" sat on a button
                whose click sends a new code. */}
            {resend.isPending ? (
              <>
                <Spinner />
                {t("auth.verify.resending")}
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
          {/* An address typed wrong is an account nobody can prove: it can be
              deleted from the account's own settings, as on the phone. */}
          <p className="text-center text-label">
            <AppLink href={paths.accountSettings()} className={AUTH_LINK}>
              {t("auth.verify.deleteInSettings")}
            </AppLink>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
