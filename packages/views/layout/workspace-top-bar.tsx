"use client";

import { useCallback, useState, type ReactNode } from "react";
import { BriefcasePlus, Ellipsis, Languages, Monitor, Moon, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, setLocale, type SupportedLocale } from "@uniwork/core/i18n";
import { useFlag } from "@uniwork/core/feature-flags";
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
import { SidebarTrigger, useSidebar } from "@uniwork/ui/components/ui/sidebar";
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
import { AskUniDock } from "../ai/ask-uni-dock";
import { AskUniLegacyPanel } from "../ai/ask-uni-legacy-panel";
import { NotificationBell } from "../notifications/notification-bell";
import { SearchCommand, SearchTrigger } from "../search";
import { NewTaskDialog } from "../tasks/new-task-dialog";
import { CreateTaskDraftTray } from "../tasks/create-task-draft-tray";
import { useNavigation } from "../navigation";
import { AccountMenu } from "./account-menu";
import { GlobalShortcuts } from "./global-shortcuts";
import { PAGE_GUTTER } from "./page-header";
import { PreferenceToastProvider, usePreferenceSavedToast } from "./preference-toast";
import { useWorkspace } from "./workspace-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

type ThemeValue = "light" | "dark" | "system";

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

/**
 * The bar across the top of the app, and under it the row of `nav` and the
 * content, which `frame` wraps (the host's main landmark). `bare` is the
 * UniChat shell: no top bar (the rail holds its menus), the shortcuts and
 * dialogs stay.
 */
export function WorkspaceChrome({
  children,
  bare = false,
  nav,
  frame = (content) => content,
}: {
  children: ReactNode;
  bare?: boolean;
  nav?: ReactNode;
  frame?: (content: ReactNode) => ReactNode;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  // Stable, so the shortcut listener is not re-registered on every render.
  const openCreate = useCallback(() => setCreateOpen(true), []);
  const { pathname } = useNavigation();
  const { workspace } = useWorkspace();
  const reduceMotion = useReducedMotion() ?? false;
  // The UniChat shell keeps the overlay panel; the docked one is for the workspace layout.
  const docked = useFlag("ask_uni_stream", false) && !bare;
  // The page the shell opened on appears as is; a route moved to fades in.
  const [firstPathname] = useState(pathname);
  // Enter only, no AnimatePresence exit: children is the host's route
  // slot, which already renders the NEW route, so an exiting copy would
  // mount the next page once inside it and again when the exit ends —
  // and a deep link (?message=, ?comment=) consumed by the first mount
  // was lost with it (UNI-1814).
  const page = (
    <motion.div
      key={pathname}
      initial={pathname === firstPathname ? false : { opacity: 0, y: reduceMotion ? 0 : UI_MOTION_DISTANCE.subtle }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? UI_MOTION_DURATION.micro : UI_MOTION_DURATION.fast,
        ease: UI_EASE_OUT,
      }}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </motion.div>
  );
  return (
    <PreferenceToastProvider>
      {bare ? (
        <NewTaskDialog workspaceId={workspace.id} open={createOpen} onOpenChange={setCreateOpen} showTrigger={false} />
      ) : (
        <WorkspaceTopBar createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      )}
      <GlobalShortcuts onCreateTask={openCreate} />
      <SearchCommand onCreateTask={openCreate} />
      {docked ? null : <AskUniLegacyPanel />}
      <div className="flex min-h-0 min-w-0 flex-1">
        {nav}
        {frame(
          <AskUniDock enabled={docked} framed={!bare}>
            {page}
            {/* The draft tray is the content card's own foot, as ClickUp's is. */}
            <CreateTaskDraftTray workspaceId={workspace.id} onOpenDraft={openCreate} />
          </AskUniDock>,
        )}
      </div>
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

/**
 * Theme and language as menu radio groups, saved with the preference toast:
 * the top bar's menus and the UniChat rail's settings menu share them.
 */
function usePreferenceMenuItems() {
  const { t, i18n } = useTranslation();
  const notifySaved = usePreferenceSavedToast();
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
  return { ThemeIcon, themeItems, languageItems };
}

export function WorkspaceTopBar({
  createOpen,
  onCreateOpenChange,
}: {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { isCompact } = useSidebar();
  const { ThemeIcon, themeItems, languageItems } = usePreferenceMenuItems();
  const createLabel = t("topbar.createTask");
  const themeLabel = t("topbar.theme");
  const languageLabel = t("topbar.language");

  // One cluster, tight: 32px targets 2px apart, so the glyphs read as
  // a toolbar rather than five loose buttons. Touch keeps 44px.
  const actions = (
    <div className="flex items-center gap-0.5 @max-[21rem]/topbar:contents">
      {isCompact ? <AskUniButton /> : null}
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
          <BriefcasePlus aria-hidden />
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
  );

  return (
    // A query container in rem, so the bar answers to its own width and to
    // the reader's text size alike: at 200% text a phone is half as wide.
    // Search, AI, notifications and + New stay on the bar at every width
    // (PRODUCT.md principle 8). Below 21rem, the width the full row needs at
    // 44px touch targets, theme and language fold into one menu and the
    // actions join the bar's own row, so they wrap one at a time, right
    // aligned, instead of running off the edge. One row is 48px tall.
    //
    // On a desktop shell the bar sits on the app plane above the three cards,
    // as in ClickUp: workspace switcher at the start, search in the middle,
    // actions and the account at the end; the sidebar toggle lives in the
    // sidebar card. A compact shell keeps the toggle here, because its sidebar
    // is a sheet, and the switcher and account inside that sheet.
    <header
      className={cn(
        "@container/topbar flex min-h-12 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5 border-b border-border bg-background py-0.5 lg:border-b-0 lg:bg-transparent lg:px-2",
        PAGE_GUTTER,
      )}
    >
      {isCompact ? (
        <>
          <SidebarTrigger size="icon" className="text-muted-foreground" />
          <SearchTrigger className="mr-auto" />
          {actions}
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 items-center">
            <WorkspaceSwitcher current={workspace} placement="header" />
          </div>
          {/* One field on the app plane, as in ClickUp: search, then the AI pill at its end. The field carries
              the surface, or it sinks into the grey. */}
          {/* Hover lifts the whole field, pill included (its cover follows group/field). Light lifts by edge and
              shadow, since its hover grey is the app plane's; dark has no visible shadow, so it lifts by fill. */}
          <div className="group/field flex h-8 w-96 items-center rounded-full border border-border bg-page-canvas pe-1 transition-[background-color,border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm dark:hover:bg-surface-hover">
            <SearchTrigger className="h-full min-w-0 flex-1 rounded-s-full rounded-e-none bg-transparent hover:bg-transparent sm:w-auto dark:hover:bg-transparent" />
            <AskUniButton labeled />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            {actions}
            <AccountMenu placement="header" />
          </div>
        </>
      )}
      <NewTaskDialog
        workspaceId={workspace.id}
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        showTrigger={false}
      />
    </header>
  );
}
