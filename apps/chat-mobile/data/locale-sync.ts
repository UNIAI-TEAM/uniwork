// The app's language on the server (audit P2 i18n). users.locale picks the
// language of pushes, emails and the web, and defaults to English (migration
// 214), while the phone speaks the person's Settings choice or the phone's
// own language: a Vietnamese team got English pushes. The phone tells the
// server its language at the first sign-in of each account on this phone and
// whenever the language changes here; a language changed later on the web is
// left alone until the phone's own choice changes again. What was last sent
// for an account is kept on the device (`locale_synced:<userId>`); a failed
// request (offline, 5xx) is tried again at the next user or language change,
// which a launch's /me revalidation always is.
import type { User } from "@uniwork/core/types/user";
import type { SupportedLocale } from "@/lib/i18n/singleton";
import { createLogger } from "./logger";
import type { DeviceStore } from "./storage/device-store";

export interface LocaleSyncDeps {
  getUser: () => User | null;
  subscribeUser: (listener: () => void) => () => void;
  getLocale: () => SupportedLocale;
  subscribeLocale: (listener: () => void) => () => void;
  /** PATCH /api/v1/me; the updated user, or null when the answer drifted. */
  patchLocale: (locale: SupportedLocale) => Promise<User | null>;
  setUser: (user: User) => void;
  openStore: () => Promise<DeviceStore>;
}

const log = createLogger("locale-sync");

const syncedKey = (userId: string) => `locale_synced:${userId}`;

/** Starts following the signed-in person and the app's language; returns the stop. */
export function startLocaleSync(deps: LocaleSyncDeps): () => void {
  let running = false;
  let again = false;

  async function syncOnce(): Promise<void> {
    const user = deps.getUser();
    if (!user) return;
    const locale = deps.getLocale();
    const store = await deps.openStore();
    if (store.getString(syncedKey(user.id)) === locale) return;
    if (user.locale === locale) {
      store.set(syncedKey(user.id), locale);
      return;
    }
    const updated = await deps.patchLocale(locale);
    store.set(syncedKey(user.id), locale);
    // A sign-out or another account while the request ran: that answer is not theirs.
    if (updated && deps.getUser()?.id === user.id) deps.setUser(updated);
  }

  function sync(): void {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void syncOnce()
      // Offline or refused: the next user or language change tries again.
      .catch(() => log.warn("locale_sync_failed"))
      .finally(() => {
        running = false;
        if (!again) return;
        again = false;
        sync();
      });
  }

  const stopUser = deps.subscribeUser(sync);
  const stopLocale = deps.subscribeLocale(sync);
  sync();
  return () => {
    stopUser();
    stopLocale();
  };
}
