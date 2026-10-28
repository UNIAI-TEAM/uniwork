"use client";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MailCheck } from "lucide-react";
import { useSendSignInEmailClaim, useVerifySignInEmailClaim } from "@uniwork/core/auth";
import { readSignInFailure, sentenceValues } from "@uniwork/core/auth/sign-in-errors";
import { isMFAChallenge, type SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@uniwork/ui/components/ui/input-otp";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { AUTH_INPUT, AUTH_PILL, AuthSubmit } from "./auth-controls";
import { AuthShell } from "./auth-shell";
import { FailureNotice, useFailure, useSecondsLeft, useWaitPhrase } from "./continue-parts";

const CODE_LENGTH = 6;
/** The server's resend gap for one pending sign-in (spec §3.2); a 429 names the true wait. */
const RESEND_SECONDS = 60;
/** Enough to catch a missing "@" or domain before the round trip; the server is the judge. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the code step hands back: a session, or the second factor the account still asks for. */
export type ClaimOutcome = { session: SessionResponse } | { mfaToken: string; email: string };

/**
 * "Tôi được mời bằng email khác" (spec §3.2, §4.3): the work address the
 * organization invited, then the six digits mailed to it. The code links
 * the provider into that address's account, takes back one that never
 * proved it, or creates one with it. Nothing on either step says whether the
 * address has an account.
 */
export function ClaimFlow({
  onBack,
  onOutcome,
  onExpired,
}: {
  onBack: () => void;
  onOutcome: (out: ClaimOutcome) => void;
  /** The pending sign-in is gone (expired, used in another tab). */
  onExpired: () => void;
}) {
  // The address a code went to; the email step keeps what was typed when
  // the person goes back to change it.
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  if (sentTo === null) {
    return (
      <ClaimEmailStep
        email={email}
        onEmail={setEmail}
        onBack={onBack}
        onExpired={onExpired}
        onSent={(to) => {
          setSentTo(to);
          setResendAt(Date.now() + RESEND_SECONDS * 1000);
        }}
      />
    );
  }
  return (
    <ClaimCodeStep
      email={sentTo}
      resendAt={resendAt}
      onResendAt={setResendAt}
      onChangeEmail={() => setSentTo(null)}
      onExpired={onExpired}
      onOutcome={onOutcome}
    />
  );
}

function ClaimEmailStep({
  email,
  onEmail,
  onBack,
  onSent,
  onExpired,
}: {
  email: string;
  onEmail: (value: string) => void;
  onBack: () => void;
  onSent: (email: string) => void;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  const send = useSendSignInEmailClaim();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [clientError, setClientError] = useState<string | null>(null);
  const failure = useFailure(send.error, "claim");
  const phrase = useWaitPhrase(failure, send.reset);
  const fieldError = clientError ?? (failure?.kind === "field" ? t(failure.key, sentenceValues(failure, t)) : null);
  const waiting = failure?.kind === "wait";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // aria-disabled keeps the button reachable (and Enter still submits), so the guard is here.
    if (send.isPending || waiting) return;
    const trimmed = email.trim();
    const problem = !trimmed ? t("auth.emailRequired") : EMAIL_SHAPE.test(trimmed) ? null : t("auth.emailInvalid");
    if (problem) {
      setClientError(problem);
      inputRef.current?.focus();
      return;
    }
    send.mutate(trimmed, {
      // "sent" whoever owns the address; an answer that drifted still most
      // likely mailed one, and the next step can always send another.
      onSuccess: () => onSent(trimmed),
      onError: (err) => {
        if (readSignInFailure(err, "claim").kind === "restart") onExpired();
        else inputRef.current?.focus();
      },
    });
  };

  return (
    <AuthShell title={t("auth.continue.claim.emailTitle")} description={t("auth.continue.claim.emailBody")}>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <FieldGroup className="gap-1">
          <Field className="gap-2" data-invalid={fieldError ? true : undefined}>
            <FieldLabel htmlFor="claim-email">{t("auth.continue.claim.emailLabel")}</FieldLabel>
            <Input
              ref={inputRef}
              id="claim-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => {
                onEmail(e.target.value);
                setClientError(null);
                if (send.error && failure?.kind !== "wait") send.reset();
              }}
              placeholder={t("auth.continue.claim.emailPlaceholder")}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              enterKeyHint="send"
              autoFocus
              required
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
              className={AUTH_INPUT}
            />
            {/* A reserved one-line slot: the message lands under the box it is
                about and nothing below it moves. */}
            <div className="-mt-1 min-h-5">{fieldError ? <FieldError id={errorId}>{fieldError}</FieldError> : null}</div>
          </Field>
        </FieldGroup>
        {failure && failure.kind !== "field" ? <FailureNotice failure={failure} phrase={phrase} /> : null}
        <div className="flex flex-col gap-3">
          <AuthSubmit
            pending={send.isPending}
            pendingLabel={t("auth.continue.claim.sending")}
            aria-busy={send.isPending || undefined}
            aria-disabled={waiting || undefined}
          >
            {t("auth.continue.claim.send")}
          </AuthSubmit>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className={AUTH_PILL}
            aria-disabled={send.isPending || undefined}
            onClick={() => {
              if (!send.isPending) onBack();
            }}
          >
            {t("common.back")}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

function ClaimCodeStep({
  email,
  resendAt,
  onResendAt,
  onChangeEmail,
  onExpired,
  onOutcome,
}: {
  email: string;
  resendAt: number | null;
  onResendAt: (at: number) => void;
  onChangeEmail: () => void;
  onExpired: () => void;
  onOutcome: (out: ClaimOutcome) => void;
}) {
  const { t } = useTranslation();
  const verify = useVerifySignInEmailClaim();
  const resend = useSendSignInEmailClaim();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const cooldown = useSecondsLeft(resendAt);
  const verifyFailure = useFailure(verify.error, "claim");
  const resendFailure = useFailure(resend.error, "claim");
  const verifyPhrase = useWaitPhrase(verifyFailure, verify.reset);
  const resendPhrase = useWaitPhrase(resendFailure, resend.reset);
  const fieldError = verifyFailure?.kind === "field" ? t(verifyFailure.key, sentenceValues(verifyFailure, t)) : null;
  // The address's guesses are spent: the boxes hold still until the wait is over.
  const locked = verifyFailure?.kind === "wait";
  const notice = verifyFailure && verifyFailure.kind !== "field" ? verifyFailure : resendFailure;
  const noticePhrase = notice === verifyFailure ? verifyPhrase : resendPhrase;

  // The pending sign-in went away (expired, or used in another tab): the
  // whole screen says so, not this step.
  const expiredOr = (err: unknown, otherwise: (waitSeconds: number | null) => void) => {
    const read = readSignInFailure(err, "claim");
    if (read.kind === "restart") onExpired();
    else otherwise(read.retryAfterSeconds);
  };

  const onChange = (value: string) => {
    setCode(value);
    if (verify.error && !locked) verify.reset();
    if (value.length !== CODE_LENGTH || verify.isPending || locked) return;
    verify.mutate(
      { email, code: value },
      {
        onSuccess: (out) => onOutcome(isMFAChallenge(out) ? { mfaToken: out.mfa_token, email } : { session: out }),
        // A wrong code is cleared, so the next attempt starts from the first box.
        onError: (err) => expiredOr(err, () => setCode("")),
      },
    );
  };

  const onResend = () => {
    if (cooldown > 0 || resend.isPending) return;
    setResent(false);
    resend.mutate(email, {
      onSuccess: () => {
        setResent(true);
        onResendAt(Date.now() + RESEND_SECONDS * 1000);
      },
      // The server's own wait replaces the 60 s guess.
      onError: (err) =>
        expiredOr(err, (wait) => {
          if (wait !== null) onResendAt(Date.now() + wait * 1000);
        }),
    });
  };

  return (
    <AuthShell title={t("auth.continue.claim.codeTitle")} description={t("auth.continue.claim.codeBody", { email })}>
      <div className="flex flex-col gap-6">
        <FieldGroup className="gap-2">
          <Field data-invalid={fieldError ? true : undefined}>
            <FieldLabel htmlFor="claim-code">{t("auth.continue.claim.codeLabel")}</FieldLabel>
            <InputOTP
              id="claim-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={onChange}
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
              // readOnly, not disabled: the boxes keep focus and their tab
              // stop while the code is checked or the wait runs.
              readOnly={verify.isPending || locked}
              aria-busy={verify.isPending || undefined}
            >
              <InputOTPGroup>
                {Array.from({ length: CODE_LENGTH }, (_, i) => (
                  <InputOTPSlot key={i} index={i} className="size-11 text-title" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </Field>
          {/* One reserved line under the boxes: the wrong code, the check
              running, or the new code on its way. */}
          <div className="min-h-5">
            {fieldError ? (
              <FieldError id={errorId}>{fieldError}</FieldError>
            ) : verify.isPending ? (
              <p role="status" className="flex items-center gap-2 text-label text-muted-foreground">
                <Spinner className="size-3.5" />
                {t("auth.continue.claim.verifying")}
              </p>
            ) : resent && !notice ? (
              <p role="status" className="flex items-center gap-2 text-label text-muted-foreground">
                <MailCheck aria-hidden className="size-3.5 text-brand" />
                {t("auth.continue.claim.resent", { email })}
              </p>
            ) : null}
          </div>
        </FieldGroup>
        {notice ? <FailureNotice failure={notice} phrase={noticePhrase} /> : null}
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={AUTH_PILL}
            onClick={onResend}
            aria-busy={resend.isPending || undefined}
            aria-disabled={cooldown > 0 || resend.isPending || undefined}
          >
            {resend.isPending ? (
              <>
                <Spinner />
                {t("auth.continue.claim.sending")}
              </>
            ) : cooldown > 0 ? (
              t("auth.continue.claim.resendIn", { count: cooldown })
            ) : (
              t("auth.continue.claim.resend")
            )}
          </Button>
          <p className="text-center text-caption text-muted-foreground">{t("auth.continue.claim.spamHint")}</p>
          {/* Button primitive for the 44px coarse-pointer floor, drawn as the
              credential screens' inline link. */}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto self-center px-1 text-label text-brand"
            aria-disabled={verify.isPending || undefined}
            onClick={() => {
              if (!verify.isPending) onChangeEmail();
            }}
          >
            {t("auth.continue.claim.changeEmail")}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
