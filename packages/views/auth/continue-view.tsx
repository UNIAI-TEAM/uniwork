"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SignInProvider, SignInTicket } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useSession, useSignInTicket } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { User } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { AppLink, useNavigation } from "../navigation";
import { AUTH_PILL } from "./auth-controls";
import { AuthCallbackView } from "./auth-callback-view";
import { AuthShell } from "./auth-shell";
import { ContinueChoices } from "./continue-choices";
import { ContinueLinkStep } from "./continue-link-step";
import { ContinueSkeleton, PILL_LINK, TicketLoadError, useProviderName } from "./continue-parts";

/**
 * /auth/continue (ADR 0047 §2c, spec §4.3): where a Google or Apple sign-in
 * that found no account lands, with its pending sign-in in an HttpOnly
 * cookie the page only asks the server about. `step="link"` is the link
 * step a sign-in in link mode comes back to.
 *
 * `onDone` is called once the person is signed in and this screen has
 * nothing left to do; the page goes on to `next` through the gates. From
 * then until the page has moved, and while the browser leaves for the
 * provider again, the screen is the callback's calm "Đang đăng nhập…": the
 * pending sign-in is spent by then, and must not flash as expired.
 */
export function ContinueView({
  next,
  step = null,
  onDone,
}: {
  next: string | null;
  step?: "link" | null;
  onDone: (user: User) => void;
}) {
  const { replace } = useNavigation();
  const { status, user } = useSession();
  const query = useSignInTicket();
  const [leaving, setLeaving] = useState(false);
  // The provider of a pending sign-in that went away under a command: the
  // expired screen can then name it.
  const [expired, setExpired] = useState<SignInProvider | null>(null);
  // The ticket as last read. A command that spends it (or answers with the
  // second factor still owed) clears the query; the step it led to, the
  // link step's "done" included, still needs to know whose sign-in it was.
  const [known, setKnown] = useState<SignInTicket | null>(null);
  useEffect(() => {
    if (query.data) setKnown(query.data);
  }, [query.data]);

  const ticket = query.data ?? null;
  const subject = ticket ?? known;
  const linkStep = step === "link";
  // The link step is for the account that just signed in; without one, the
  // way there is the sign-in page in link mode, which comes back here.
  const needsSignIn = linkStep && status === "anon" && ticket !== null;
  useEffect(() => {
    if (needsSignIn) replace(paths.login({ link: true, next: paths.authContinue({ step: "link", next }) }));
  }, [needsSignIn, next, replace]);

  const done = (u: User) => {
    setLeaving(true);
    onDone(u);
  };

  if (leaving) return <AuthCallbackView />;
  if (expired) return <ExpiredScreen provider={expired} next={next} />;
  if (query.isError && !known) return <TicketLoadError error={query.error} next={next} onRetry={() => void query.refetch()} />;
  if (query.isPending || status === "loading" || needsSignIn) {
    return (
      <AuthShell>
        <ContinueSkeleton shape={linkStep ? "pills" : "rows"} />
      </AuthShell>
    );
  }

  if (linkStep) {
    // Opened again once it is done (a reload after linking), or the pending
    // sign-in expired: either way nothing is left to link (spec §4.3).
    if (!subject || !user) return <NothingLeft user={user} next={next} onDone={done} />;
    return <ContinueLinkStep ticket={subject} user={user} next={next} onDone={done} />;
  }

  if (!subject) return <ExpiredScreen provider={null} next={next} />;
  return (
    <ContinueChoices
      ticket={subject}
      next={next}
      user={status === "authed" ? user : null}
      onDone={done}
      onLeaving={() => setLeaving(true)}
      onExpired={() => setExpired(subject.provider)}
    />
  );
}

/**
 * No pending sign-in (expired, already used, or never here), or it went
 * away under a command. The way out is the sign-in page, `next` kept, which
 * offers the provider again.
 */
function ExpiredScreen({ provider, next }: { provider: SignInProvider | null; next: string | null }) {
  const { t } = useTranslation();
  const name = useProviderName(provider);
  return (
    <AuthShell
      title={t("auth.continue.expired.title")}
      description={provider ? t("auth.continue.expired.bodyProvider", { provider: name }) : t("auth.continue.expired.body")}
    >
      <AppLink href={paths.login({ next })} className={PILL_LINK}>
        {t("auth.continue.expired.retry")}
      </AppLink>
    </AuthShell>
  );
}

/** The link step with nothing left to link: done before, or expired. "Tiếp tục" is the one way on. */
function NothingLeft({ user, next, onDone }: { user: User | null; next: string | null; onDone: (user: User) => void }) {
  const { t } = useTranslation();
  return (
    <AuthShell title={t("auth.continue.link.nothingLeftTitle")} description={t("auth.continue.link.nothingLeft")}>
      {user ? (
        <Button type="button" size="lg" className={AUTH_PILL} onClick={() => onDone(user)}>
          {t("auth.continue.link.continue")}
        </Button>
      ) : (
        <AppLink href={paths.login({ next })} className={PILL_LINK}>
          {t("auth.continue.link.continue")}
        </AppLink>
      )}
    </AuthShell>
  );
}
