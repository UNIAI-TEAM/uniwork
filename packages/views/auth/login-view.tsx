"use client";
import { Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import { useLogin } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { isMFAChallenge, type SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { AppLink } from "../navigation";
import { AuthShell } from "./auth-shell";
import { GoogleButton } from "./google-button";
import { MFAStep } from "./mfa-step";
import { PasswordField } from "./password-field";

/** Inline text link with the same 44px coarse-pointer floor the Button primitive carries. */
export const AUTH_LINK =
  "inline-flex items-center font-medium text-brand hover:underline pointer-coarse:min-h-11 pointer-coarse:px-1";

/** Errors the Google callback can carry back on the login URL. */
export type GoogleLoginError = "google_denied" | "google_failed" | "google_unverified";

export type LoginReason = "meeting_invite";

/**
 * Who a message belongs to decides which control is marked invalid and
 * described by it. `pair` is the server's "email or password" — it will not
 * say which, and inventing a side would leak which emails are registered.
 * `form` is the world's fault (network, server, rate limit): no field is to
 * blame, so none is marked, and a screen-reader user is not sent hunting for a
 * typo that does not exist.
 */
type Notice = { owner: "email" | "password" | "pair" | "form"; message: string };

/** Enough to catch a missing "@" or domain before the round trip; the server is the judge. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginView({
  onSuccess,
  next,
  initialError,
  reason,
  initialMfa = false,
}: {
  onSuccess: (sess: SessionResponse) => void;
  /** Same-origin path to return to after any sign-in; forwarded to Google too. */
  next?: string | null;
  initialError?: GoogleLoginError | null;
  reason?: LoginReason | null;
  /** `/login?mfa=1`: a redirect flow left the MFA challenge in a cookie; open on the code step. */
  initialMfa?: boolean;
}) {
  const { t } = useTranslation();
  const login = useLogin();
  // The challenge token from a password login; null while on the code step
  // after a cookie-borne challenge; undefined on the password step.
  const [challenge, setChallenge] = useState<string | null | undefined>(initialMfa ? null : undefined);
  const noticeId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clientNotice, setClientNotice] = useState<Notice | null>(null);
  // The Google error arrived on the URL before the user typed anything. It is
  // shown until this form is first submitted, then this form's own outcome
  // takes the slot; the old message must not come back when that one clears.
  const [submitted, setSubmitted] = useState(false);

  const reasonMessage = reason === "meeting_invite" ? t("auth.meetingInviteReason") : null;

  const serverNotice = ((error: unknown): Notice | null => {
    if (!error) return null;
    if (error instanceof ApiError) {
      if (error.code === "invalid_credentials") return { owner: "pair", message: t("auth.invalidCredentials") };
      if (error.status === 429) return { owner: "form", message: t("auth.tooManyAttempts") };
      if (error.status >= 500) return { owner: "form", message: t("auth.serverError") };
      return { owner: "form", message: apiErrorMessage(error) ?? t("common.error") };
    }
    // fetch rejects (rather than resolving with a status) only when the
    // request never got an answer: offline, DNS, a refused connection.
    return { owner: "form", message: t("auth.networkError") };
  })(login.error);

  const notice: Notice | null =
    clientNotice ??
    serverNotice ??
    (initialError && !submitted
      ? { owner: "form", message: t(`auth.google.${initialError.replace("google_", "")}`) }
      : null);

  const blames = (field: "email" | "password") => notice?.owner === field || notice?.owner === "pair";

  // A stale red message under a field the user is already correcting is noise;
  // the next submit is the next judgment.
  const edit = (field: "email" | "password", value: string) => {
    (field === "email" ? setEmail : setPassword)(value);
    setClientNotice(null);
    if (login.error) login.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // The button carries `aria-disabled`, which keeps it in the tab order and
    // therefore still able to receive an Enter key. The guard lives here so a
    // second submit is impossible however it arrives.
    if (login.isPending) return;
    setSubmitted(true);

    // What can be judged here is judged here: an empty box or an address with
    // no domain would otherwise travel to the server and come back as the
    // same sentence a wrong password gets. One message at a time, and focus
    // goes to the box it is about, so the fix starts where the eye lands.
    const trimmed = email.trim();
    const problem: Notice | null = !trimmed
      ? { owner: "email", message: t("auth.emailRequired") }
      : !EMAIL_SHAPE.test(trimmed)
        ? { owner: "email", message: t("auth.emailInvalid") }
        : !password
          ? { owner: "password", message: t("auth.passwordRequired") }
          : null;
    if (problem) {
      setClientNotice(problem);
      (problem.owner === "email" ? emailRef : passwordRef).current?.focus();
      return;
    }

    login.mutate(
      { email: trimmed, password },
      {
        onSuccess: (out) => (isMFAChallenge(out) ? setChallenge(out.mfa_token) : onSuccess(out)),
        // The email is almost always right and the password is what gets
        // retyped, so the retry starts there, with the old value selected: the
        // next keystroke replaces it. Other failures keep focus on the button:
        // the fix is "try again", not "type again".
        onError: (err) => {
          if (err instanceof ApiError && err.code === "invalid_credentials") {
            passwordRef.current?.focus();
            passwordRef.current?.select();
          }
        },
      },
    );
  };

  if (challenge !== undefined) {
    return (
      <AuthShell title={t("auth.mfa.title")} description={t("auth.mfa.subtitle")}>
        <MFAStep mfaToken={challenge} onSuccess={onSuccess} onCancel={() => setChallenge(undefined)} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.login")} description={t("auth.loginSubtitle")}>
      {/* noValidate: the browser's own bubble is untranslated and disappears on
          the next keystroke. Both fields stay `required` so assistive tech
          still announces them as such. */}
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        {reasonMessage ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-pretty text-body text-foreground">
            {reasonMessage}
          </p>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="login-email">{t("auth.email")}</FieldLabel>
            <Input
              ref={emailRef}
              id="login-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => edit("email", e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              enterKeyHint="next"
              autoFocus
              required
              aria-invalid={blames("email") || undefined}
              aria-describedby={blames("email") ? noticeId : undefined}
              className="h-10 text-body pointer-coarse:h-11"
            />
            {/* Each field owns a reserved one-line slot, so a message lands
                directly under the box it is about and nothing else moves.
                The column is vertically centred: a message appearing from
                nothing pushed the heading up and the button down at the exact
                moment the user was reaching for it. `-mt-1` puts it 4px under
                the box, tight enough to read as part of the field. Only one
                slot has content at a time; the other stays empty. */}
            <div className="-mt-1 min-h-5">
              {notice?.owner === "email" ? <FieldError id={noticeId}>{notice.message}</FieldError> : null}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="login-password">{t("auth.password")}</FieldLabel>
            <PasswordField
              ref={passwordRef}
              id="login-password"
              name="password"
              value={password}
              onChange={(v) => edit("password", v)}
              autoComplete="current-password"
              invalid={blames("password")}
              describedBy={blames("password") ? noticeId : undefined}
            />
            {/* Password, pair and form-level messages all read from here: the
                pair is "email or password", and a form-level failure (network,
                server) belongs next to the button the user just pressed. */}
            <div className="-mt-1 min-h-5">
              {notice && notice.owner !== "email" ? <FieldError id={noticeId}>{notice.message}</FieldError> : null}
            </div>
          </Field>
        </FieldGroup>

        <div className="flex flex-col gap-4">
          {/* h-10 to match the inputs above it: one column, one control height.
              Full opacity while pending: the primitive's aria-disabled:opacity-50
              is for a control that cannot be used, and this one is the status
              line for the slowest step of the flow — at 50% its label measured
              ~2:1, unreadable for exactly the seconds a 3G user stares at it.
              The spinner and the label change say "busy"; the cursor agrees. */}
          <Button
            type="submit"
            size="lg"
            className="h-10 w-full pointer-coarse:h-11 aria-disabled:cursor-progress aria-disabled:opacity-100"
            aria-disabled={login.isPending || undefined}
          >
            {login.isPending ? (
              <>
                <Loader2 aria-hidden className="animate-spin" />
                {t("auth.signingIn")}
              </>
            ) : (
              t("auth.login")
            )}
          </Button>
          {/* The alternative sign-in sits with the primary action, before the
              secondary links, so a phone user sees both ways in without
              scrolling past the help text. */}
          <GoogleButton next={next} />
          <p className="text-center text-body text-muted-foreground">
            {t("auth.noAccount")}{" "}
            <AppLink href={paths.register()} className={AUTH_LINK}>
              {t("auth.register")}
            </AppLink>
          </p>
          <p className="text-center text-body text-muted-foreground">
            <AppLink href={paths.forgotPassword()} className={AUTH_LINK}>
              {t("auth.forgotPassword")}
            </AppLink>
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
