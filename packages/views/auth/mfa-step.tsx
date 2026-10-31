"use client";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVerifyMfa } from "@uniwork/core/auth";
import type { SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_INPUT, AUTH_PILL, AuthSubmit } from "./auth-controls";
import { FailureSentence, useFailure, useWaitPhrase } from "./continue-parts";

/**
 * Second step of sign-in: the TOTP code, or a recovery code. `mfaToken` is
 * null when the challenge arrived as a cookie (Google, password reset).
 */
export function MFAStep({
  mfaToken,
  onSuccess,
  onCancel,
  keepSignInTicket = false,
}: {
  mfaToken: string | null;
  onSuccess: (sess: SessionResponse) => void;
  onCancel: () => void;
  /** /login?link=1: this sign-in is the account a pending Google or Apple links into (spec §4.4). */
  keepSignInTicket?: boolean;
}) {
  const { t } = useTranslation();
  const verify = useVerifyMfa();
  const errorId = useId();
  const hintId = useId();
  const [code, setCode] = useState("");
  // A 429 is a wait the server timed: the tenth wrong code locks the factor
  // for up to 15 minutes (second_factor_locked, retry_after), the route's
  // budget for a minute. Said with the time it takes, counted down, and the
  // code held until it is over.
  const failure = useFailure(verify.error, "second_factor");
  const wait = failure?.kind === "wait" ? failure : null;
  const phrase = useWaitPhrase(wait, verify.reset);
  // Every refusal reads through core's table, as on the phone: a wrong or
  // expired code, the lock, a lost connection, the server's trouble.
  const message = failure ? <FailureSentence failure={failure} phrase={phrase} /> : null;

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (verify.isPending || wait || code.trim().length < 6) return;
        verify.mutate({ mfaToken, code: code.trim(), keepSignInTicket }, { onSuccess });
      }}
    >
      <FieldGroup>
        <Field data-invalid={message ? true : undefined}>
          <FieldLabel htmlFor="mfa-code">{t("auth.mfa.codeLabel")}</FieldLabel>
          <Input
            id="mfa-code"
            name="code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              // A wait stays said until it is over; anything else clears on the next keystroke.
              if (verify.error && !wait) verify.reset();
            }}
            autoComplete="one-time-code"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? errorId : hintId}
            className={cn(AUTH_INPUT, "tracking-widest")}
          />
          <div className="-mt-1 min-h-5">
            {message ? (
              <FieldError id={errorId}>{message}</FieldError>
            ) : (
              <FieldDescription id={hintId}>{t("auth.mfa.hint")}</FieldDescription>
            )}
          </div>
        </Field>
      </FieldGroup>
      <div className="flex flex-col gap-3">
        <AuthSubmit
          pending={verify.isPending}
          pendingLabel={t("auth.mfa.verifying")}
          aria-disabled={wait ? true : undefined}
          aria-describedby={wait ? errorId : undefined}
        >
          {t("auth.mfa.submit")}
        </AuthSubmit>
        <Button type="button" variant="ghost" size="lg" className={AUTH_PILL} onClick={onCancel}>
          {t("auth.mfa.back")}
        </Button>
      </div>
    </form>
  );
}
