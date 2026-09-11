"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Languages, Monitor, Moon, Plus, Sun } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { SearchCommand } from "../search";
import { NewTaskDialog } from "../tasks/new-task-dialog";
import { useNavigation } from "../navigation";
import { PAGE_GUTTER } from "./page-header";
import { useWorkspace } from "./workspace-context";

type ThemeValue = "light" | "dark" | "system";

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

export function WorkspaceChrome({ children }: { children: ReactNode }) {
  const [createOpen, setCreateOpen] = useState(false);
  const { pathname } = useNavigation();
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <>
      <WorkspaceTopBar createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      <SearchCommand onCreateTask={() => setCreateOpen(true)} />
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
    </>
  );
}

function IconTooltipButton({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            aria-label={label}
            {...props}
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

  const ThemeIcon = THEME_ICONS[themeValue];
  const createLabel = t("topbar.createTask");
  const themeLabel = t("topbar.theme");
  const languageLabel = t("topbar.language");

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background",
        PAGE_GUTTER,
      )}
    >
      <SidebarTrigger size="icon" />
      <div className="flex-1" />
      <AskUniButton />
      <NotificationBell />
      <IconTooltipButton label={createLabel} onClick={() => onCreateOpenChange(true)}>
        <Plus aria-hidden className="size-4" />
      </IconTooltipButton>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8"
                    aria-label={themeLabel}
                  />
                }
              />
            }
          >
            <ThemeIcon aria-hidden className="size-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{themeLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuRadioGroup
            value={themeValue}
            onValueChange={(next) => {
              if (!next || next === themeValue) return;
              setTheme(next as ThemeValue);
              toast.success(t("settings.preferences.toastSaved"), { id: "settings-auto-save" });
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
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8"
                    aria-label={languageLabel}
                  />
                }
              />
            }
          >
            <Languages aria-hidden className="size-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{languageLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuRadioGroup
            value={currentLocale}
            onValueChange={(next) => {
              if (!next || next === currentLocale) return;
              const locale = next as SupportedLocale;
              localeAdapter.persist(locale);
              void setLocale(locale);
              document.documentElement.lang = locale;
              toast.success(t("settings.preferences.toastSaved"), { id: "settings-auto-save" });
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
      <NewTaskDialog
        workspaceId={workspace.id}
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        showTrigger={false}
      />
    </header>
  );
}
