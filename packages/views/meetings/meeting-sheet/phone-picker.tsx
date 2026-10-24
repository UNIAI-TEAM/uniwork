"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Member } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingAvatarTint } from "../meeting-detail/avatar-tint";
import { kitButton } from "../meeting-detail/ui/kit-buttons";
import { MeetingPersonAvatar } from "../meeting-person";
import { CONTROL, SECTION_TITLE } from "./sheet-styles";

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/**
 * The phone's people picker (CreatePhone f2, create brief §2.13): a bottom
 * sheet over the form with a search, one 44+ row per member that toggles a
 * check, the count and [Xong]. It lives inside the sheet's own popup, so the
 * dialog's focus trap and inert page leave it reachable.
 */
export function PhonePeoplePicker({
  members,
  hostId,
  chosen,
  onToggle,
  onClose,
}: {
  members: readonly Member[];
  hostId: string;
  chosen: ReadonlySet<string>;
  onToggle: (userId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);
  // Esc closes this picker only, not the sheet under it.
  useEffect(() => {
    const el = panel.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [onClose]);
  const needle = fold(query.trim());
  const rows = members.filter((m) => m.user_id !== hostId && (!needle || fold(`${m.display_name} ${m.email}`).includes(needle)));
  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end bg-scrim"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-people-picker-title"
        className="flex max-h-[85%] flex-col rounded-t-lg bg-popover px-4 pt-2 pb-[calc(34px+env(safe-area-inset-bottom))]"
        ref={panel}
      >
        <span aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
        <h3 id="sheet-people-picker-title" className={cn(SECTION_TITLE, "flex min-h-7 items-center")}>
          {t("meetings.attendees")}
        </h3>
        <div className={cn(CONTROL, "mt-3 flex items-center gap-2 focus-within:outline-2 focus-within:outline-ring")}>
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            aria-label={t("meetings.searchMembersLabel")}
            placeholder={t("meetings.searchMembers")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="mt-2 min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {rows.map((m) => {
            const on = chosen.has(m.user_id);
            return (
              <li key={m.user_id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => onToggle(m.user_id)}
                  className="-mx-2 grid h-13 w-[calc(100%+16px)] grid-cols-[28px_minmax(0,1fr)_20px] items-center gap-x-3 rounded-md px-2 text-left text-body font-medium hover:bg-surface-hover"
                >
                  <MeetingPersonAvatar name={m.display_name} avatarUrl={m.avatar_url} size={28} tint={meetingAvatarTint(m.user_id, members)} />
                  <span className="min-w-0 flex-1 truncate">{m.display_name}</span>
                  {on ? <Check aria-hidden className="size-5 text-primary" /> : <span />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-caption text-muted-foreground" aria-live="polite">
          {t("meetings.attendeesSelected", { count: chosen.size })}
        </p>
        <Button variant="outline" size="lg" className={cn(kitButton.base, kitButton.outline, "mt-2 h-11 w-full")} onClick={onClose}>
          {t("meetings.sheet.motionDone")}
        </Button>
      </div>
    </div>
  );
}
