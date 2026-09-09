"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  CircleAlert,
  Clock,
  FileUp,
  Paperclip,
  StickyNote,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";

export type ComposerAttachAction =
  | "attach_file"
  | "create_poll"
  | "create_reminder"
  | "create_note"
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
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        className,
      )}
      {...props}
    >
      {children}
    </button>
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
  const [open, setOpen] = useState(false);
  const menuItems = useMemo(
    () => filterAttachMenuItems(ATTACH_MENU_ITEMS, showCreatePoll),
    [showCreatePoll],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <ComposerToolbarButton label={t("chat.composer_attach")} disabled={disabled}>
            <Paperclip aria-hidden className="size-5" />
          </ComposerToolbarButton>
        }
      />
      <PopoverContent align={align} side="top" className="w-72 p-1">
        <ul className="flex flex-col" role="menu" aria-label={t("chat.composer_attach_menu")}>
          {menuItems.map((item, index) =>
            "separator" in item ? (
              <li key={`sep-${index}`} role="separator" className="my-1 h-px bg-border" />
            ) : (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-body text-foreground",
                    "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  )}
                  onClick={() => {
                    // Open the file picker while still inside the user-gesture
                    // stack; closing the popover first can cancel the dialog.
                    onAction(item.id);
                    setOpen(false);
                  }}
                >
                  <item.icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                  <span>{t(`chat.${item.labelKey}`)}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
