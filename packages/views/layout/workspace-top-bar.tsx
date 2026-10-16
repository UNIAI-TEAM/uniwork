"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Ellipsis, Languages, Monitor, Moon, Plus, Sun } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, setLocale, type SupportedLocale } from "@uniwork/core/i18n";
import { useLocaleAdapter } from "@uniwork/core/i18n/react";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { SidebarTrigger } from "@uniwork/ui/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import {
  UI_EASE_OUT,
  UI_MOTION_DISTANCE,
  UI_MOTION_DURATION,
} from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { AskUniButton } from "../ai/ask-uni-button";
import { AskUniPanel } from "../ai/ask-uni-panel";
import { NotificationBell } from "../notifications/notification-bell";
import { SearchCommand, SearchTrigger } from "../search";
import { NewTaskDialog } from "../tasks/new-task-dialog";
import { CreateTaskDraftTray } from "../tasks/create-task-draft-tray";
import { useNavigation } from "../navigation";
import { GlobalShortcuts } from "./global-shortcuts";
import { PAGE_GUTTER } from "./page-header";
import { PreferenceToastProvider, usePreferenceSavedToast } from "./preference-toast";
import { useWorkspace } from "./workspace-context";

type ThemeValue = "light" | "dark" | "system";

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

export function WorkspaceChrome({ children }: { children: ReactNode }) {
  const [createOpen, setCreateOpen] = useState(false);
  // Stable, so the shortcut listener is not re-registered on every render.
  const openCreate = useCallback(() => setCreateOpen(true), []);
  const { pathname } = useNavigation();
  const { workspace } = useWorkspace();
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <PreferenceToastProvider>
      <WorkspaceTopBar createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      <GlobalShortcuts onCreateTask={openCreate} />
      <SearchCommand onCreateTask={openCreate} />
      <AskUniPanel />
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={pathname}
          initial={{
            opacity: 0,
            y: reduceMotion ? 0 : UI_MOTION_DISTANCE.subtle,
          }}
          animate={{ opacity: 1, y: 0 }}
          exit={{
            opacity: 0,
            y: reduceMotion ? 0 : -UI_MOTION_DISTANCE.subtle,
          }}
          transition={{
            duration: reduceMotion
              ? UI_MOTION_DURATION.micro
              : UI_MOTION_DURATION.fast,
            ease: UI_EASE_OUT,
          }}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {children}
        </motion.div>
      </AnimatePresence>
      <CreateTaskDraftTray workspaceId={workspace.id} onOpenDraft={openCreate} />
    </PreferenceToastProvider>
  );
}

/** An icon button that opens a menu, named by its tooltip and its label. */
function TopBarMenuTrigger({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("text-muted-foreground", className)}
                aria-label={label}
              />
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

export function WorkspaceTopBar({
  createOpen,
  onCreateOpenChange,
}: {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const notifySaved = usePreferenceSavedToast();
  const { workspace } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const localeAdapter = useLocaleAdapter();

  const themeValue: ThemeValue =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "system";

  const themeOptions: { value: ThemeValue; label: string }[] = [
    { value: "light", label: t("settings.preferences.themeLight") },
    { value: "dark", label: t("settings.preferences.themeDark") },
    { value: "system", label: t("settings.preferences.themeSystem") },
  ];

  const currentLocale: SupportedLocale = SUPPORTED_LOCALES.includes(i18n.language as SupportedLocale)
    ? (i18n.language as SupportedLocale)
    : DEFAULT_LOCALE;

  const languageOptions: { value: SupportedLocale; label: string }[] = [
    { value: "vi", label: t("settings.preferences.languageVi") },
    { value: "en", label: t("settings.preferences.languageEn") },
  ];

  const chooseTheme = (next: unknown) => {
    if (!next || next === themeValue) return;
    setTheme(next as ThemeValue);
    notifySaved("theme");
  };

  const chooseLocale = (next: unknown) => {
    if (!next || next === currentLocale) return;
    const locale = next as SupportedLocale;
    localeAdapter.persist(locale);
    document.documentElement.lang = locale;
    // The toast text resolves after the language switched, in the new language.
    void setLocale(locale).then(() => {
      notifySaved("language", locale);
    });
  };

  const ThemeIcon = THEME_ICONS[themeValue];
  const createLabel = t("topbar.createTask");
  const themeLabel = t("topbar.theme");
  const languageLabel = t("topbar.language");

  // The folded menu names each group; a menu of one group needs no heading.
  const themeItems = (label?: string) => (
    <DropdownMenuRadioGroup value={themeValue} onValueChange={chooseTheme}>
      {label ? <DropdownMenuLabel>{label}</DropdownMenuLabel> : null}
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
  );
  const languageItems = (label?: string) => (
    <DropdownMenuRadioGroup value={currentLocale} onValueChange={chooseLocale}>
      {label ? <DropdownMenuLabel>{label}</DropdownMenuLabel> : null}
      {languageOptions.map((option) => (
        <DropdownMenuRadioItem key={option.value} value={option.value}>
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );

  return (
    // A query container in rem, so the bar answers to its own width and to
    // the reader's text size alike: at 200% text a phone is half as wide.
    // Search, AI, notifications and + New stay on the bar at every width
    // (PRODUCT.md principle 8). Below 21rem, the width the full row needs at
    // 44px touch targets, theme and language fold into one menu and the
    // actions join the bar's own row, so they wrap one at a time, right
    // aligned, instead of running off the edge. One row is 48px tall.
    <header
      className={cn(
        "@container/topbar flex min-h-12 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5 border-b border-border bg-background py-0.5",
        PAGE_GUTTER,
      )}
    >
      <SidebarTrigger size="icon" className="text-muted-foreground" />
      <SearchTrigger className="mr-auto" />
      {/* One cluster, tight: 32px targets 2px apart, so the glyphs read as
          a toolbar rather than five loose buttons. Touch keeps 44px. */}
      <div className="flex items-center gap-0.5 @max-[21rem]/topbar:contents">
        <AskUniButton />
        <NotificationBell />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label={createLabel}
                onClick={() => onCreateOpenChange(true)}
              />
            }
          >
            <Plus aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="bottom">{createLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <TopBarMenuTrigger label={themeLabel} className="hidden @min-[21rem]/topbar:inline-flex">
            <ThemeIcon aria-hidden />
          </TopBarMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {themeItems()}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <TopBarMenuTrigger label={languageLabel} className="hidden @min-[21rem]/topbar:inline-flex">
            <Languages aria-hidden />
          </TopBarMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {languageItems()}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <TopBarMenuTrigger label={t("topbar.preferences")} className="@min-[21rem]/topbar:hidden">
            <Ellipsis aria-hidden />
          </TopBarMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {themeItems(themeLabel)}
            <DropdownMenuSeparator />
            {languageItems(languageLabel)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <NewTaskDialog
        workspaceId={workspace.id}
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        showTrigger={false}
      />
    </header>
  );
}
