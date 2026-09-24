"use client";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import { useVerifyMfa } from "@uniwork/core/auth";
import type { SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_INPUT, AUTH_PILL, AuthSubmit } from "./auth-controls";

/**
 * Second step of sign-in: the TOTP code, or a recovery code. `mfaToken` is
 * null when the challenge arrived as a cookie (Google, password reset).
 */
export function MFAStep({
  mfaToken,
  onSuccess,
  onCancel,
}: {
  mfaToken: string | null;
  onSuccess: (sess: SessionResponse) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const verify = useVerifyMfa();
  const errorId = useId();
  const hintId = useId();
  const [code, setCode] = useState("");

  const message = ((error: unknown): string | null => {
    if (!error) return null;
    if (error instanceof ApiError) {
      if (error.code === "invalid_credentials") return t("auth.mfa.invalidCode");
      if (error.status === 429) return t("auth.tooManyAttempts");
      return apiErrorMessage(error) ?? t("common.error");
    }
    return t("auth.networkError");
  })(verify.error);

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (verify.isPending || code.trim().length < 6) return;
        verify.mutate({ mfaToken, code: code.trim() }, { onSuccess });
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
              if (verify.error) verify.reset();
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
        <AuthSubmit pending={verify.isPending} pendingLabel={t("auth.mfa.verifying")}>
          {t("auth.mfa.submit")}
        </AuthSubmit>
        <Button type="button" variant="ghost" size="lg" className={AUTH_PILL} onClick={onCancel}>
          {t("auth.mfa.back")}
        </Button>
      </div>
    </form>
  );
}
