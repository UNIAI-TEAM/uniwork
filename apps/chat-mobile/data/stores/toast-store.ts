// Non-blocking messages (audit T4): an action that failed says so in a toast
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
/** More than this at once is noise: the oldest goes first. */
export const MAX_TOASTS = 3;

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: ToastTone) => number;
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
  const schedule = (id: number, tone: ToastTone) => {
    stopTimer(id);
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), TOAST_DURATION_MS[tone]),
    );
  };
  return {
    toasts: [],
    show: (message, tone = "error") => {
      // The same failure twice (a double tap, a retry loop) is one toast, shown for longer.
      const same = get().toasts.find((toast) => toast.message === message && toast.tone === tone);
      if (same) {
        schedule(same.id, tone);
        return same.id;
      }
      const id = nextId++;
      const toasts = [...get().toasts, { id, message, tone }];
      for (const dropped of toasts.slice(0, Math.max(0, toasts.length - MAX_TOASTS))) stopTimer(dropped.id);
      set({ toasts: toasts.slice(-MAX_TOASTS) });
      schedule(id, tone);
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
  error: (message: string) => useToastStore.getState().show(message, "error"),
  info: (message: string) => useToastStore.getState().show(message, "info"),
  success: (message: string) => useToastStore.getState().show(message, "success"),
};
