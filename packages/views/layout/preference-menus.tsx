"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Languages, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, setLocale, type SupportedLocale } from "@uniwork/core/i18n";
import { useLocaleAdapter } from "@uniwork/core/i18n/react";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";

/**
 * The two preference controls that appear in every chrome the product has: the
 * workspace top bar for signed-in users and the marketing header for everyone
 * else. They live here rather than in either header because a visitor who
 * lands on `/` in the wrong language or the wrong theme must be able to fix it
 * before an account exists, and the fix has to behave identically once one
 * does.
 *
 * The caller owns the feedback: inside the app a change is a saved preference
 * and gets a toast, on the landing page it is just a change and gets none.
 */
export type ThemeValue = "light" | "dark" | "system";

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

type MenuProps = {
  /** Called only when the value actually changed. */
  onChanged?: () => void;
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
};

function MenuTrigger({
  label,
  size,
  className,
  children,
}: {
  label: string;
  size: ComponentProps<typeof Button>["size"];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="ghost" size={size} className={className} aria-label={label} />
            }
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ThemeMenu({ onChanged, size = "icon-sm", className }: MenuProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  // The stored theme lives in localStorage, so the server cannot know it and
  // renders the system icon. Reading `theme` before mount would draw a
  // different glyph on the client and hydration would throw away the tree —
  // which is exactly what happened when this control reached the landing page,
  // the one screen that is server-rendered on every visit. One icon settles a
  // frame late; the label and the menu are correct throughout.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const stored: ThemeValue =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
  /** Only the trigger glyph waits for mount; the menu always shows the truth. */
  const iconValue: ThemeValue = mounted ? stored : "system";

  const themeOptions: { value: ThemeValue; label: string }[] = [
    { value: "light", label: t("settings.preferences.themeLight") },
    { value: "dark", label: t("settings.preferences.themeDark") },
    { value: "system", label: t("settings.preferences.themeSystem") },
  ];

  const ThemeIcon = THEME_ICONS[iconValue];
  const themeLabel = t("topbar.theme");

  return (
    <DropdownMenu>
      <MenuTrigger label={themeLabel} size={size} className={className}>
        <ThemeIcon aria-hidden className="size-4 text-muted-foreground" />
      </MenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup
          value={stored}
          onValueChange={(next) => {
            if (!next || next === stored) return;
            setTheme(next as ThemeValue);
            onChanged?.();
          }}
        >
          {themeOptions.map((option) => {
            const Icon = THEME_ICONS[option.value];
            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LocaleMenu({ onChanged, size = "icon-sm", className }: MenuProps) {
  const { t, i18n } = useTranslation();
  const localeAdapter = useLocaleAdapter();

  const currentLocale: SupportedLocale = SUPPORTED_LOCALES.includes(i18n.language as SupportedLocale)
    ? (i18n.language as SupportedLocale)
    : DEFAULT_LOCALE;

  const languageOptions: { value: SupportedLocale; label: string }[] = [
    { value: "vi", label: t("settings.preferences.languageVi") },
    { value: "en", label: t("settings.preferences.languageEn") },
  ];

  const languageLabel = t("topbar.language");

  return (
    <DropdownMenu>
      <MenuTrigger label={languageLabel} size={size} className={className}>
        <Languages aria-hidden className="size-4 text-muted-foreground" />
      </MenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup
          value={currentLocale}
          onValueChange={(next) => {
            if (!next || next === currentLocale) return;
            const locale = next as SupportedLocale;
            localeAdapter.persist(locale);
            void setLocale(locale);
            document.documentElement.lang = locale;
            onChanged?.();
          }}
        >
          {languageOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
