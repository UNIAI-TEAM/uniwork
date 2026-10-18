"use client";

import { useMemo } from "react";
import {
  AlarmClock,
  ChartColumn,
  Bell,
  CircleAlert,
  Megaphone,
  Paperclip,
  Plus,
  StickyNote,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
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
      icon: typeof ChartColumn;
      labelKey: string;
      /** The kind's tint, the same one its card wears in the timeline. */
      tone: IconTileTone;
    }
  | { separator: true };

const ATTACH_MENU_ITEMS: ComposerAttachMenuItem[] = [
  { id: "attach_file", icon: Paperclip, labelKey: "composer_attach_file", tone: "gray" },
  { id: "create_poll", icon: ChartColumn, labelKey: "composer_create_poll", tone: "blue" },
  { id: "create_reminder", icon: AlarmClock, labelKey: "composer_create_reminder", tone: "teal" },
  { id: "create_note", icon: StickyNote, labelKey: "composer_create_note", tone: "yellow" },
  { id: "create_post", icon: Megaphone, labelKey: "composer_create_post", tone: "orange" },
  { separator: true },
  { id: "mark_important", icon: CircleAlert, labelKey: "composer_mark_important", tone: "warning" },
  { id: "mark_urgent", icon: Bell, labelKey: "composer_mark_urgent", tone: "destructive" },
];

const ATTACH_ITEM_CLASS = "h-11 gap-3 rounded-control px-2.5 text-foreground focus:bg-muted focus:text-foreground";

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
      // An open popover keeps its trigger in the brand wash.
      className={cn(
        "size-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground [&_svg:not([class*='size-'])]:size-5.5",
        className,
      )}
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
          <ComposerToolbarButton
            label={t("chat.composer_attach")}
            disabled={disabled}
            // Open, the + turns into an × on the brand wash (canvas).
            className="size-12 bg-chat-bubble-other shadow-chat-bubble hover:bg-muted aria-expanded:text-brand aria-expanded:ring-2 aria-expanded:ring-primary aria-expanded:[&_svg]:rotate-45 [&_svg]:transition-transform [&_svg]:duration-(--duration-fast)"
          >
            <Plus aria-hidden />
          </ComposerToolbarButton>
        }
      />
      <DropdownMenuContent
        align={align}
        side="top"
        sideOffset={8}
        className="w-67 rounded-xl p-1.5"
        aria-label={t("chat.composer_attach_menu")}
      >
        {createItems.map((item) => (
          <DropdownMenuItem
            key={item.id}
            className={ATTACH_ITEM_CLASS}
            // Opens the file picker inside the click's user-gesture stack.
            onClick={() => onAction(item.id)}
          >
            <IconTile icon={item.icon} size="sm" tone={item.tone} className="[&_svg]:size-4" />
            {t(`chat.${item.labelKey}`)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="mx-1" />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex h-7.5 items-center px-2.5 font-semibold">
            {t("chat.composer_flag_group")}
          </DropdownMenuLabel>
          {flagItems.map((item) => (
            <DropdownMenuItem key={item.id} className={ATTACH_ITEM_CLASS} onClick={() => onAction(item.id)}>
              <IconTile icon={item.icon} size="sm" tone={item.tone} className="[&_svg]:size-4" />
              {t(`chat.${item.labelKey}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
