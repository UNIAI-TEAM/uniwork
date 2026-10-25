"use client";
import { useId } from "react";
import { Captions, ChevronDown, CircleQuestionMark, Eye, ListChecks, Lock, MessageSquareText, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { scribePolicyOf, type MeetingCapabilities } from "@uniwork/core/types/meeting";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";
import { MENU_ITEM_LEFT_CHECK } from "./sheet-styles";

/** What the block shows: the switch, the locked switch (policy off) or nothing (no capability). */
export function scribeAvailability(caps: MeetingCapabilities | undefined): "on" | "locked" | "hidden" {
  if (caps?.scribe === true) return "on";
  if (caps?.scribe === false && scribePolicyOf(caps.scribe_policy) === "off") return "locked";
  return "hidden";
}

/** The policy's starting value: on starts with the scribe, opt_in without it. */
export function scribePolicyDefault(caps: MeetingCapabilities | undefined): boolean {
  return scribePolicyOf(caps?.scribe_policy) === "on";
}

const HELP: readonly { icon: LucideIcon; key: string }[] = [
  { icon: Captions, key: "meetings.scribe.helpCaptions" },
  { icon: MessageSquareText, key: "meetings.scribe.helpTranscript" },
  { icon: ListChecks, key: "meetings.scribe.helpSummary" },
];

/** "?" beside the name: what the scribe does, on hover, on tap and from the keyboard. */
function ScribeHelp() {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={t("meetings.scribe.helpTitle")}
        // A 44 hit area on touch drawn as an overlay, so the row keeps its height and the name its line.
        className="relative grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground data-[popup-open]:text-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']"
      >
        <CircleQuestionMark aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-4">
        <p className="flex items-center gap-2 text-body font-semibold">
          <ScribeMark size={20} />
          {t("meetings.scribe.helpTitle")}
        </p>
        <ul className="space-y-2">
          {HELP.map(({ icon: Icon, key }) => (
            <li key={key} className="flex gap-2.5 text-body">
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-tint-violet-foreground" />
              <span className="text-pretty">{t(key)}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-border pt-2.5 text-caption text-pretty text-muted-foreground">{t("meetings.scribe.helpQuiet")}</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Thư ký UNI (create brief §2.7): one line on a card of its own — the violet
 * mark, the name with a "?" that says what it does, and — while on — who reads the summary and transcript as a
 * quiet menu before the switch. Policy off draws the switch locked with the
 * reason. Where the audio is processed is said only in the organization's
 * settings.
 */
export function ScribeBlock({
  caps,
  value,
  onChange,
  shared,
  onShared,
  workspaceName,
  live = false,
  variant = "sheet",
  readOnly = false,
}: {
  caps: MeetingCapabilities | undefined;
  value: boolean;
  onChange: (on: boolean) => void;
  shared?: boolean;
  onShared?: (shared: boolean) => void;
  workspaceName?: string;
  /** Edit while live: switching off sends the scribe out of the room at once. */
  live?: boolean;
  /** "instant": no sharing row (Họp ngay). */
  variant?: "sheet" | "instant";
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const availability = scribeAvailability(caps);
  if (availability === "hidden") return null;
  const locked = availability === "locked";
  const on = locked ? false : value;
  const shareValue = t(shared ? "meetings.sheet.shareWorkspace" : "meetings.sheet.shareMeeting");
  const share =
    variant === "sheet" && on && onShared ? (
      <DropdownMenu>
        {/* Who reads the notes sits before the switch (under the name on a phone); the menu says what each choice means. */}
        <DropdownMenuTrigger
          disabled={readOnly}
          className="inline-flex h-7 min-w-0 items-center max-sm:col-span-3 max-sm:col-start-2 max-sm:row-start-2 max-sm:-ml-2 max-sm:justify-self-start gap-1.5 rounded-sm px-2 text-caption font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-hover aria-expanded:text-foreground disabled:cursor-not-allowed pointer-coarse:min-h-11 [&>svg]:size-3.5 [&>svg]:shrink-0"
          aria-label={t("meetings.sheet.chipAria", { key: t("meetings.sheet.shareLabel"), value: shareValue })}
        >
          <Eye aria-hidden />
          <span className="truncate">{shareValue}</span>
          <ChevronDown aria-hidden className="size-3!" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-90 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("meetings.sheet.shareLabel")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={shared ? "workspace" : "meeting"} onValueChange={(v: string) => onShared(v === "workspace")}>
              {(["meeting", "workspace"] as const).map((v) => (
                <DropdownMenuRadioItem key={v} value={v} className={cn(MENU_ITEM_LEFT_CHECK, "h-auto items-start py-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:top-2.5")}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body">{t(v === "workspace" ? "meetings.sheet.shareWorkspace" : "meetings.sheet.shareMeeting")}</span>
                    <span className="text-caption text-pretty break-words text-muted-foreground">
                      {t(v === "workspace" ? "meetings.sheet.shareWorkspaceDesc" : "meetings.sheet.shareMeetingDesc", { name: workspaceName ?? "" })}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;
  return (
    // On, the card takes the scribe's violet wash; off or locked, it is a plain outline.
    <div className={cn("rounded-lg border px-3 py-2.5", on ? "border-transparent bg-tint-violet" : "border-border")}>
      <div className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-x-2.5">
        <ScribeMark size={28} state={on ? "idle" : "off"} />
        <div className="flex min-w-0 items-center gap-0.5">
          <label id={`${id}-label`} htmlFor={`${id}-switch`} className="text-body font-semibold whitespace-nowrap">
            {t("meetings.scribe.formLabel")}
          </label>
          <ScribeHelp />
        </div>
        {share}
        <Switch
          id={`${id}-switch`}
          checked={on}
          readOnly={locked || readOnly}
          aria-disabled={locked || undefined}
          aria-describedby={`${id}-caption`}
          onCheckedChange={(next) => !locked && !readOnly && onChange(next)}
          className="col-start-4 row-start-1 h-5 w-9 shrink-0"
        />
      </div>
      {/* What the scribe does is behind the "?"; only the policy lock is worth a visible line. */}
      <p id={`${id}-caption`} className={locked ? "mt-0.5 pl-9.5 text-caption text-pretty text-muted-foreground" : "sr-only"}>
        {locked ? (
          <span className="inline-flex items-center gap-1">
            <Lock aria-hidden className="size-3" />
            {t("meetings.aiAccess.scribeOffByPolicy")}
          </span>
        ) : (
          t("meetings.scribe.formHint")
        )}
      </p>
      {live && !locked ? (
        <p className="mt-1.5 pl-9.5 text-caption text-foreground">{t("meetings.sheet.scribeLiveOff")}</p>
      ) : null}
      {variant === "instant" && !locked && !on && scribePolicyDefault(caps) ? (
        <p className="mt-1 pl-9.5 text-caption text-foreground">{t("meetings.sheet.scribeInstantOff")}</p>
      ) : null}
    </div>
  );
}
