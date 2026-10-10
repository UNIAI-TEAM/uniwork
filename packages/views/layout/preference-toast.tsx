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

/** Shows the saved-preference toast, in `lng` when the language just changed. */
export function usePreferenceSavedToast(): (lng?: string) => void {
  const { t, i18n } = useTranslation();
  const { quiet } = useContext(QuietContext);
  return useCallback(
    (lng?: string) => {
      if (quiet) return;
      toast.success(
        lng
          ? i18n.t("settings.preferences.toastSaved", { lng })
          : t("settings.preferences.toastSaved"),
        { id: "settings-auto-save" },
      );
    },
    [quiet, t, i18n],
  );
}
