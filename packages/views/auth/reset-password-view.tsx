"use client";
import { Link2Off } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import {
  forgetLinkReset,
  linkResetIntent,
  linkResetServes,
  useDiscardSignInTicket,
  useResetPassword,
  useSignInTicket,
} from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { isMFAChallenge, type SessionResponse } from "@uniwork/core/types";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink, useNavigation } from "../navigation";
import { AUTH_PILL, AuthSubmit } from "./auth-controls";
import { AuthShell } from "./auth-shell";
import { AUTH_LINK } from "./login-view";
import { PasswordField } from "./password-field";
import { useSessionNotices } from "./session-notices";

/** Mirrors `validatePassword` on the server; the server still decides. */
const MIN = 8;

type ClientError = "tooShort" | "mismatch" | null;

/**
 * The mailed reset link (it carries no `next`). An account with no password
 * yet (it signs in with Google or Apple) is mailed the link with `set`: the
 * page then says "Đặt mật khẩu", as the mail did, and never asks to change a
 * password the account never had (spec §3.7). When the person came here
 * from "Quên mật khẩu?" on /login?link=1 (spec §4.4) and a Google or Apple
 * sign-in still waits, the reset keeps it and the new session goes to the
 * link step: `onSuccess` gets that step as its `next`. Only then: any other
 * pending sign-in in this browser may be someone else's, and a reset that
 * opens another address than the one asked for drops it instead.
 */
export function ResetPasswordView({
  token,
  first = false,
  onSuccess,
}: {
  token: string;
  /** `?set=1`: the account has no password yet, so this sets its first one. */
  first?: boolean;
  onSuccess: (sess: SessionResponse, next: string | null) => void;
}) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const reset = useResetPassword();
  const announce = useSessionNotices();
  const discard = useDiscardSignInTicket();
  // Read once: the intent is what this browser asked for before the mail.
  const [intent] = useState(linkResetIntent);
  const pending = useSignInTicket({ enabled: intent !== null });
  // Never kept blind: a press while the read is on its way waits for it.
  const reading = intent !== null && pending.isPending;
  const keepSignInTicket = intent !== null && pending.data != null;
  const linkStep = keepSignInTicket ? paths.authContinue({ step: "link" }) : null;
  const [queued, setQueued] = useState(false);
  const errorId = useId();
  const hintId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [clientError, setClientError] = useState<ClientError>(null);
  const invalidToken = reset.error instanceof ApiError && reset.error.code === "invalid_token";
  const errorMsg = clientError
    ? t(`auth.reset.${clientError}`, { min: MIN })
    : reset.error
      ? (apiErrorMessage(reset.error) ?? t("common.error"))
      : null;
  // The message sits under the field that owns it: the first for length, the
  // second for the pair. A server error belongs to neither and marks both.
  const owner: "password" | "confirm" | "form" | null =
    clientError === "tooShort" ? "password" : clientError === "mismatch" ? "confirm" : reset.error ? "form" : null;
  const passwordInvalid = owner === "password" || owner === "form";
  const confirmInvalid = owner === "confirm" || owner === "form";

  const send = () => {
    reset.mutate(
      { token, password, keepSignInTicket },
      {
        // MFA on: the challenge is in the cookie; the login page finishes
        // it, still linking when a link waits, and only into the account
        // this reset was asked for (`reset`), which it checks once the code
        // says who that is.
        onSuccess: (out) => {
          if (isMFAChallenge(out)) {
            // Nothing waits to be linked: the intent has served its purpose.
            if (linkStep === null) forgetLinkReset();
            push(paths.login({ mfa: true, link: linkStep !== null, reset: linkStep !== null, next: linkStep }));
            return;
          }
          forgetLinkReset();
          // Another address than the one the reset was asked for: its
          // pending sign-in is not this person's to link.
          void (linkStep === null ? Promise.resolve(false) : linkResetServes(intent, out.user.email))
            .catch(() => false)
            .then((linking) => {
              if (linkStep !== null && !linking) discard.mutate();
              // "Đã lấy lại tài khoản": a link on an address never proved takes it back.
              announce(out, linking ? pending.data?.provider : undefined);
              onSuccess(out, linking ? linkStep : null);
            });
        },
      },
    );
  };

  useEffect(() => {
    if (!queued || reading) return;
    setQueued(false);
    send();
    // `send` reads this render's values; the read settling is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, reading]);

  if (invalidToken) {
    return (
      <AuthShell title={t("auth.reset.invalidTitle")} description={t("auth.reset.invalidToken")}>
        <div className="flex flex-col gap-6">
          <p className="flex items-start gap-3 text-body text-muted-foreground">
            <Link2Off aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t("auth.reset.invalidHint")}
          </p>
          <div className="flex flex-col gap-4">
            {/* A link dressed as the primary button: it navigates, so it stays
                an <a> for assistive tech instead of a Button with role swapped. */}
            <AppLink href={paths.forgotPassword()} className={cn(buttonVariants({ size: "lg" }), AUTH_PILL)}>
              {t("auth.reset.requestNew")}
            </AppLink>
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

  const words = first ? "auth.reset.set" : "auth.reset";
  return (
    <AuthShell title={t(`${words}.title`)} description={t(`${words}.subtitle`)}>
      {/* noValidate: the browser's own bubble is untranslated; the fields stay
          `required`/`minLength` so assistive tech still announces them. */}
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (reset.isPending || queued) return;
          // The message is announced by the alert; focus follows it to the
          // field that owns it so the fix is one keystroke away.
          if (password.length < MIN) {
            setClientError("tooShort");
            passwordRef.current?.focus();
            return;
          }
          if (password !== confirm) {
            setClientError("mismatch");
            confirmRef.current?.focus();
            return;
          }
          setClientError(null);
          if (reading) setQueued(true);
          else send();
        }}
      >
        <FieldGroup className="gap-4">
          <Field className="gap-2" data-invalid={passwordInvalid || undefined}>
            <FieldLabel htmlFor="reset-password">{t("auth.reset.newPassword")}</FieldLabel>
            <PasswordField
              ref={passwordRef}
              id="reset-password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                if (clientError) setClientError(null);
              }}
              autoComplete="new-password"
              minLength={MIN}
              autoFocus
              invalid={passwordInvalid}
              describedBy={owner === "password" ? errorId : owner === "form" ? `${errorId} ${hintId}` : hintId}
            />
            {/* The length error says what the hint says; show one, not both. */}
            {owner === "password" ? (
              <FieldError id={errorId}>{errorMsg}</FieldError>
            ) : (
              <FieldDescription id={hintId} className="text-label">
                {t("auth.reset.hint", { min: MIN })}
              </FieldDescription>
            )}
          </Field>
          <Field className="gap-2" data-invalid={confirmInvalid || undefined}>
            <FieldLabel htmlFor="reset-confirm">{t("auth.reset.confirmPassword")}</FieldLabel>
            <PasswordField
              ref={confirmRef}
              id="reset-confirm"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                if (clientError) setClientError(null);
              }}
              autoComplete="new-password"
              minLength={MIN}
              invalid={confirmInvalid}
              describedBy={confirmInvalid ? errorId : undefined}
            />
            {owner === "confirm" ? <FieldError id={errorId}>{errorMsg}</FieldError> : null}
          </Field>
          {owner === "form" ? <FieldError id={errorId}>{errorMsg}</FieldError> : null}
        </FieldGroup>
        <AuthSubmit pending={reset.isPending || queued} pendingLabel={t(`${words}.submitting`)}>
          {t(`${words}.submit`)}
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
