"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CircleAlert,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  Pencil,
  Shield,
  StickyNote,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconTile, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { SheetClose } from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import { ChatMemberProfileTrigger } from "./chat-member-profile";
import { ChatRoomPhoto } from "./chat-room-mark";
import { usePresenceStore } from "@uniwork/core/chat/presence-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { initialsOf } from "./chat-initials";
import { chatPersonFaceClass } from "./chat-person-card";
import { ChatPresenceAvatar } from "./chat-presence-avatar";

/** A 44px ghost icon button on a settings row or header (close, rename, nickname, member menu). */
export const chatSettingsIconButtonClass = "size-11 shrink-0 rounded-lg text-muted-foreground hover:text-foreground";

/** The sheet's fixed top bar: what the sheet is, and the way out. */
export function ChatSettingsHeader({ title, leading }: { title: string; leading?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex h-16 shrink-0 items-center gap-3 border-b border-border pr-2.5", leading ? "pl-4" : "pl-5")}>
      {leading}
      <p className="min-w-0 flex-1 truncate font-display text-title font-bold text-foreground">{title}</p>
      <SheetClose
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={chatSettingsIconButtonClass}
            aria-label={t("common.close")}
          />
        }
      >
        <X className="size-5" aria-hidden />
      </SheetClose>
    </div>
  );
}

/** A member's 40px face on a settings list: photo or two letters in their tint, and the dot while they are online. */
export function ChatMemberFace({ userId, name, avatarUrl }: { userId: string; name: string; avatarUrl?: string | null }) {
  const online = usePresenceStore((state) => Boolean(state.onlineUserIds[normalizeTypingUserId(userId)]));
  return (
    <ChatPresenceAvatar
      name={name}
      initials={initialsOf(name)}
      avatarUrl={avatarUrl}
      size="fluid"
      avatarClassName={cn("size-10 text-label", chatPersonFaceClass(userId))}
      online={online}
    />
  );
}

/** The room's 68px squircle on a settings hero, in the colour its sidebar row wears (or a group's photo). */
export function ChatSettingsRoomMark({ icon, tint, imageUrl }: { icon: LucideIcon; tint: Tint; imageUrl?: string }) {
  return (
    <ChatRoomPhoto src={imageUrl} className="size-17 rounded-2xl">
      <IconTile icon={icon} tone={tint} variant="solid" size="lg" className="size-17 rounded-2xl [&_svg]:size-8" />
    </ChatRoomPhoto>
  );
}

/** Who or what the sheet is about: big mark, name (with its rename pencil), one or two lines under it. */
export function ChatSettingsHero({
  mark,
  name,
  subtitle,
  onEdit,
  editAriaLabel,
}: {
  mark: ReactNode;
  name: string;
  subtitle?: ReactNode;
  onEdit?: () => void;
  editAriaLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center px-5 pt-3 pb-1.5 text-center">
      {mark}
      <div className="mt-2.5 flex h-9 max-w-full items-center justify-center">
        <p className="min-w-0 truncate font-display text-title font-bold text-foreground">{name}</p>
        {onEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(chatSettingsIconButtonClass, "-my-1 -mr-2.5")}
            aria-label={editAriaLabel}
            title={editAriaLabel}
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
      {subtitle ? <div className="flex flex-col items-center text-body text-muted-foreground">{subtitle}</div> : null}
    </div>
  );
}

/** The row of round quick toggles under the hero (mute, pin, manage…). */
export function ChatSettingsQuickActions({ children }: { children: ReactNode }) {
  return <div className="flex justify-center gap-2 px-4 pt-0.5 pb-4">{children}</div>;
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
      className="group/qa flex w-22 min-w-0 shrink flex-col items-center gap-1.5 rounded-lg text-center disabled:pointer-events-none disabled:opacity-50"
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
      <span
        className={cn(
          "line-clamp-2 h-8 text-caption",
          active ? "font-semibold text-brand" : "font-medium text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** One block of the sheet, set off from the one above by the 8px muted band. */
export function ChatSettingsSection({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("border-t-8 border-muted", className)}>{children}</section>;
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
    <ChatSettingsSection>
      <button
        type="button"
        className="flex min-h-13 w-full items-center gap-3 py-2.5 pr-5.5 pl-5 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-body-lg font-semibold text-foreground">{title}</span>
          {!open && summary ? (
            <span className="mt-0.5 block text-label text-muted-foreground">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "size-4.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={panelId} className={flush ? "pb-2" : "space-y-3 px-5 pb-4"}>
          {children}
        </div>
      ) : null}
    </ChatSettingsSection>
  );
}

/**
 * A full-width settings row: icon, label, chevron; the whole row is the
 * target. An `action` row does something here instead of opening somewhere,
 * so it reads in the brand colour without the chevron. A disabled row carries
 * `disabledReason`, shown under the label and read as the button's description.
 */
export function ChatSettingsMenuRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  disabledReason,
  action = false,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  action?: boolean;
  /** A quiet word before the chevron naming where the row leads ("Bảng tin"). */
  hint?: string;
}) {
  const reasonId = useId();
  const reason = disabled ? disabledReason : undefined;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-describedby={reason ? reasonId : undefined}
      className="flex min-h-12 w-full items-center gap-3.5 py-2 pr-4 pl-5 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover disabled:cursor-not-allowed disabled:hover:bg-transparent"
      onClick={onClick}
    >
      <Icon className={cn("size-5 shrink-0", action ? "text-brand" : "text-muted-foreground")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-body-lg",
            disabled ? "text-muted-foreground" : action ? "font-medium text-brand" : "text-foreground",
          )}
        >
          {label}
        </span>
        {reason ? (
          <span id={reasonId} className="block text-caption text-muted-foreground">
            {reason}
          </span>
        ) : null}
      </span>
      {hint ? <span className="shrink-0 text-label text-muted-foreground">{hint}</span> : null}
      {action ? null : <ChevronRight className="size-4.5 shrink-0 text-faint-foreground" aria-hidden />}
    </button>
  );
}

/** Who may change what is shown above: a tinted note with a lock. */
export function ChatSettingsNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-label text-pretty text-muted-foreground",
        className,
      )}
    >
      <Lock className="mt-px size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
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
        <ChatSettingsMenuRow icon={ChartColumn} label={pollsLabel} onClick={onPolls} />
      ) : null}
    </ChatSettingsCollapsibleSection>
  );
}

/** How a member's context line reads: room admin in brand, send-restricted as a warning. */
export type ChatMemberDetailTone = "admin" | "restricted" | "owner";

const DETAIL_TONE_CLASS: Record<ChatMemberDetailTone | "plain", string> = {
  admin: "font-semibold text-brand",
  restricted: "text-warning-soft-foreground",
  owner: "font-semibold text-muted-foreground",
  plain: "text-muted-foreground",
};

/** One person in a settings list: face, name, one line of context, row actions. */
export function ChatMemberRow({
  avatar,
  name,
  detail,
  detailTone,
  actions,
  profile,
}: {
  avatar: ReactNode;
  name: string;
  detail?: ReactNode;
  detailTone?: ChatMemberDetailTone;
  actions?: ReactNode;
  /** Click opens their address and, for someone else, a direct message. */
  profile?: { userId?: string; email?: string; avatarUrl?: string; onMessage?: () => void };
}) {
  const identity = (
    <>
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-lg font-medium text-foreground">{name}</p>
        {detail ? (
          <p className={cn("flex min-w-0 items-center gap-1 text-caption", DETAIL_TONE_CLASS[detailTone ?? "plain"])}>
            {detailTone === "admin" ? <Shield className="size-3 shrink-0" aria-hidden /> : null}
            <span className="truncate">{detail}</span>
          </p>
        ) : null}
      </div>
    </>
  );
  return (
    <li className="flex min-h-13.5 items-center gap-1 py-1 pr-2 pl-5 has-[[data-popup-open]]:bg-muted">
      {profile ? (
        <ChatMemberProfileTrigger
          name={name}
          email={profile.email}
          detail={typeof detail === "string" ? detail : undefined}
          userId={profile.userId}
          avatarUrl={profile.avatarUrl}
          onMessage={profile.onMessage}
        >
          {identity}
        </ChatMemberProfileTrigger>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
      )}
      {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
    </li>
  );
}

/** Members failed to load: say so and offer a retry — never an empty list or a count. */
export function ChatMemberListError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Notice
      tone="destructive"
      icon={CircleAlert}
      layout="inline"
      live="assertive"
      className="mx-5 my-1"
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
        <div key={w} className="flex min-h-13.5 items-center gap-3 px-5 py-1">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
