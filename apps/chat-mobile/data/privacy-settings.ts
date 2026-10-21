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
import { createStore } from "zustand/vanilla";
import { DEFAULT_PRIVACY_SETTINGS, parsePrivacySettings, serializePrivacySettings, type PrivacySettings } from "@/lib/app-lock";
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
  settings: PrivacySettings;
  /** False until the saved choices are known (or the read gave up). */
  loaded: boolean;
  /** True once the saved choices were read from the phone, on time or after the cap; a choice made first wins. */
  restored: boolean;
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPrivacySettings(deps: PrivacyDeps) {
  const store = createStore<PrivacyState>(() => ({ settings: DEFAULT_PRIVACY_SETTINGS, loaded: false, restored: false }));
  const wait = deps.wait ?? defaultWait;
  let loading: Promise<void> | null = null;
  // A choice made while the saved one was still being read wins over it.
  let chosen = false;

  const apply = (settings: PrivacySettings) => void deps.apply(settings).catch(bestEffort("privacy", "screen protection not applied", "report"));

  return {
    store,
    /** Reads the saved choices and applies them; once per launch, however often it is called. */
    load(): Promise<void> {
      if (loading) return loading;
      let restored = false;
      const restore = (saved: PrivacySettings) => {
        if (restored || chosen) return;
        restored = true;
        store.setState({ settings: saved, restored: true });
        apply(saved);
      };
      const saved = deps.read().then(parsePrivacySettings);
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
      const settings = { ...store.getState().settings, ...patch };
      store.setState({ settings, loaded: true });
      apply(settings);
      // The choice holds for this launch even when it cannot be saved.
      void deps.write(serializePrivacySettings(settings)).catch(bestEffort("privacy", "privacy choices not saved", "report"));
    },
  };
}

