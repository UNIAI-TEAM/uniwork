"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Info } from "lucide-react";
import { forgetLinkReset, linkResetIntent, linkResetServes, useDiscardSignInTicket, useLogin } from "@uniwork/core/auth";
import { loginRedirectErrorKey, readSignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { emailError, passwordError } from "@uniwork/core/auth/sign-in-form";
import { paths } from "@uniwork/core/paths";
import { isMFAChallenge, type SessionResponse } from "@uniwork/core/types";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { AUTH_INPUT, AUTH_LINK, AuthSubmit } from "./auth-controls";
import { AuthLegalNote } from "./auth-legal-note";
import { AuthShell } from "./auth-shell";
import { FailureSentence, identityAddress, useFailure, useProviderName, useWaitPhrase } from "./continue-parts";
import { LoginLinkBanner, usePendingLink } from "./login-link-banner";
import { MFAStep } from "./mfa-step";
import { PasswordField } from "./password-field";
import { pastLinkStep } from "./post-auth-redirect";
import { useSessionNotices } from "./session-notices";
import { focusIsUnclaimed, SocialSignIn, useFocusWhenFormIsTheOnlyWay } from "./social-sign-in";

export { AUTH_LINK };

export type LoginReason = "meeting_invite" | "session_expired";

/**
 * Who a message belongs to decides which control is marked invalid and
 * described by it. `pair` is the server's "email or password" — it will not
 * say which, and inventing a side would leak which emails are registered.
 * `form` is the world's fault (network, server, rate limit): no field is to
 * blame, so none is marked, and a screen-reader user is not sent hunting for a
 * typo that does not exist.
 */
type Notice = { owner: "email" | "password" | "pair" | "form"; message: ReactNode };

/** A document link that names a comment: an Inbox or push deep link (S15). */
const COMMENT_LINK = /^\/[^/?#]+\/[^/?#]+\/documents\/[^/?#]+\?(?:[^#]*&)?comment=[^&#]/;

export function LoginView({
  onSuccess,
  next,
  redirectError,
  reason,
  initialMfa = false,
  link = false,
  fromReset = false,
}: {
  /** `to`, when given, replaces `next`: the sign-in is no longer about linking. */
  onSuccess: (sess: SessionResponse, to?: string | null) => void;
  /** Same-origin path to return to after any sign-in; forwarded to the providers and to register too. */
  next?: string | null;
  /**
   * `/login?error=`: why a provider's round trip came back without a session
   * (spec §3.4). Read through the one table of codes; anything it does not
   * know is ignored rather than shown as a raw code.
   */
  redirectError?: string | null;
  reason?: LoginReason | null;
  /** `/login?mfa=1`: a redirect flow left the MFA challenge in a cookie; open on the code step. */
  initialMfa?: boolean;
  /**
   * `/login?link=1` (spec §4.4): a Google or Apple sign-in waits to be linked
   * to the account this one opens. Every way in keeps it (the password, the
   * other provider, the second factor) and `next` is the link step.
   */
  link?: boolean;
  /**
   * `/login?reset=1`: a reset in link mode met the account's second factor,
   * which finishes here. The account it opens links the pending sign-in
   * only if the reset was asked for it (spec §4.4), as the reset page checks
   * without a second factor.
   */
  fromReset?: boolean;
}) {
  const { t } = useTranslation();
  const login = useLogin();
  const discard = useDiscardSignInTicket();
  const announce = useSessionNotices();
  const pending = usePendingLink(link);
  const pendingProvider = useProviderName(pending?.provider);
  // The challenge token from a password login; null while on the code step
  // after a cookie-borne challenge; undefined on the password step.
  const [challenge, setChallenge] = useState<string | null | undefined>(initialMfa ? null : undefined);
  const noticeId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clientNotice, setClientNotice] = useState<Notice | null>(null);
  // The provider's error arrived on the URL before the user typed anything.
  // It is shown until this form is first submitted, then this form's own
  // outcome speaks; the old message must not come back when that one clears.
  const [submitted, setSubmitted] = useState(false);
  // "Email này đã có tài khoản UniWork": the provider's address is the
  // account's, so the box is filled and the password is what is left to
  // type. Only into an empty box, and focus moves only if it is still where
  // the page put it: a person already typing keeps their place.
  // Never Apple's hidden address, which the screen does not spell out.
  const shown = pending?.kind === "link_required" ? identityAddress(pending) : null;
  const prefill = shown?.kind === "address" ? shown.email : "";
  useEffect(() => {
    if (!prefill) return;
    setEmail((typed) => typed || prefill);
    const untouched = document.activeElement === emailRef.current && !emailRef.current?.value;
    if (untouched || focusIsUnclaimed()) passwordRef.current?.focus();
  }, [prefill]);
  useFocusWhenFormIsTheOnlyWay(emailRef, { except: pending?.provider ?? null, hold: pending === undefined });
  const redirectKey = submitted ? null : loginRedirectErrorKey(redirectError);
  // A cancel is the person's own choice, not a failure: said quietly, as a
  // status. Every other code is something that went wrong and is an alert.
  const cancelled = redirectError === "google_denied" || redirectError === "apple_denied";

  // Whatever the answer asks to be said once (a provider that waited and was
  // not linked) is said on the way to the next screen.
  const finish = (sess: SessionResponse) => {
    if (fromReset && link) {
      const intent = linkResetIntent();
      forgetLinkReset();
      // Someone else's reset left a pending sign-in in this browser: it is
      // not this account's to link. Dropped before going on, past the link step.
      if (!linkResetServes(intent, sess.user.email)) {
        announce(sess);
        void discard
          .mutateAsync()
          .catch(() => undefined)
          .then(() => onSuccess(sess, pastLinkStep(next)));
        return;
      }
    }
    announce(sess, pending?.provider);
    onSuccess(sess);
  };

  // A deep link to a comment whose session ended says why the sign-in stands in its way
  // (S15 row 5); a visitor who never had a session gets the plain sign-in.
  const reasonMessage =
    reason === "meeting_invite"
      ? t("auth.meetingInviteReason")
      : reason === "session_expired" && next && COMMENT_LINK.test(next)
        ? t("documents.collab.inboxSessionExpired")
        : null;

  // The server's answer reads through core's table, as on the phone: a wrong
  // pair blames both boxes; anything else (offline, the server, a budget
  // spent) is the form's. A 429 says how long, counts it down, and holds the
  // button until it is over: pressing again would only spend the wait.
  const failure = useFailure(login.error, "sign_in");
  const wait = failure?.kind === "wait" ? failure : null;
  const phrase = useWaitPhrase(wait, login.reset);
  const serverNotice: Notice | null = failure
    ? { owner: failure.kind === "field" ? "pair" : "form", message: <FailureSentence failure={failure} phrase={phrase} /> }
    : null;

  const notice: Notice | null = clientNotice ?? serverNotice;

  const blames = (field: "email" | "password") => notice?.owner === field || notice?.owner === "pair";

  // A stale red message under a field the user is already correcting is noise;
  // the next submit is the next judgment.
  const edit = (field: "email" | "password", value: string) => {
    (field === "email" ? setEmail : setPassword)(value);
    setClientNotice(null);
    // A wait stays said until it is over; anything else clears on the next keystroke.
    if (login.error && !wait) login.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // The button carries `aria-disabled`, which keeps it in the tab order and
    // therefore still able to receive an Enter key. The guard lives here so a
    // second submit is impossible however it arrives.
    if (login.isPending || wait) return;
    setSubmitted(true);

    // What can be judged here is judged here: an empty box or an address with
    // no domain would otherwise travel to the server and come back as the
    // same sentence a wrong password gets. One message at a time, and focus
    // goes to the box it is about, so the fix starts where the eye lands.
    // The rules are core's, the phone's too (sign-in-form).
    const trimmed = email.trim();
    const slip = emailError(email);
    const missing = passwordError(password);
    const problem: Notice | null = slip
      ? { owner: "email", message: t(slip.key) }
      : missing
        ? { owner: "password", message: t(missing.key) }
        : null;
    if (problem) {
      setClientNotice(problem);
      (problem.owner === "email" ? emailRef : passwordRef).current?.focus();
      return;
    }

    login.mutate(
      // In link mode the ticket stays for the link step even when it was
      // still loading: keeping one that is gone costs nothing.
      { email: trimmed, password, keepSignInTicket: link },
      {
        onSuccess: (out) => (isMFAChallenge(out) ? setChallenge(out.mfa_token) : finish(out)),
        // The email is almost always right and the password is what gets
        // retyped, so the retry starts there, with the old value selected: the
        // next keystroke replaces it. Other failures keep focus on the button:
        // the fix is "try again", not "type again".
        onError: (err) => {
          if (readSignInFailure(err, "sign_in").kind === "field") {
            passwordRef.current?.focus();
            passwordRef.current?.select();
          }
        },
      },
    );
  };

  if (challenge !== undefined) {
    // Linking: the code is for the account the provider joins. The address
    // is known when it was typed here; a challenge from a cookie (a reset)
    // names the provider only.
    const typed = email.trim();
    const subtitle = !pending
      ? t("auth.mfa.subtitle")
      : typed
        ? t("auth.continue.loginMode.mfaSubtitle", { email: typed, provider: pendingProvider })
        : t("auth.continue.loginMode.bannerRelay", { provider: pendingProvider });
    return (
      <AuthShell title={t("auth.mfa.title")} description={subtitle}>
        <MFAStep
          mfaToken={challenge}
          keepSignInTicket={link}
          onSuccess={finish}
          onCancel={() => setChallenge(undefined)}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.login")} description={t("auth.loginSubtitle")}>
      <div className="flex flex-col gap-5">
        {reasonMessage ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-pretty text-body text-foreground">
            {reasonMessage}
          </p>
        ) : null}
        {/* Above the provider buttons it is about, and blaming no field:
            no field was used. A cancel is news, not a failure, but it keeps a
            glyph: a bare muted band the width of the inputs read as a
            read-only field. */}
        {redirectKey ? (
          <Alert variant={cancelled ? "muted" : "destructiveSoft"} role={cancelled ? "status" : "alert"}>
            {cancelled ? <Info aria-hidden /> : <CircleAlert aria-hidden />}
            <AlertDescription className="text-pretty">{t(redirectKey)}</AlertDescription>
          </Alert>
        ) : null}
        {link ? <LoginLinkBanner ticket={pending} next={next ?? null} /> : null}
        {/* The providers first, then "or use email", then the form: the order
            the phone shows (spec §4.1). Linking, the pending provider's own
            button would only start the same sign-in again. */}
        <SocialSignIn next={next} except={pending?.provider ?? null} hold={pending === undefined} />
        {/* noValidate: the browser's own bubble is untranslated and disappears on
            the next keystroke. Both fields stay `required` so assistive tech
            still announces them as such. */}
        <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
          {/* gap-1 between fields and gap-2 inside one: the reserved error slot
              under each box already carries the air between them. With the
              primitive's gap-5 on top of it the two boxes stood 50px apart and
              read as two forms. */}
          <FieldGroup className="gap-1">
            <Field className="gap-2">
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
                required
                aria-invalid={blames("email") || undefined}
                aria-describedby={blames("email") ? noticeId : undefined}
                className={AUTH_INPUT}
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
            {/* The recovery link sits on the label row, where the eye already is
                when a password will not come, but it comes AFTER the box in the
                DOM: in the tab order and to a screen reader it follows the
                password and its reveal toggle instead of standing between the
                two fields a keyboard user is moving through. The grid puts it
                back on the label row visually. */}
            <Field className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2">
              <FieldLabel htmlFor="login-password" className="col-start-1 row-start-1">
                {t("auth.password")}
              </FieldLabel>
              <div className="col-span-2 row-start-2">
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
              </div>
              {/* Password, pair and form-level messages all read from here: the
                  pair is "email or password", and a form-level failure (network,
                  server) belongs next to the button the user just pressed. */}
              <div className="col-span-2 row-start-3 -mt-1 min-h-5">
                {notice && notice.owner !== "email" ? <FieldError id={noticeId}>{notice.message}</FieldError> : null}
              </div>
              <AppLink
                href={paths.forgotPassword({ next })}
                className={cn(AUTH_LINK, "col-start-2 row-start-1 justify-self-end text-label")}
              >
                {t("auth.forgotPassword")}
              </AppLink>
            </Field>
          </FieldGroup>

          <div className="flex flex-col gap-3">
            <AuthSubmit
              pending={login.isPending}
              pendingLabel={t("auth.signingIn")}
              aria-disabled={wait ? true : undefined}
              aria-describedby={wait ? noticeId : undefined}
            >
              {t("auth.login")}
            </AuthSubmit>
            <p className="text-center text-body text-muted-foreground">
              {t("auth.noAccount")}{" "}
              {/* Switching to register keeps where the person was headed (an
                  invitation, the desktop app's consent). */}
              {/* Registering drops a pending sign-in, so it goes on to where the
                  link step would have. */}
              <AppLink href={paths.register({ next: link ? pastLinkStep(next) : next })} className={AUTH_LINK}>
                {t("auth.register")}
              </AppLink>
            </p>
            <AuthLegalNote action="signIn" />
          </div>
        </form>
      </div>
    </AuthShell>
  );
}
