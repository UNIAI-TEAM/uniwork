"use client";

import { useMemo } from "react";
import {
  BarChart3,
  Bell,
  CircleAlert,
  Clock,
  FileUp,
  Megaphone,
  Paperclip,
  StickyNote,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";

export type ComposerAttachAction =
  | "attach_file"
  | "create_poll"
  | "create_reminder"
  | "create_note"
  | "create_post"
  | "mark_important"
  | "mark_urgent"
  | "stickers"
  | "voice"
  | "location";

type ComposerAttachMenuItem =
  | {
      id: ComposerAttachAction;
      icon: typeof BarChart3;
      labelKey: string;
    }
  | { separator: true };

const ATTACH_MENU_ITEMS: ComposerAttachMenuItem[] = [
  { id: "attach_file", icon: FileUp, labelKey: "composer_attach_file" },
  { id: "create_poll", icon: BarChart3, labelKey: "composer_create_poll" },
  { id: "create_reminder", icon: Clock, labelKey: "composer_create_reminder" },
  { id: "create_note", icon: StickyNote, labelKey: "composer_create_note" },
  { id: "create_post", icon: Megaphone, labelKey: "composer_create_post" },
  { separator: true },
  { id: "mark_important", icon: CircleAlert, labelKey: "composer_mark_important" },
  { id: "mark_urgent", icon: Bell, labelKey: "composer_mark_urgent" },
];

export function ComposerToolbarButton({
  label,
  disabled,
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn("shrink-0 text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

function filterAttachMenuItems(
  items: ComposerAttachMenuItem[],
  showCreatePoll: boolean,
): ComposerAttachMenuItem[] {
  if (showCreatePoll) return items;
  return items.filter((item) => !("id" in item) || item.id !== "create_poll");
}

export function ComposerAttachMenu({
  disabled,
  onAction,
  align = "end",
  showCreatePoll = true,
}: {
  disabled?: boolean;
  onAction: (action: ComposerAttachAction) => void;
  align?: "start" | "end";
  showCreatePoll?: boolean;
}) {
  const { t } = useTranslation();
  const menuItems = useMemo(
    () => filterAttachMenuItems(ATTACH_MENU_ITEMS, showCreatePoll),
    [showCreatePoll],
  );
  const actions = menuItems.filter((item) => !("separator" in item)) as Array<
    Extract<ComposerAttachMenuItem, { id: ComposerAttachAction }>
  >;
  const isFlag = (id: ComposerAttachAction) => id === "mark_important" || id === "mark_urgent";
  const createItems = actions.filter((item) => !isFlag(item.id));
  const flagItems = actions.filter((item) => isFlag(item.id));

  // The registry menu: arrow keys, typeahead and focus return come with it.
  // Creating content and flagging the message are two kinds of action, so
  // the flags sit in their own labelled group.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <ComposerToolbarButton label={t("chat.composer_attach")} disabled={disabled}>
            <Paperclip aria-hidden className="size-5" />
          </ComposerToolbarButton>
        }
      />
      <DropdownMenuContent align={align} side="top" className="w-60" aria-label={t("chat.composer_attach_menu")}>
        {createItems.map((item) => (
          <DropdownMenuItem
            key={item.id}
            className="gap-2.5 py-1.5"
            // Opens the file picker inside the click's user-gesture stack.
            onClick={() => onAction(item.id)}
          >
            <item.icon aria-hidden className="size-4 text-muted-foreground" />
            {t(`chat.${item.labelKey}`)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("chat.composer_flag_group")}</DropdownMenuLabel>
          {flagItems.map((item) => (
            <DropdownMenuItem key={item.id} className="gap-2.5 py-1.5" onClick={() => onAction(item.id)}>
              <item.icon aria-hidden className="size-4 text-muted-foreground" />
              {t(`chat.${item.labelKey}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
