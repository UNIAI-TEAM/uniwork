// The app lock and screen security choices (lib/app-lock.ts), read from the
// device once per launch and held in one store, as the theme is
// (data/theme-preference.ts). Applying them to the platform (expo-screen-
// capture) and reading the Keychain come in as dependencies, so this stays a
// node test; components/app/privacy.ts wires the real ones.
//
// The read is capped: the privacy guard covers the app until the choices are
// known (an app lock must not show the inbox for a frame first), so a Keychain
// that never answers must not leave the app covered for ever. Past the cap, or
// on a failed read, both protections read as off, as before any choice — but
// only until a slow read answers: its choices then replace the defaults
// (`restored`), and the guard treats that answer as the cold start, so a busy
// Keychain cannot turn the lock off for the whole launch.
//
// The person's organization may require the lock or the capture block for
// every phone (`floor`, lib/app-lock.ts › withFloor): the platform gets the
// choices raised to it, and it is saved with them, so a cold start enforces
// the last floor the phone heard. A floor heard before the saved choices are
// read is saved only once they are, so it never overwrites them with defaults.
import { createStore } from "zustand/vanilla";
import {
  DEFAULT_PRIVACY_SETTINGS,
  NO_PRIVACY_FLOOR,
  parsePrivacyFloor,
  parsePrivacySettings,
  sameFloor,
  serializePrivacySettings,
  withFloor,
  type PrivacyFloor,
  type PrivacySettings,
} from "@/lib/app-lock";
import { bestEffort } from "./report";

export const PRIVACY_READ_CAP_MS = 3_000;

interface PrivacyDeps {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  /** Hands the choices to the platform: screen capture blocked or allowed, the app switcher protected or not. */
  apply: (settings: PrivacySettings) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
}

export interface PrivacyState {
  /** The person's own choices. */
  settings: PrivacySettings;
  /** What the organization requires; what is carried out is withFloor(settings, floor). */
  floor: PrivacyFloor;
  /** False until the saved choices are known (or the read gave up). */
  loaded: boolean;
  /** True once the saved choices were read from the phone, on time or after the cap; a choice made first wins. */
  restored: boolean;
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whether the app lock is on as saved on the phone (the person's choice raised to the saved floor), for what must
 * follow it without the store: a notification's Reply, heard by Android's headless task as well as by the running
 * app (data/chat-notification-actions.ts). Read fresh each time, with the same cap as the boot read; a read that
 * fails or does not answer reads as locked, since a reply refused costs less than one sent past the lock.
 */
export async function savedAppLockOn(read: () => Promise<string | null>, wait: (ms: number) => Promise<void> = defaultWait): Promise<boolean> {
  const timeout = wait(PRIVACY_READ_CAP_MS).then(() => {
    throw new Error("privacy_read_timeout");
  });
  try {
    const raw = await Promise.race([read(), timeout]);
    return withFloor(parsePrivacySettings(raw), parsePrivacyFloor(raw)).appLock;
  } catch {
    return true;
  }
}

export function createPrivacySettings(deps: PrivacyDeps) {
  const store = createStore<PrivacyState>(() => ({ settings: DEFAULT_PRIVACY_SETTINGS, floor: NO_PRIVACY_FLOOR, loaded: false, restored: false }));
  const wait = deps.wait ?? defaultWait;
  let loading: Promise<void> | null = null;
  // A choice made while the saved one was still being read wins over it; so does a floor heard meanwhile.
  let chosen = false;
  let floorHeard = false;

  const apply = () => {
    const { settings, floor } = store.getState();
    void deps.apply(withFloor(settings, floor)).catch(bestEffort("privacy", "screen protection not applied", "report"));
  };
  const save = () => {
    const { settings, floor } = store.getState();
    // The choice holds for this launch even when it cannot be saved.
    void deps.write(serializePrivacySettings(settings, floor)).catch(bestEffort("privacy", "privacy choices not saved", "report"));
  };

  return {
    store,
    /** Reads the saved choices and applies them; once per launch, however often it is called. */
    load(): Promise<void> {
      if (loading) return loading;
      let restored = false;
      const restore = (raw: string | null) => {
        if (restored || chosen) return;
        restored = true;
        store.setState({ settings: parsePrivacySettings(raw), restored: true, ...(floorHeard ? {} : { floor: parsePrivacyFloor(raw) }) });
        apply();
        // A floor heard during the read is saved now, beside the choices just read.
        if (floorHeard) save();
      };
      const saved = deps.read();
      // Past the cap the read still counts when it answers (a failure there was reported as the timeout).
      saved.then(restore, () => undefined);
      loading = Promise.race([
        saved,
        wait(PRIVACY_READ_CAP_MS).then(() => {
          throw new Error("privacy_read_timeout");
        }),
      ])
        .then(restore, bestEffort("privacy", "saved privacy choices not read", "report"))
        .finally(() => store.setState({ loaded: true }));
      return loading;
    },
    update(patch: Partial<PrivacySettings>): void {
      chosen = true;
      store.setState({ settings: { ...store.getState().settings, ...patch }, loaded: true });
      apply();
      save();
    },
    /** The organization's requirements, as the server last said them (components/app/use-privacy-floor.ts). */
    setFloor(floor: PrivacyFloor): void {
      floorHeard = true;
      if (sameFloor(store.getState().floor, floor)) return;
      store.setState({ floor });
      apply();
      // Saved now only when it cannot overwrite unread choices: after the read, or after a choice that replaced them.
      if (store.getState().restored || chosen) save();
    },
  };
}

