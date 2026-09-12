"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { SidebarTrigger } from "@uniwork/ui/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { AskUniButton } from "../ai/ask-uni-button";
import { AskUniPanel } from "../ai/ask-uni-panel";
import { NotificationBell } from "../notifications/notification-bell";
import { SearchCommand } from "../search";
import { NewTaskDialog } from "../tasks/new-task-dialog";
import { PAGE_GUTTER } from "./page-header";
import { LocaleMenu, ThemeMenu } from "./preference-menus";
import { useWorkspace } from "./workspace-context";

export function WorkspaceChrome({ children }: { children: ReactNode }) {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <>
      <WorkspaceTopBar createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      <SearchCommand onCreateTask={() => setCreateOpen(true)} />
      <AskUniPanel />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
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
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const savedToast = () =>
    toast.success(t("settings.preferences.toastSaved"), { id: "settings-auto-save" });

  const createLabel = t("topbar.createTask");

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
      <ThemeMenu onChanged={savedToast} className="h-8 w-8" />
      <LocaleMenu onChanged={savedToast} className="h-8 w-8" />
      <NewTaskDialog
        workspaceId={workspace.id}
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        showTrigger={false}
      />
    </header>
  );
}
