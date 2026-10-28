"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, CircleAlert, Clock, RefreshCw } from "lucide-react";
import type { SignInIdentity, SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import {
  providerNameKey,
  readSignInFailure,
  retryPhrase,
  secondsUntil,
  sentenceValues,
  type RetryPhrase,
  type SignInContext,
  type SignInFailure,
} from "@uniwork/core/auth/sign-in-errors";
import { emailDisplay } from "@uniwork/core/auth/sign-in-rules";
import { paths } from "@uniwork/core/paths";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { pickerCardClass } from "../common/picker-card";
import { AppleMark, GoogleMark } from "../common/provider-icons";
import { AppLink } from "../navigation";
import { AUTH_LINK, AUTH_PILL } from "./auth-controls";
import { AuthShell } from "./auth-shell";

/**
 * The pieces every step of the choice screen (/auth/continue, spec §4.3)
 * stands on: who the provider says the person is, the large choice rows,
 * the loading shape of both, and one way to say a failure (with the live
 * countdown a 429 asks for).
 */

const MARKS: Record<SignInProvider, typeof GoogleMark> = { google: GoogleMark, apple: AppleMark };

/** The provider's mark at the size of the surface it sits on (a 40px tile, a banner's 16px). */
export function ProviderMark({ provider, className }: { provider: SignInProvider; className?: string }) {
  const Mark = MARKS[provider];
  return <Mark className={className} />;
}

/** The provider's name, through t() like every other string on screen. */
export function useProviderName(provider: SignInProvider | null | undefined): string {
  const { t } = useTranslation();
  return provider ? t(providerNameKey(provider)) : "";
}

/** How the identity's address may be shown: Apple's hidden email is named, never spelled out. */
export function identityAddress(identity: Pick<SignInIdentity, "email" | "private_relay">) {
  return emailDisplay(identity.email, { privateRelay: identity.private_relay });
}

/** The identity's address as a line of text ("Email ẩn của Apple" for the relay). */
export function useIdentityEmail(identity: Pick<SignInIdentity, "email" | "private_relay">): string {
  const { t } = useTranslation();
  const shown = identityAddress(identity);
  return shown.kind === "relay" ? t("auth.apple.relayEmail") : shown.kind === "address" ? shown.email : "";
}

const PLANE = "flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-3";
const TILE = "flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground";

/**
 * Who the provider says the person is: its mark in a 40px tile, the name,
 * the address (or "Email ẩn của Apple"). Without a name the address is the
 * one line. A named group, so a screen reader hears whose account it is.
 */
export function IdentityBlock({ identity }: { identity: SignInIdentity }) {
  const { t } = useTranslation();
  const provider = useProviderName(identity.provider);
  const email = useIdentityEmail(identity);
  const name = identity.name.trim();
  return (
    <div role="group" aria-label={t("auth.continue.identityLabel", { provider })} className={PLANE}>
      <span aria-hidden className={TILE}>
        <ProviderMark provider={identity.provider} className="size-5" />
      </span>
      {/* Names and addresses have no break opportunity; they wrap anywhere
          rather than scroll a phone sideways. */}
      <span className="flex min-w-0 flex-col">
        <span className="text-body font-medium text-foreground [overflow-wrap:anywhere]">{name || email}</span>
        {name && email ? (
          <span className="text-caption text-muted-foreground [overflow-wrap:anywhere]">{email}</span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The rows' ruler: tall enough for a title and a one-line explanation at
 * 17 (4.25rem), so the skeleton and the rows it stands for share a height.
 * aria-disabled rows dim and refuse the pointer; the busy one keeps full
 * strength with a spinner where its chevron was.
 */
const ROW = cn(
  pickerCardClass(false),
  "group/row flex min-h-17 items-center gap-3 rounded-xl px-4 py-3",
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-border aria-disabled:hover:bg-card",
  "aria-busy:cursor-progress",
);

/**
 * One large pressable choice: title, one line, a chevron. A link when the
 * choice goes to another page (it keeps open-in-new-tab and the URL on
 * hover), a button when it acts here. `busy` is the one pressed and still
 * working; `disabled` are the others while it does (aria-disabled keeps them
 * in the tab order, so the guard is in the handler).
 */
export function ChoiceRow({
  title,
  body,
  href,
  onPress,
  busy = false,
  disabled = false,
}: {
  title: string;
  body: string;
  href?: string;
  onPress?: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body font-medium text-foreground">{title}</span>
        <span className="text-pretty text-caption text-muted-foreground">{body}</span>
      </span>
      {busy ? (
        <Spinner className="shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-standard) ease-out-quart group-hover/row:translate-x-0.5 group-aria-disabled/row:translate-x-0 motion-reduce:transition-none"
        />
      )}
    </>
  );
  const held = busy || disabled;
  const state = { "aria-disabled": disabled || undefined, "aria-busy": busy || undefined };
  if (href) {
    return (
      <AppLink
        href={href}
        className={ROW}
        {...state}
        onClick={(e) => {
          if (held) e.preventDefault();
        }}
      >
        {content}
      </AppLink>
    );
  }
  return (
    <button
      type="button"
      className={ROW}
      {...state}
      onClick={() => {
        if (!held) onPress?.();
      }}
    >
      {content}
    </button>
  );
}

/**
 * The choice screen while the pending sign-in loads: the identity block and
 * its actions in their final shape, so nothing moves when they land: three
 * choice rows, or the link step's two pills.
 */
export function ContinueSkeleton({ shape = "rows" }: { shape?: "rows" | "pills" }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t("auth.continue.loading")}
      </p>
      <div aria-hidden className="flex flex-col gap-6">
        <div className={PLANE}>
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3.5 w-3/5" />
          </span>
        </div>
        {shape === "rows" ? (
          <>
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex min-h-17 items-center gap-3 rounded-xl border border-border px-4 py-3">
                  <span className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3.5 w-4/5" />
                  </span>
                  <Skeleton className="size-4 rounded-full" />
                </div>
              ))}
              {/* The terms line under "Tạo tài khoản mới": two caption lines
                  at the column's width, so the card does not grow when the
                  choices land. */}
              <div className="flex flex-col items-center">
                <div className="flex h-4 w-full items-center justify-center">
                  <Skeleton className="h-3 w-4/5" />
                </div>
                <div className="flex h-4 w-full items-center justify-center">
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
            </div>
            <Skeleton className="h-5 w-16 self-center" />
          </>
        ) : (
          <>
            <div className="flex h-5 items-center">
              <Skeleton className="h-4 w-4/5" />
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12 w-full rounded-full" />
              <Skeleton className="h-12 w-full rounded-full" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A command's failure, read once per error (the table in sign-in-errors):
 * memoised on the error object, so the countdown below does not restart on
 * every render.
 */
export function useFailure(error: unknown, context: SignInContext): SignInFailure | null {
  return useMemo(() => (error ? readSignInFailure(error, context) : null), [error, context]);
}

/**
 * Whole seconds left until `deadline` (epoch ms), ticking once a second
 * while there are any; 0 when there is none or it has passed. A deadline,
 * not a counter, so a throttled background tab still reads the true number
 * when it wakes.
 */
export function useSecondsLeft(deadline: number | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const id = window.setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= deadline) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadline]);
  return deadline === null ? 0 : secondsUntil(deadline, Date.now());
}

/**
 * The live "Thử lại sau …" of a `wait` failure: the server's Retry-After
 * counted down from the moment the failure arrived. `onOver` runs when it
 * reaches zero, so the screen lets the person try again instead of showing
 * a stale number. A wait the server did not time reads "later" and never
 * ends by itself.
 */
export function useWaitPhrase(failure: SignInFailure | null, onOver: () => void): RetryPhrase | null {
  const [deadline, setDeadline] = useState<number | null>(null);
  const over = useRef(onOver);
  useEffect(() => {
    over.current = onOver;
  }, [onOver]);
  useEffect(() => {
    setDeadline(
      failure?.kind === "wait" && failure.retryAfterSeconds !== null ? Date.now() + failure.retryAfterSeconds * 1000 : null,
    );
  }, [failure]);
  const left = useSecondsLeft(deadline);
  useEffect(() => {
    if (deadline !== null && left === 0) over.current();
  }, [deadline, left]);
  if (failure?.kind !== "wait") return null;
  return deadline === null ? failure.retry : retryPhrase(left);
}

/** A link dressed as the primary pill: it navigates, so it stays an <a> for assistive tech. */
export const PILL_LINK = cn(buttonVariants({ size: "lg" }), AUTH_PILL);

/**
 * The pending sign-in could not be read (offline, the server's trouble): say
 * so, and offer the read again rather than a dead end; the way back to the
 * sign-in page stays, `next` kept.
 */
export function TicketLoadError({ error, next, onRetry }: { error: unknown; next: string | null; onRetry: () => void }) {
  const { t } = useTranslation();
  const failure = useFailure(error, "ticket");
  return (
    <AuthShell
      title={t("auth.continue.loadErrorTitle")}
      description={<span role="alert">{failure ? t(failure.key, sentenceValues(failure, t)) : null}</span>}
    >
      <div className="flex flex-col gap-4">
        <Button type="button" size="lg" className={AUTH_PILL} onClick={onRetry}>
          <RefreshCw aria-hidden />
          {t("common.retry")}
        </Button>
        <p className="text-center text-body text-muted-foreground">
          <AppLink href={paths.login({ next })} className={AUTH_LINK}>
            {t("auth.forgot.backToLogin")}
          </AppLink>
        </p>
      </div>
    </AuthShell>
  );
}

/**
 * A failure as a form-level notice: the sentence, its live countdown when it
 * is a wait, and the ways out it offers (`children`: retry, sign in to
 * link). A wait is a passing state (warning, a clock); everything else went
 * wrong (destructive soft, the error glyph).
 *
 * role=alert announces the sentence with the wait it started with; the
 * ticking number beside it is hidden from the live region, or a screen
 * reader would read every second of it.
 */
export function FailureNotice({
  failure,
  phrase,
  provider = null,
  children,
}: {
  failure: SignInFailure;
  phrase?: RetryPhrase | null;
  /** The provider a screen's own sentence names (the link step's "Google này…"). */
  provider?: SignInProvider | null;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const wait = failure.kind === "wait";
  const say = (p: RetryPhrase) => t(p.key, p.count === undefined ? {} : { count: p.count });
  return (
    <Alert variant={wait ? "warning" : "destructiveSoft"}>
      {wait ? <Clock aria-hidden /> : <CircleAlert aria-hidden />}
      <AlertDescription className="text-pretty">
        {t(failure.key, sentenceValues({ ...failure, provider }, t))}
        {wait && failure.retry ? (
          <>
            {" "}
            <span className="sr-only">{say(failure.retry)}</span>
            <span aria-hidden>{say(phrase ?? failure.retry)}</span>
          </>
        ) : null}
      </AlertDescription>
      {children ? <div className="col-start-2 mt-2 flex flex-wrap gap-2">{children}</div> : null}
    </Alert>
  );
}
