// The one permission primer on screen (data/permissions.ts asks, the host in
// components/ui/permission-primer.tsx draws it). A second request replaces the
// first, which is answered "not now": two sheets never stack.
import { create } from "zustand";
import type { PrimerRequest } from "../permissions";

interface PrimerState {
  request: PrimerRequest | null;
}

export const usePrimerStore = create<PrimerState>(() => ({ request: null }));

let answer: ((ok: boolean) => void) | null = null;

/** Shows the primer; resolves true when the person chose to go on (or to open Settings). */
export function presentPrimer(request: PrimerRequest): Promise<boolean> {
  answer?.(false);
  return new Promise((resolve) => {
    answer = resolve;
    usePrimerStore.setState({ request });
  });
}

/** The person's choice on the primer on screen; nothing when none is. */
export function answerPrimer(ok: boolean): void {
  const resolve = answer;
  answer = null;
  usePrimerStore.setState({ request: null });
  resolve?.(ok);
}
