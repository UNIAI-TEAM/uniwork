// The gate in front of every command that takes a step-up token on the phone (ADR 0047 §5, spec §5.2): setting or
// changing the password, linking or unlinking a provider, deleting the account, handing an organization over. A
// token already held for the action (ten minutes, memory only) runs the command at once; otherwise the proof sheet
// asks first, so a provider's own sheet for a link never opens before the person proved it is them. A token the
// server refuses (it ran out, the session changed) is forgotten by the command (data/mutations) and the sheet asks
// once more with the proofs the refusal names; a second refusal is the command's error to say. `hold` buys a token
// without running anything, for a screen that must hold every proof before the first command it cannot undo.
//
// The proofs that send the person out of the app (a code in Mail, the authenticator on the same phone) must survive
// the trip. The app lock engaging puts the sheet away rather than answering it (a sheet is a window above the lock
// screen), and it comes back where it was once the lock lifts; inside another sheet (`insideSheet`, the delete
// sheet) it closes instead, since iOS cannot take two stacked sheets away and bring them back together. Either way
// the ask keeps what the person did: the proof they chose and when a code was mailed for the action, so a sheet
// opened again for it within the code's ten minutes waits on the code's field instead of mailing another. iOS
// presents nothing over a sheet that is still closing, so an ask made while the last one slides away (the owner's
// second proof, a retry after a refused token) waits for its onDismiss.
import { useQueryClient } from "@tanstack/react-query";
import type { StepUpAction, StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { readSignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Platform } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { stepUpToken } from "@/data/auth/step-up-store";
import { signInMethodsOptions } from "@/data/queries/sign-in";
import { useAppLockEngaged } from "@/data/stores/app-lock-store";
import { StepUpSheet, type StepUpAsk, type StepUpProgress } from "./step-up-sheet";

/** What a gated command came to: its answer, or nothing because the person closed the proof sheet. */
export type StepUpRun<T> = { done: true; value: T } | { done: false };

/** `proofs`: the server's freshest list of what it takes (a refusal's, the methods'); absent or null, it is read. */
export interface StepUpOptions {
  proofs?: readonly unknown[] | null;
}

/** A list read this recently is good enough to choose the first proof from. */
const PROOFS_FRESH_MS = 30_000;
/** A mailed step-up code's life on the server (POST /me/step-up/email-code: ten minutes). */
const MAILED_CODE_TTL_MS = 10 * 60_000;
/** A sheet iOS never got to present sends no onDismiss: the next one waits this long at most. */
const DISMISS_FALLBACK_MS = 1_000;

/** When a code still good was mailed for `action`; an older one is forgotten. */
function mailedFor(mailed: Map<StepUpAction, number>, action: StepUpAction, now: number): number | null {
  const at = mailed.get(action);
  if (at !== undefined && now - at < MAILED_CODE_TTL_MS) return at;
  mailed.delete(action);
  return null;
}

export function useStepUp(options: { insideSheet?: boolean } = {}): {
  run: <T>(action: StepUpAction, command: (token: string) => Promise<T>, options?: StepUpOptions) => Promise<StepUpRun<T>>;
  hold: (action: StepUpAction, options?: StepUpOptions) => Promise<boolean>;
  sheet: ReactElement;
} {
  const insideSheet = options.insideSheet ?? false;
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const lockEngaged = useAppLockEngaged();
  const [ask, setAsk] = useState<StepUpAsk | null>(null);
  const current = useRef<StepUpAsk | null>(null);
  const [closing, setClosing] = useState(false);
  const answer = useRef<((held: boolean) => void) | null>(null);
  const asks = useRef(0);
  const mailed = useRef(new Map<StepUpAction, number>());

  const show = useCallback((next: StepUpAsk | null) => {
    current.current = next;
    setAsk(next);
  }, []);

  // Away under the lock: the ask waits, undrawn, until the lock lifts.
  const away = lockEngaged && !insideSheet;
  const visible = ask !== null && !away && !closing;
  // What the sheet draws while it slides away: the ask it was presented for, never the one waiting behind it.
  const drawn = useRef<StepUpAsk | null>(null);
  if (visible) drawn.current = ask;

  const wasVisible = useRef(false);
  useLayoutEffect(() => {
    if (wasVisible.current && !visible && Platform.OS === "ios") setClosing(true);
    wasVisible.current = visible;
  }, [visible]);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), DISMISS_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [closing]);
  const dismissed = useCallback(() => setClosing(false), []);

  const settle = useCallback(
    (held: boolean) => {
      const resolve = answer.current;
      answer.current = null;
      // A code that bought the token is spent.
      if (held && current.current) mailed.current.delete(current.current.action);
      show(null);
      resolve?.(held);
    },
    [show],
  );
  // A screen that goes away with the sheet open answers "not proved", so its command never hangs.
  useEffect(() => () => answer.current?.(false), []);

  const progress = useCallback(
    (id: number, patch: StepUpProgress) => {
      const asked = current.current;
      if (!asked || asked.id !== id) return;
      if (patch.mailedAt) mailed.current.set(asked.action, patch.mailedAt);
      show({ ...asked, ...patch });
    },
    [show],
  );

  const askFor = useCallback(
    (action: StepUpAction, proofs: readonly unknown[]) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        answer.current = resolve;
        asks.current += 1;
        const mailedAt = mailedFor(mailed.current, action, Date.now());
        const picked: StepUpProof | null = mailedAt === null ? null : "email_code";
        show({ id: asks.current, action, proofs, picked, mailedAt });
      }),
    [show],
  );

  /** The proofs the server takes here, from the sign-in methods it last answered; none when it cannot say. */
  const knownProofs = useCallback(async (): Promise<readonly unknown[]> => {
    try {
      return (await qc.fetchQuery({ ...signInMethodsOptions(), staleTime: PROOFS_FRESH_MS }))?.proofs ?? [];
    } catch {
      // The sheet then chooses from the account's own state (step-up-store.ts › proofsFor).
      return [];
    }
  }, [qc]);

  /** A token for `action` is held once this resolves true: the one held already, or one the sheet just bought. */
  const hold = useCallback(
    async (action: StepUpAction, options: StepUpOptions = {}): Promise<boolean> => {
      if (!userId) return false;
      if (stepUpToken(action, userId)) return true;
      if (!(await askFor(action, options.proofs ?? (await knownProofs())))) return false;
      return stepUpToken(action, userId) !== null;
    },
    [askFor, knownProofs, userId],
  );

  const run = useCallback(
    async <T>(action: StepUpAction, command: (token: string) => Promise<T>, options: StepUpOptions = {}): Promise<StepUpRun<T>> => {
      let proofs = options.proofs ?? null;
      for (let asked = 0; ; asked += 1) {
        const token = (await hold(action, { proofs })) ? stepUpToken(action, userId) : null;
        if (!token) return { done: false };
        try {
          return { done: true, value: await command(token) };
        } catch (error: unknown) {
          const failure = readSignInFailure(error, "methods");
          if (failure.kind !== "step_up" || asked > 0) throw error;
          proofs = failure.proofs;
        }
      }
    },
    [hold, userId],
  );

  const sheet = createElement(StepUpSheet, {
    ask: visible ? ask : drawn.current,
    visible,
    // The lock's close puts a sheet of its own away (`away`); inside another sheet it is an answer, as any close.
    lockAnswers: insideSheet,
    onDone: settle,
    onProgress: progress,
    onDismiss: dismissed,
  });
  return { run, hold, sheet };
}
