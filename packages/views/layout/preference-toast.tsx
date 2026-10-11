"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/**
 * A theme or language change gets a "Saved" toast in the workspace chrome. A
 * page that has nothing to save (a document the member can only view) reads
 * that toast as a document save, so it asks the chrome to stay quiet while it
 * is mounted.
 */
interface QuietRegistry {
  quiet: boolean;
  hold(): () => void;
}

const QuietContext = createContext<QuietRegistry>({
  quiet: false,
  hold: () => () => undefined,
});

export function PreferenceToastProvider({ children }: { children: ReactNode }) {
  const [holds, setHolds] = useState(0);
  const hold = useCallback(() => {
    setHolds((count) => count + 1);
    return () => setHolds((count) => count - 1);
  }, []);
  const value = useMemo(() => ({ quiet: holds > 0, hold }), [holds, hold]);
  return (
    <QuietContext.Provider value={value}>{children}</QuietContext.Provider>
  );
}

/** Silences the preference "Saved" toast while `quiet` is true; renders nothing. */
export function QuietPreferenceToast({ quiet = true }: { quiet?: boolean }) {
  const { hold } = useContext(QuietContext);
  useEffect(() => (quiet ? hold() : undefined), [quiet, hold]);
  return null;
}

/** Which preference just changed; the toast names it, since on a document page a bare "Saved" reads as the document's save state. */
type SavedPreference = "theme" | "language";

const SAVED_KEYS: Record<SavedPreference, string> = {
  theme: "topbar.themeSaved",
  language: "topbar.languageSaved",
};

/** Shows the saved-preference toast, in `lng` when the language just changed. */
export function usePreferenceSavedToast(): (preference: SavedPreference, lng?: string) => void {
  const { t, i18n } = useTranslation();
  const { quiet } = useContext(QuietContext);
  return useCallback(
    (preference: SavedPreference, lng?: string) => {
      if (quiet) return;
      const key = SAVED_KEYS[preference];
      toast.success(lng ? i18n.t(key, { lng }) : t(key), { id: "settings-auto-save" });
    },
    [quiet, t, i18n],
  );
}
