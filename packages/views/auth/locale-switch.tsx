"use client";
import { Globe } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { setLocale, type SupportedLocale } from "@uniwork/core/i18n";
import { useLocaleAdapter } from "@uniwork/core/i18n/react";
import { cn } from "@uniwork/ui/lib/utils";

const OPTIONS: { locale: SupportedLocale; code: string; nameKey: string }[] = [
  { locale: "vi", code: "VI", nameKey: "settings.preferences.languageVi" },
  { locale: "en", code: "EN", nameKey: "settings.preferences.languageEn" },
];

/**
 * The one control a signed-out screen needs that the workspace top bar also
 * has: a way to change language. Before sign-in the language is the browser's
 * guess, and the credential screens are the only place a user with an
 * en-US Chrome and a Vietnamese team can correct it before any account exists.
 *
 * A two-segment pill with a thumb that slides to the chosen side. It used to
 * be a bare ghost button reading "English", which looked like a stray link
 * and did not say what it switched. Both languages are now on view, so the
 * current one is visible as well as the way out.
 *
 * Native radios, visually hidden: arrow keys and the group semantics come
 * from the browser. Each option's accessible name is the language's own name
 * in that language (`lang` on the label), so whoever cannot read the current
 * language still hears the way out. `useId` scopes the group: the auth shell
 * mounts one switch for desktop and one for mobile, and a shared `name` would
 * merge them into one radio group.
 */
export function LocaleSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const localeAdapter = useLocaleAdapter();
  const name = useId();
  const current: SupportedLocale = i18n.language === "en" ? "en" : "vi";

  const choose = (target: SupportedLocale) => {
    if (target === current) return;
    localeAdapter.persist(target);
    void setLocale(target);
    document.documentElement.lang = target;
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("settings.preferences.language")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-surface/55 p-1 ring-1 ring-border/60",
        className,
      )}
    >
      <Globe aria-hidden className="ml-1.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <div className="relative grid grid-cols-2">
        {/* The thumb: one segment wide, moved with transform only, in the
            app's selected-row wash. A white thumb vanished against the pill in
            dark mode; an inverted one put the label's colour on a sibling the
            contrast audit cannot see. This pair reads on both. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-1/2 rounded-full bg-brand-subtle ring-1 ring-brand/15",
            "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            current === "en" && "translate-x-full",
          )}
        />
        {OPTIONS.map(({ locale, code, nameKey }) => {
          const checked = locale === current;
          return (
            <label
              key={locale}
              lang={locale}
              className={cn(
                "relative flex h-7 min-w-9 cursor-pointer select-none items-center justify-center rounded-full px-2.5 text-caption font-semibold tracking-wide transition-colors duration-(--duration-standard)",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                "pointer-coarse:h-11 pointer-coarse:min-w-11",
                checked ? "text-brand-subtle-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={locale}
                checked={checked}
                onChange={() => choose(locale)}
                className="sr-only"
              />
              <span aria-hidden>{code}</span>
              <span className="sr-only">{t(nameKey)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
