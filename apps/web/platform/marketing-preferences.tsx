"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Languages, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { marketingHref } from "@uniwork/core/paths";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { persistMarketingLocale, useMarketingLocale } from "./marketing-context";

export function MarketingPreferences() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const locale = useMarketingLocale();
  const pathname = usePathname() ?? "/";
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const mode = mounted && (theme === "light" || theme === "dark") ? theme : "system";
  const Icon = { light: Sun, dark: Moon, system: Monitor }[mode];
  return <>
    <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-lg" aria-label={t("topbar.theme")} />}><Icon aria-hidden className="size-4 text-muted-foreground" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={mode} onValueChange={value => { if (value) setTheme(value); }}>
        {(["light", "dark", "system"] as const).map(value => <DropdownMenuRadioItem key={value} value={value}>{t(`settings.preferences.theme${value === "light" ? "Light" : value === "dark" ? "Dark" : "System"}`)}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup></DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-lg" aria-label={t("topbar.language")} />}><Languages aria-hidden className="size-4 text-muted-foreground" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">{(["vi", "en"] as const).map(value => <DropdownMenuItem key={value} render={<a aria-label={value === "vi" ? "Tiếng Việt" : "English"} href={marketingHref(pathname, value)} hrefLang={value} lang={value} aria-current={value === locale ? "page" : undefined} onClick={() => persistMarketingLocale(value)} />}>
        {value === "vi" ? "Tiếng Việt" : "English"}{value === locale && <Check aria-hidden className="size-4" />}
      </DropdownMenuItem>)}</DropdownMenuContent>
    </DropdownMenu>
  </>;
}
