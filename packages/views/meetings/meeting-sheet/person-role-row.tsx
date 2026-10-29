"use client";
import { useState, type ReactNode } from "react";
import { ChevronDown, Crown, Ellipsis, PenLine, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { UI_EASE_OUT, UI_POP } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { kitButton } from "../meeting-detail/ui/kit-buttons";
import { TextButton } from "../meeting-detail/ui/text-button";
import { MeetingPersonAvatar } from "../meeting-person";
import type { DraftRole } from "./draft-model";
import { MENU_ITEM_LEFT_CHECK, ROLE_CHIP } from "./sheet-styles";

export type Rsvp = "yes" | "no" | "wait";

const ROLES: readonly DraftRole[] = ["MEMBER", "SECRETARY", "OBSERVER"];

export function roleLabelKey(role: DraftRole): string {
  switch (role) {
    case "SECRETARY":
      return "meetings.governance.secretary";
    case "OBSERVER":
      return "meetings.governance.standing_OBSERVER";
    default:
      return "meetings.governance.standing_MEMBER";
  }
}

const RSVP_DOT: Record<Rsvp, string> = {
  yes: "bg-success",
  no: "bg-destructive",
  wait: "bg-background inset-ring-[1.5px] inset-ring-input",
};

/**
 * One chosen person (create brief §2.4): avatar 24, name, then the role chip
 * and × — or, for the host, a static "Chủ trì". Edit adds the RSVP dot and
 * word, and ⋯ "Gỡ khỏi cuộc họp" with its inline confirm.
 */
export function PersonRoleRow({
  name,
  avatarUrl,
  tint,
  you,
  host,
  role,
  rsvp,
  note,
  readOnly,
  onRole,
  onRemove,
  removeStyle = "x",
}: {
  name: string;
  avatarUrl?: unknown;
  tint?: Tint;
  you?: boolean;
  host?: boolean;
  role?: DraftRole;
  rsvp?: Rsvp;
  /** A caption after the name ("Thư ký tuần 43 · Giao lại vai thư ký"). */
  note?: ReactNode;
  readOnly?: boolean;
  onRole?: (role: DraftRole) => void;
  onRemove?: () => void;
  /** "menu": edit's ⋯ with an inline confirm; "x": create's ×. */
  removeStyle?: "x" | "menu";
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const reduce = useReducedMotion() ?? false;
  if (confirming) {
    return (
      <li className="flex min-h-11 items-center gap-3 max-sm:min-h-13" role="group" aria-label={t("meetings.removeParticipantTitle", { name })}>
        <span className="min-w-0 flex-1 text-body">{t("meetings.removeParticipantTitle", { name })}</span>
        <Button size="default" variant="ghost" className={cn(kitButton.sm, kitButton.ghostDanger)} onClick={onRemove}>
          {t("meetings.sheet.remove")}
        </Button>
        <Button size="default" variant="outline" autoFocus className={cn(kitButton.sm, kitButton.outline)} onClick={() => setConfirming(false)}>
          {t("meetings.sheet.keep")}
        </Button>
      </li>
    );
  }
  const rsvpWord = rsvp ? t(`meetings.sheet.rsvp_${rsvp}`) : null;
  // A person added after the sheet opened grows in 6 px up and their face pops; PeopleField's AnimatePresence keeps the first rows still.
  const grow = reduce
    ? { initial: false as const }
    : {
        initial: { opacity: 0, y: -6, maxHeight: 0, overflow: "hidden" },
        animate: { opacity: 1, y: 0, maxHeight: 52, transitionEnd: { maxHeight: "none", overflow: "visible" } },
        transition: { duration: 0.26, ease: UI_EASE_OUT },
      };
  const pop = reduce
    ? { initial: false as const }
    : { ...UI_POP, transition: { ...UI_POP.transition, delay: 0.06 } };
  return (
    <motion.li
      {...grow}
      className="grid h-11 grid-cols-[24px_minmax(0,1fr)_auto_28px] items-center gap-x-2.5 max-sm:h-13 max-sm:grid-cols-[24px_minmax(0,1fr)_auto_44px] max-sm:gap-x-3 max-sm:group-data-[mode=live]/sheet:gap-x-2"
    >
      <motion.span {...pop} className="relative inline-flex">
        <MeetingPersonAvatar name={name} avatarUrl={avatarUrl} size={24} tint={tint} />
        {rsvp ? (
          <span aria-hidden data-rsvp={rsvp} className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-popover", RSVP_DOT[rsvp])} />
        ) : null}
      </motion.span>
      {/* The edit sheet on a phone stacks the RSVP word under the name (EditScheduled at 390). */}
      <span className="min-w-0 truncate text-body font-medium max-sm:group-data-[mode=edit]/sheet:flex max-sm:group-data-[mode=edit]/sheet:flex-col max-sm:group-data-[mode=edit]/sheet:leading-4.5 max-sm:group-data-[mode=live]/sheet:flex max-sm:group-data-[mode=live]/sheet:flex-col max-sm:group-data-[mode=live]/sheet:leading-4.5">
        {name}
        {you ? (
          <>
            <span className="sr-only">, </span>
            <span className="ml-1.5 text-caption font-normal text-muted-foreground max-sm:group-data-[mode=edit]/sheet:ml-0 max-sm:group-data-[mode=live]/sheet:mt-0.5 max-sm:group-data-[mode=live]/sheet:ml-0">{t("meetings.you")}</span>
          </>
        ) : null}
        {rsvpWord ? (
          <>
            <span className="sr-only">, </span>
            <span className="ml-1.5 text-caption font-normal text-muted-foreground max-sm:group-data-[mode=edit]/sheet:ml-0 max-sm:group-data-[mode=live]/sheet:mt-0.5 max-sm:group-data-[mode=live]/sheet:ml-0">{rsvpWord}</span>
          </>
        ) : null}
        {note ? <span className="ml-1.5 text-caption font-normal text-muted-foreground max-sm:group-data-[mode=edit]/sheet:ml-0 max-sm:group-data-[mode=live]/sheet:mt-0.5 max-sm:group-data-[mode=live]/sheet:ml-0">{note}</span> : null}
      </span>
      {host ? (
        <span className={cn(ROLE_CHIP, "justify-self-end border-transparent pr-0 text-muted-foreground hover:bg-transparent max-sm:pl-0 max-sm:group-data-[mode=edit]/sheet:pl-2 max-sm:group-data-[mode=live]/sheet:h-7 max-sm:group-data-[mode=live]/sheet:pl-2 group-data-[fresh]/sheet:border-0 group-data-[fresh]/sheet:pl-0")}>
          <Crown aria-hidden />
          {t("meetings.host")}
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={readOnly}
            aria-label={t("meetings.sheet.roleAria", { name, role: t(roleLabelKey(role ?? "MEMBER")) })}
            className={cn(ROLE_CHIP, "justify-self-end group-data-[mode=live]/sheet:gap-1 group-data-[mode=live]/sheet:pr-1.5")}
          >
            {role === "SECRETARY" ? <PenLine aria-hidden /> : null}
            {t(roleLabelKey(role ?? "MEMBER"))}
            <ChevronDown aria-hidden className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-46">
            <DropdownMenuRadioGroup value={role ?? "MEMBER"} onValueChange={(v: string) => onRole?.(v as DraftRole)}>
              {ROLES.map((r) => (
                <DropdownMenuRadioItem key={r} value={r} className={MENU_ITEM_LEFT_CHECK}>
                  {t(roleLabelKey(r))}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {host || !onRemove ? (
        <span />
      ) : removeStyle === "menu" ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={readOnly}
            aria-label={t("meetings.sheet.personActions", { name })}
            render={<Button variant="ghost" size="icon-sm" className={cn(kitButton.icon, "justify-self-end")} />}
          >
            <Ellipsis aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setConfirming(true)}>{t("meetings.sheet.removeFromMeeting")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("meetings.sheet.removePerson", { name })}
          aria-disabled={readOnly || undefined}
          className={cn(kitButton.icon, "justify-self-end [&_svg]:size-3.5 max-sm:size-11 max-sm:[&_svg]:size-4")}
          onClick={() => !readOnly && onRemove()}
        >
          <X aria-hidden />
        </Button>
      )}
    </motion.li>
  );
}

/** "Hà Vũ là thư ký" under the secretary's row (kit `.pp-note`). */
export function SecretaryNote({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <li className="-mt-1.5 mb-1 ml-8.5 flex items-center gap-1.5 text-caption text-muted-foreground" aria-live="polite">
      <PenLine aria-hidden className="size-3" />
      {t("meetings.governance.secretaryAssigned", { name })}
    </li>
  );
}

/** "Giao lại vai thư ký" in a follow-up: the previous meeting's secretary, not re-assigned by itself. */
export function PreviousSecretaryNote({ week, onAssign }: { week: number | null; onAssign?: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      {week ? t("meetings.sheet.previousSecretaryWeek", { week }) : t("meetings.sheet.previousSecretary")}
      {onAssign ? (
        <>
          {" "}
          <span aria-hidden className="mx-0.5">
            ·
          </span>{" "}
          <TextButton className="py-0" onClick={onAssign}>
            {t("meetings.sheet.reassignSecretary")}
          </TextButton>
        </>
      ) : null}
    </>
  );
}
