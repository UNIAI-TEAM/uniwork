"use client";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import type { SignInTicket } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useCreateFromSignInTicket, useDiscardSignInTicket, useLogout } from "@uniwork/core/auth";
import { readSignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { paths } from "@uniwork/core/paths";
import { isMFAChallenge, type MFAChallenge, type SessionResponse, type User } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { AppLink, useNavigation } from "../navigation";
import { AUTH_INPUT, AUTH_PILL, AuthSubmit } from "./auth-controls";
import { AuthLegalNote } from "./auth-legal-note";
import { AuthShell } from "./auth-shell";
import { ClaimFlow, type ClaimOutcome } from "./continue-claim";
import {
  ChoiceRow,
  FailureNotice,
  IdentityBlock,
  PILL_LINK,
  useFailure,
  identityAddress,
  useProviderName,
  useWaitPhrase,
} from "./continue-parts";
import { MFAStep } from "./mfa-step";
import { useSessionNotices } from "./session-notices";
import { providerStartUrl } from "./social-sign-in";

/** The server's cap on a display name (maxDisplayNameRunes), counted in characters as it counts them. */
const NAME_MAX = 100;

type Step = { at: "choices" } | { at: "name" } | { at: "claim" } | { at: "mfa"; token: string; email: string | null };

/**
 * The choice screen's three ways on (spec §4.3), or its one when the address
 * already has an account, or — when this browser is already signed in —
 * linking to that account or starting over as someone else. Each way that
 * opens a session hands it to `onDone`; the screen then has nothing left to
 * say, and the page goes on to `next`.
 */
export function ContinueChoices({
  ticket,
  next,
  user,
  onDone,
  onLeaving,
  onExpired,
}: {
  ticket: SignInTicket;
  next: string | null;
  /** The account this browser is signed in to, when it is. */
  user: User | null;
  onDone: (user: User) => void;
  /** The browser is about to leave for the provider: nothing here may change under it. */
  onLeaving: () => void;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const [step, setStep] = useState<Step>({ at: "choices" });
  const announce = useSessionNotices();
  const provider = useProviderName(ticket.provider);

  const opened = (sess: SessionResponse) => {
    announce(sess, ticket.provider);
    onDone(sess.user);
  };

  if (step.at === "mfa") {
    // The claim's address is the account the code is for; a create that met
    // an account with a second factor (made in another tab) names none.
    return (
      <AuthShell
        title={t("auth.mfa.title")}
        description={
          step.email
            ? t("auth.continue.loginMode.mfaSubtitle", { email: step.email, provider })
            : t("auth.mfa.subtitle")
        }
      >
        {/* The pending sign-in was spent on the step before; back is the sign-in page. */}
        <MFAStep mfaToken={step.token} onSuccess={opened} onCancel={() => push(paths.login({ next }))} />
      </AuthShell>
    );
  }
  if (step.at === "claim") {
    return (
      <ClaimFlow
        onBack={() => setStep({ at: "choices" })}
        onExpired={onExpired}
        onOutcome={(out: ClaimOutcome) =>
          "session" in out ? opened(out.session) : setStep({ at: "mfa", token: out.mfaToken, email: out.email })
        }
      />
    );
  }
  return (
    <ChoicesScreen
      ticket={ticket}
      next={next}
      user={user}
      naming={step.at === "name"}
      onStep={setStep}
      onOpened={(out) => (isMFAChallenge(out) ? setStep({ at: "mfa", token: out.mfa_token, email: null }) : opened(out))}
      onDone={onDone}
      onLeaving={onLeaving}
      onExpired={onExpired}
    />
  );
}

function ChoicesScreen({
  ticket,
  next,
  user,
  naming,
  onStep,
  onOpened,
  onDone,
  onLeaving,
  onExpired,
}: {
  ticket: SignInTicket;
  next: string | null;
  user: User | null;
  naming: boolean;
  onStep: (step: Step) => void;
  onOpened: (out: SessionResponse | MFAChallenge) => void;
  onDone: (user: User) => void;
  onLeaving: () => void;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  const { push, openExternal } = useNavigation();
  const create = useCreateFromSignInTicket();
  const discard = useDiscardSignInTicket();
  const logout = useLogout();
  const provider = useProviderName(ticket.provider);
  // The provider's own address, when it may be spelled out (not Apple's hidden one).
  const shown = identityAddress(ticket);
  const address = shown.kind === "address" ? shown.email : null;
  const failure = useFailure(create.error, "ticket");
  const phrase = useWaitPhrase(failure, create.reset);
  const relay = shown.kind === "relay";
  // The address took an account since the ticket was issued (another tab, a
  // colleague's invite): "Tạo tài khoản mới" can only meet the same answer,
  // so the screen becomes the one the address would have had from the
  // start, with its one way on. Its new title takes focus and is heard.
  const conflicted = failure?.code === "sign_in_account_conflict";
  // "Tôi đã có tài khoản UniWork": sign in once, in link mode, and come
  // back to the link step, which goes on to `next`.
  const signInToLink = paths.login({ link: true, next: paths.authContinue({ step: "link", next }) });
  const busy = create.isPending || discard.isPending || logout.isPending;
  const held = (pressed: boolean) => ({ busy: pressed, disabled: busy && !pressed });

  const runCreate = (displayName?: string) => {
    if (busy) return;
    create.mutate(
      { displayName },
      {
        onSuccess: onOpened,
        onError: (err) => {
          if (readSignInFailure(err, "ticket").kind === "restart") onExpired();
        },
      },
    );
  };

  const cancel = () => {
    if (busy) return;
    // Signed in, there is nothing to sign in to: on to where the person was going.
    discard.mutate(undefined, { onSettled: () => (user ? onDone(user) : push(paths.login({ next }))) });
  };

  // "Dùng tài khoản khác": signing out drops the pending sign-in with the
  // session (spec §3.2), so the provider is asked again and the choice
  // screen comes back, signed out, with a fresh one.
  const otherAccount = async () => {
    if (busy) return;
    onLeaving();
    try {
      await logout.mutateAsync();
    } catch {
      /* the server's session may be gone already; the provider asks again either way */
    }
    const restart = providerStartUrl(ticket.provider, { next });
    if (openExternal) openExternal(restart);
    else push(paths.login({ next }));
  };

  const notice = failure && !conflicted && failure.kind !== "restart" && failure.kind !== "field" ? (
    <FailureNotice failure={failure} phrase={phrase}>
      {failure.kind === "form" && (failure.code === "network" || (failure.status ?? 0) >= 500) ? (
        <Button type="button" variant="outline" onClick={() => runCreate(create.variables?.displayName)}>
          <RefreshCw aria-hidden />
          {t("common.retry")}
        </Button>
      ) : null}
    </FailureNotice>
  ) : null;

  if (naming && !conflicted) {
    return (
      <CreateNameStep
        body={address ? t("auth.continue.create.body", { email: address }) : t("auth.continue.create.bodyRelay")}
        pending={create.isPending}
        notice={notice}
        onBack={() => {
          create.reset();
          onStep({ at: "choices" });
        }}
        onSubmit={runCreate}
      />
    );
  }

  const cancelButton = (
    // Button primitive for the 44px coarse-pointer floor, drawn as the
    // credential screens' inline link.
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto self-center px-1 text-label text-muted-foreground hover:text-foreground"
      aria-disabled={(busy && !discard.isPending) || undefined}
      aria-busy={discard.isPending || undefined}
      onClick={cancel}
    >
      {discard.isPending ? t("auth.continue.cancelling") : t("auth.continue.cancel")}
    </Button>
  );

  if (user) {
    const account = user.email || user.display_name;
    return (
      <AuthShell title={t("auth.continue.title", { provider })} description={t("auth.continue.description", { provider })}>
        <div className="flex flex-col gap-6">
          <IdentityBlock identity={ticket} />
          <ul aria-label={t("auth.continue.choicesLabel")} className="flex flex-col gap-3">
            <li>
              <ChoiceRow
                title={t("auth.continue.signedIn.linkTo", { provider, account })}
                body={t("auth.continue.signedIn.linkToBody", { provider })}
                href={paths.authContinue({ step: "link", next })}
                {...held(false)}
              />
            </li>
            <li>
              <ChoiceRow
                title={t("auth.continue.signedIn.otherAccount")}
                body={t("auth.continue.signedIn.otherAccountBody", { account })}
                onPress={() => void otherAccount()}
                {...held(logout.isPending)}
              />
            </li>
          </ul>
          {cancelButton}
        </div>
      </AuthShell>
    );
  }

  if (ticket.kind === "link_required" || conflicted) {
    return (
      <AuthShell
        title={t("auth.continue.linkRequired.title")}
        // From the rows this shell only retitles; from the name step it is a
        // fresh mount whose pressed button went with the form, so a conflict
        // has the heading take focus on arrival.
        announce={conflicted}
        description={
          address
            ? t("auth.continue.linkRequired.body", { provider, email: address })
            : t("auth.continue.linkRequired.bodyRelay", { provider })
        }
      >
        <div className="flex flex-col gap-6">
          <IdentityBlock identity={ticket} />
          <div className="flex flex-col gap-3">
            <AppLink
              href={signInToLink}
              className={PILL_LINK}
              aria-disabled={busy || undefined}
              onClick={(e) => {
                if (busy) e.preventDefault();
              }}
            >
              {t("auth.continue.linkRequired.action")}
            </AppLink>
            {cancelButton}
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.continue.title", { provider })} description={t("auth.continue.description", { provider })}>
      <div className="flex flex-col gap-6">
        <IdentityBlock identity={ticket} />
        {notice}
        <div className="flex flex-col gap-3">
          {relay ? <p className="text-pretty text-caption text-muted-foreground">{t("auth.continue.relayHint")}</p> : null}
          <ul aria-label={t("auth.continue.choicesLabel")} className="flex flex-col gap-3">
            <li>
              <ChoiceRow
                title={t("auth.continue.existing.title")}
                body={t("auth.continue.existing.body", { provider })}
                href={signInToLink}
                {...held(false)}
              />
            </li>
            <li>
              <ChoiceRow
                title={t("auth.continue.invited.title")}
                body={t("auth.continue.invited.body")}
                onPress={() => onStep({ at: "claim" })}
                {...held(false)}
              />
            </li>
            <li>
              <ChoiceRow
                title={t("auth.continue.create.title")}
                body={address ? t("auth.continue.create.body", { email: address }) : t("auth.continue.create.bodyRelay")}
                // No name from the provider: ask for one first. With one, the
                // press creates the account.
                onPress={() => (ticket.name.trim() ? runCreate(undefined) : onStep({ at: "name" }))}
                busy={create.isPending}
                busyBody={t("auth.continue.create.submitting")}
                disabled={(busy && !create.isPending) || failure?.kind === "wait"}
              />
            </li>
          </ul>
          {/* aria-busy alone is seldom read: the create in place is said here, politely. */}
          <p role="status" className="sr-only">
            {create.isPending ? t("auth.continue.create.submitting") : ""}
          </p>
          <AuthLegalNote action="signUp" />
        </div>
        {cancelButton}
      </div>
    </AuthShell>
  );
}

/**
 * "Tạo tài khoản mới" when the provider shared no name: the one field the
 * new account needs, judged here the way the server judges it (spaces
 * folded, at most 100 characters) so the round trip is only for the create.
 */
function CreateNameStep({
  body,
  pending,
  notice,
  onBack,
  onSubmit,
}: {
  /** "Dùng {{email}} để đăng nhập UniWork": which address the account takes. */
  body: string;
  pending: boolean;
  notice: React.ReactNode;
  onBack: () => void;
  onSubmit: (displayName: string) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const hintId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const folded = name.trim().split(/\s+/).filter(Boolean).join(" ");
    const problem = !folded
      ? t("auth.continue.create.displayNameRequired")
      : [...folded].length > NAME_MAX
        ? t("auth.continue.create.displayNameTooLong", { max: NAME_MAX })
        : null;
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    onSubmit(folded);
  };

  return (
    <AuthShell title={t("auth.continue.create.title")} description={body}>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <FieldGroup className="gap-1">
          <Field className="gap-2" data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="continue-display-name">{t("auth.continue.create.displayNameLabel")}</FieldLabel>
            <Input
              ref={inputRef}
              id="continue-display-name"
              name="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              autoComplete="name"
              enterKeyHint="done"
              autoFocus
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : hintId}
              className={AUTH_INPUT}
            />
            <div className="-mt-1 min-h-5">
              {/* One line under the box: the hint, or what is wrong with it. */}
              {error ? (
                <FieldError id={errorId}>{error}</FieldError>
              ) : (
                <FieldDescription id={hintId} className="text-label">
                  {t("auth.continue.create.displayNameHint")}
                </FieldDescription>
              )}
            </div>
          </Field>
        </FieldGroup>
        {notice}
        <div className="flex flex-col gap-3">
          <AuthSubmit pending={pending} pendingLabel={t("auth.continue.create.submitting")} aria-busy={pending || undefined}>
            {t("auth.continue.create.submit")}
          </AuthSubmit>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className={AUTH_PILL}
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onBack();
            }}
          >
            {t("common.back")}
          </Button>
          <AuthLegalNote action="signUp" />
        </div>
      </form>
    </AuthShell>
  );
}
