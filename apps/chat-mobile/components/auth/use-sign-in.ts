// One sign-in from a sign-in screen (spec §5.2): the auth store's login(request), with what the screen shows meanwhile
// and after. While it runs, `busy` names the control it started from (that control turns into a labelled spinner,
// every other one dims and ignores taps). A second factor or a choice moves on to its screen; a session says once
// what it brought (an account taken back, a link that could not be made) and the screen's own redirect takes over;
// a failure becomes the sentence core's table gives it, with a countdown while it asks to wait.
import { linkSkippedKey, retryPhrase, type SignInContext, type SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dismissInterrupted, usePendingSignIn } from "@/data/auth/pending-sign-in";
import type { SignInOutcome, SignInRequest } from "@/data/auth/sign-in";
import { useAuthStore } from "@/data/auth/store";
import { toast } from "@/data/stores/toast-store";
import { signInFailureOf, startOf, type SignInStart } from "@/lib/sign-in-failure";
import { signInRoutes } from "@/lib/sign-in-routes";
import { useCountdown } from "./use-countdown";

/** A failure as the screen shows it: a `wait` one counts down to its deadline. */
export interface ShownFailure {
  failure: SignInFailure;
  deadlineMs: number | null;
}

export type SignInResult = { ok: true; outcome: SignInOutcome } | { ok: false; failure: SignInFailure };

export function shownFailure(failure: SignInFailure, now: number = Date.now()): ShownFailure {
  const waits = failure.kind === "wait" && failure.retryAfterSeconds !== null;
  return { failure, deadlineMs: waits ? now + (failure.retryAfterSeconds ?? 0) * 1_000 : null };
}

/**
 * The sentence of a shown failure, and whether it still asks to wait: "… Thử lại sau 14 phút." counting down; once the
 * wait is over the sentence is gone (the lock lifted, a code may be asked again).
 */
export function useFailureMessage(shown: ShownFailure | null): { message: string | null; waiting: boolean } {
  const { t } = useTranslation();
  const left = useCountdown(shown?.deadlineMs ?? null);
  if (!shown) return { message: null, waiting: false };
  const { failure, deadlineMs } = shown;
  const sentence = t(failure.key, failure.values);
  if (failure.kind !== "wait") return { message: sentence, waiting: false };
  if (deadlineMs === null) {
    return { message: failure.retry ? `${sentence} ${t(failure.retry.key, { count: failure.retry.count })}` : sentence, waiting: false };
  }
  if (left === 0) return { message: null, waiting: false };
  const phrase = retryPhrase(left);
  return { message: `${sentence} ${t(phrase.key, { count: phrase.count })}`, waiting: true };
}

export function useSignIn(context: SignInContext, options: { linkMode?: boolean } = {}) {
  const { t } = useTranslation();
  const login = useAuthStore((s) => s.login);
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<ShownFailure | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { linkMode = false } = options;

  /** Say once what the session brought; the screen's redirect does the rest. */
  const tellSignedIn = useCallback(
    (outcome: Extract<SignInOutcome, { kind: "signed_in" }>, provider: SignInProvider | null) => {
      if (outcome.reclaimed) toast.info(t("auth.social.reclaimed"));
      const skipped = linkSkippedKey(outcome.linkSkipped, provider);
      if (skipped) toast.info(t(skipped, provider ? { provider: t(`auth.social.provider.${provider}`) } : {}));
    },
    [t],
  );

  const fail = useCallback(
    (error: unknown, start: SignInStart = "form"): SignInFailure => {
      const failure = signInFailureOf(error, context, start);
      if (mounted.current) setShown(shownFailure(failure));
      return failure;
    },
    [context],
  );

  const run = useCallback(
    /** `control` names the button the sign-in runs from; by default what the request opens (startOf). */
    async (request: SignInRequest, control?: string): Promise<SignInResult | null> => {
      if (running.current) return null;
      running.current = true;
      const start = startOf(request);
      // The provider a second factor was to link, read before the sign-in clears it.
      const linking = usePendingSignIn.getState().secondFactor?.context.provider ?? null;
      dismissInterrupted();
      setBusy(control ?? start);
      setShown(null);
      try {
        const outcome = await login(request);
        if (outcome.kind === "signed_in") tellSignedIn(outcome, linking);
        else if (outcome.kind === "second_factor") router.push(signInRoutes.secondFactor({ link: linkMode }));
        else if (outcome.kind === "choice") router.push(signInRoutes.choice);
        return { ok: true, outcome };
      } catch (error: unknown) {
        return { ok: false, failure: fail(error, start) };
      } finally {
        running.current = false;
        if (mounted.current) setBusy(null);
      }
    },
    [fail, linkMode, login, tellSignedIn],
  );

  const clearFailure = useCallback(() => setShown(null), []);

  return { busy, shown, run, fail, clearFailure };
}
