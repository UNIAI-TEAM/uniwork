// The gate in front of every command that takes a step-up token on the phone (ADR 0047 §5, spec §5.2): setting or
// changing the password, linking or unlinking a provider, deleting the account, handing an organization over. A
// token already held for the action (ten minutes, memory only) runs the command at once; otherwise the proof sheet
// asks first, so a provider's own sheet for a link never opens before the person proved it is them. A token the
// server refuses (it ran out, the session changed) is forgotten by the command (data/mutations) and the sheet asks
// once more with the proofs the refusal names; a second refusal is the command's error to say. `hold` buys a token
// without running anything, for a screen that must hold every proof before the first command it cannot undo.
import { useQueryClient } from "@tanstack/react-query";
import type { StepUpAction } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { readSignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useAuthStore } from "@/data/auth/store";
import { stepUpToken } from "@/data/auth/step-up-store";
import { signInMethodsOptions } from "@/data/queries/sign-in";
import { StepUpSheet, type StepUpAsk } from "./step-up-sheet";

/** What a gated command came to: its answer, or nothing because the person closed the proof sheet. */
export type StepUpRun<T> = { done: true; value: T } | { done: false };

/** `proofs`: the server's freshest list of what it takes (a refusal's, the methods'); absent or null, it is read. */
export interface StepUpOptions {
  proofs?: readonly unknown[] | null;
}

/** A list read this recently is good enough to choose the first proof from. */
const PROOFS_FRESH_MS = 30_000;

export function useStepUp(): {
  run: <T>(action: StepUpAction, command: (token: string) => Promise<T>, options?: StepUpOptions) => Promise<StepUpRun<T>>;
  hold: (action: StepUpAction, options?: StepUpOptions) => Promise<boolean>;
  sheet: ReactElement;
} {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [ask, setAsk] = useState<StepUpAsk | null>(null);
  const answer = useRef<((held: boolean) => void) | null>(null);
  const asks = useRef(0);

  const settle = useCallback((held: boolean) => {
    const resolve = answer.current;
    answer.current = null;
    setAsk(null);
    resolve?.(held);
  }, []);
  // A screen that goes away with the sheet open answers "not proved", so its command never hangs.
  useEffect(() => () => answer.current?.(false), []);

  const askFor = useCallback(
    (action: StepUpAction, proofs: readonly unknown[]) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        answer.current = resolve;
        asks.current += 1;
        setAsk({ id: asks.current, action, proofs });
      }),
    [],
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

  return { run, hold, sheet: createElement(StepUpSheet, { ask, onDone: settle }) };
}
