// The Settings theme choice (light | dark | system), read from the device once
// per launch and held in one store (audit P2 UX): before, every component that
// drew a colour (each bubble, row and icon, 50-odd call sites) read
// SecureStore and set the scheme again on mount. Boot calls load(); the hook in
// lib/use-color-scheme.ts reads the store and NativeWind's scheme, nothing else.
// Storage and NativeWind come in as dependencies so this stays a node test.
import { createStore } from "zustand/vanilla";
import { bestEffort } from "./report";

export type ThemePreference = "light" | "dark" | "system";

const isPreference = (value: unknown): value is ThemePreference => value === "light" || value === "dark" || value === "system";

interface ThemeDeps {
  /** The saved choice, if any (SecureStore on the phone). */
  read: () => Promise<string | null>;
  write: (value: ThemePreference) => Promise<void>;
  /** Hands the choice to the styling runtime (NativeWind's colorScheme.set). */
  apply: (value: ThemePreference) => void;
}

export function createThemePreference(deps: ThemeDeps) {
  const store = createStore<{ preference: ThemePreference }>(() => ({ preference: "system" }));
  let loading: Promise<void> | null = null;
  // A choice made while the saved one was still being read wins over it.
  let chosen = false;
  return {
    store,
    /** Reads the saved choice and applies it; once per launch, however often it is called. */
    load(): Promise<void> {
      loading ??= deps
        .read()
        .then((saved) => {
          if (chosen || !isPreference(saved)) return;
          store.setState({ preference: saved });
          deps.apply(saved);
        })
        // A failed read is not fatal: "system" stands, as before any choice.
        .catch(bestEffort("theme", "saved theme not read", "breadcrumb"));
      return loading;
    },
    set(preference: ThemePreference): void {
      chosen = true;
      store.setState({ preference });
      deps.apply(preference);
      // The choice holds for this launch even when it cannot be saved.
      void deps.write(preference).catch(bestEffort("theme", "theme not saved", "breadcrumb"));
    },
  };
}
