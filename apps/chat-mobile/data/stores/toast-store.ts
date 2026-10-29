// Non-blocking messages: an action that failed says so in a toast
// at the top of the screen, which goes away on its own, instead of an
// Alert.alert that stops the person until they tap OK. Alert stays for real
// confirmations (delete, leave, revoke). components/ui/toast-host.tsx draws
// the list and announces each new toast to VoiceOver/TalkBack.
import { create } from "zustand";

export type ToastTone = "error" | "info" | "success";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

/** Long enough to read a sentence twice; errors stay a little longer. */
export const TOAST_DURATION_MS: Record<ToastTone, number> = { error: 5000, info: 3500, success: 2500 };
/**
 * A notice said on the way to the next screen (an account taken back, a link that could not be made): long enough to
 * read a two-clause sentence once that screen has painted, as the web's session notices stay.
 */
export const NOTICE_DURATION_MS = 10_000;
/** More than this at once is noise: the oldest goes first. */
export const MAX_TOASTS = 3;

export interface ToastOptions {
  /** how long it stays; its tone's duration by default */
  durationMs?: number;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: ToastTone, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function stopTimer(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

export const useToastStore = create<ToastState>((set, get) => {
  const schedule = (id: number, durationMs: number) => {
    stopTimer(id);
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), durationMs),
    );
  };
  return {
    toasts: [],
    show: (message, tone = "error", options = {}) => {
      const durationMs = options.durationMs ?? TOAST_DURATION_MS[tone];
      // The same failure twice (a double tap, a retry loop) is one toast, shown for longer.
      const same = get().toasts.find((toast) => toast.message === message && toast.tone === tone);
      if (same) {
        schedule(same.id, durationMs);
        return same.id;
      }
      const id = nextId++;
      const toasts = [...get().toasts, { id, message, tone }];
      for (const dropped of toasts.slice(0, Math.max(0, toasts.length - MAX_TOASTS))) stopTimer(dropped.id);
      set({ toasts: toasts.slice(-MAX_TOASTS) });
      schedule(id, durationMs);
      return id;
    },
    dismiss: (id) => {
      stopTimer(id);
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
    clear: () => {
      for (const id of timers.keys()) stopTimer(id);
      set({ toasts: [] });
    },
  };
});

/** Call sites say what happened: `toast.error(t("chat.dm_failed"))`. */
export const toast = {
  error: (message: string, options?: ToastOptions) => useToastStore.getState().show(message, "error", options),
  info: (message: string, options?: ToastOptions) => useToastStore.getState().show(message, "info", options),
  success: (message: string, options?: ToastOptions) => useToastStore.getState().show(message, "success", options),
};
