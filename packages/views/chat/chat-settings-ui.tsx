"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, BarChart3, ChevronDown, Clock, Pencil, StickyNote, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { SheetClose } from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";

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
    <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
      {leading}
      <p className="min-w-0 flex-1 truncate text-title-sm font-semibold text-foreground">{title}</p>
      <div className="flex shrink-0 items-center gap-0.5">
        {onEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={editAriaLabel}
            title={editAriaLabel}
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
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("common.close")}
            />
          }
        >
          <X className="size-4" aria-hidden />
        </SheetClose>
      </div>
    </div>
  );
}

/** The row of round quick toggles under a settings title (mute, pin, manage…). */
export function ChatSettingsQuickActions({ children }: { children: ReactNode }) {
  return <div className="flex justify-center gap-2 border-b border-border px-4 py-3">{children}</div>;
}

/**
 * A round toggle with its label under it. `active` is a real pressed state
 * (aria-pressed) and reads as the brand wash; the label says what the button
 * does, so it does not change with the state. A button that shows or hides a
 * section instead passes `controls` (the section's id): it then reports
 * aria-expanded, not a pressed state.
 */
export function ChatSettingsQuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  controls,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={controls ? undefined : active}
      aria-expanded={controls ? Boolean(active) : undefined}
      aria-controls={controls && active ? controls : undefined}
      className="group/qa flex w-20 min-w-0 flex-col items-center gap-1.5 rounded-lg px-1 py-1 text-center disabled:pointer-events-none disabled:opacity-50"
    >
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full transition-colors duration-(--duration-fast)",
          active
            ? "bg-brand-subtle text-brand-subtle-foreground"
            : "bg-muted text-foreground group-hover/qa:bg-surface-hover",
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
  flush = false,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Children are full-width menu rows that carry their own padding. */
  flush?: boolean;
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
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-label font-semibold text-foreground">{title}</span>
          {!open && summary ? (
            <span className="mt-1 block text-caption text-muted-foreground">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={panelId} className={flush ? "pb-2" : "space-y-3 px-4 pb-4"}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A full-width settings row: icon, label, the whole row is the target. A
 * disabled row carries `disabledReason`, shown under the label and read as
 * the button's description.
 */
export function ChatSettingsMenuRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  disabledReason,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const reasonId = useId();
  const reason = disabled ? disabledReason : undefined;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-describedby={reason ? reasonId : undefined}
      className="flex min-h-10 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover disabled:cursor-not-allowed disabled:hover:bg-transparent pointer-coarse:min-h-11"
      onClick={onClick}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className={cn("block text-body", disabled ? "text-muted-foreground" : "text-foreground")}>{label}</span>
        {reason ? (
          <span id={reasonId} className="block text-caption text-muted-foreground">
            {reason}
          </span>
        ) : null}
      </span>
    </button>
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
    <ChatSettingsCollapsibleSection title={title} flush>
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

/** One person in a settings list: face, name, one line of context, row actions. */
export function ChatMemberRow({
  avatar,
  name,
  detail,
  actions,
}: {
  avatar: ReactNode;
  name: string;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="flex min-h-12 items-center gap-3 px-4 py-1.5">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-foreground">{name}</p>
        {detail ? <p className="truncate text-caption text-muted-foreground">{detail}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </li>
  );
}

/** Members failed to load: say so and offer a retry — never an empty list or a count. */
export function ChatMemberListError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Notice
      tone="destructive"
      icon={AlertCircle}
      layout="inline"
      live="assertive"
      className="mx-4 my-1"
      action={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      }
    >
      {t("chat.members_load_failed")}
    </Notice>
  );
}

/** Members are loading: rows in their own shape, never "0 members". */
export function ChatMemberListSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-1 py-1" aria-busy>
      <span className="sr-only">{label}</span>
      {["w-32", "w-24", "w-28"].map((w) => (
        <div key={w} className="flex items-center gap-3 px-4 py-1.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
