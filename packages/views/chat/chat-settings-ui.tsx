"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BarChart3, ChevronDown, Clock, Pencil, StickyNote, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { SheetClose } from "@uniwork/ui/components/ui/sheet";
import { cn } from "@uniwork/ui/lib/utils";

export function ChatSettingsTitleRow({
  title,
  leading,
  onEdit,
  editAriaLabel,
}: {
  title: string;
  leading?: ReactNode;
  onEdit?: () => void;
  editAriaLabel?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-4">
      {leading}
      <p className="min-w-0 flex-1 truncate text-title font-semibold text-foreground">{title}</p>
      <div className="flex shrink-0 items-center gap-0.5">
        {onEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-9 shrink-0 rounded-full bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={editAriaLabel}
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
        ) : null}
        <SheetClose
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-9 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("chat.settings_close")}
            />
          }
        >
          <X className="size-4" aria-hidden />
        </SheetClose>
      </div>
    </div>
  );
}

export function ChatSettingsQuickActions({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-4 gap-2 border-b border-border px-3 py-4">{children}</div>
  );
}

export function ChatSettingsQuickActionsDm({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center gap-6 border-b border-border px-4 py-4">{children}</div>
  );
}

export function ChatSettingsQuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col items-center gap-2 px-1 py-1 text-center",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-full text-foreground transition-colors",
          active ? "bg-brand/15 text-brand ring-1 ring-brand/30" : "bg-muted/70",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="line-clamp-2 text-caption leading-snug text-foreground">{label}</span>
    </button>
  );
}

export function ChatSettingsCollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const panelId = useId();
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <section className="border-b border-border">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/50"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-foreground">{title}</span>
          {!open && summary ? (
            <span className="mt-1 block text-caption text-muted-foreground">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={panelId} className="space-y-3 px-4 pb-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function ChatSettingsMenuRow({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left",
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/60",
      )}
      onClick={onClick}
    >
      <Icon className="size-5 shrink-0 text-foreground" aria-hidden />
      <span className="text-body text-foreground">{label}</span>
    </button>
  );
}

export function ChatSettingsBulletinEntry({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <section className="border-b border-border">
      <ChatSettingsMenuRow icon={StickyNote} label={label} onClick={onClick} />
    </section>
  );
}

export function ChatSettingsBulletinSection({
  title,
  remindersLabel,
  notesLabel,
  pollsLabel,
  showReminders,
  showNotes,
  showPolls,
  onReminders,
  onNotes,
  onPolls,
}: {
  title: string;
  remindersLabel: string;
  notesLabel: string;
  pollsLabel: string;
  showReminders: boolean;
  showNotes: boolean;
  showPolls: boolean;
  onReminders: () => void;
  onNotes: () => void;
  onPolls: () => void;
}) {
  if (!showReminders && !showNotes && !showPolls) return null;

  return (
    <ChatSettingsCollapsibleSection title={title}>
      {showReminders ? (
        <ChatSettingsMenuRow icon={Clock} label={remindersLabel} onClick={onReminders} />
      ) : null}
      {showNotes ? (
        <ChatSettingsMenuRow icon={StickyNote} label={notesLabel} onClick={onNotes} />
      ) : null}
      {showPolls ? (
        <ChatSettingsMenuRow icon={BarChart3} label={pollsLabel} onClick={onPolls} />
      ) : null}
    </ChatSettingsCollapsibleSection>
  );
}
