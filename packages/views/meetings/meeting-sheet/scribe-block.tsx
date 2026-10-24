"use client";
import { useId } from "react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { scribePolicyOf, type MeetingCapabilities } from "@uniwork/core/types/meeting";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { SegmentedSm } from "../meeting-detail/ui/segmented";
import { ScribeGlyph } from "@uniwork/ui/brand/scribe-mark";

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

type Sharing = "meeting" | "workspace";

/**
 * Thư ký UNI (create brief §2.7): the switch with one line on what it does
 * and — while on — who reads the summary and transcript. Policy off draws the
 * switch locked with the reason. Where the audio is processed is said only in
 * the organization's settings.
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
  const sharing: Sharing = shared ? "workspace" : "meeting";
  return (
    <div>
      <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 group-data-[mode=edit]/sheet:min-h-6">
        <ScribeGlyph className="size-4 text-muted-foreground" />
        <label id={`${id}-label`} htmlFor={`${id}-switch`} className="text-body font-medium">
          {t("meetings.scribe.formLabel")}
        </label>
        <Switch
          id={`${id}-switch`}
          checked={on}
          readOnly={locked || readOnly}
          aria-disabled={locked || undefined}
          aria-describedby={`${id}-caption`}
          onCheckedChange={(next) => !locked && !readOnly && onChange(next)}
          className="h-5 w-9"
        />
      </div>
      <p id={`${id}-caption`} className="mt-0.5 pr-13 pl-6 text-caption group-data-[mode=edit]/sheet:mt-1 text-pretty text-muted-foreground max-sm:pr-0">
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
        <p className="mt-1.5 pl-6 text-caption text-foreground">{t("meetings.sheet.scribeLiveOff")}</p>
      ) : null}
      {variant === "instant" && !locked && !on && scribePolicyDefault(caps) ? (
        <p className="mt-1 pl-6 text-caption text-foreground">{t("meetings.sheet.scribeInstantOff")}</p>
      ) : null}
      {variant === "sheet" && on && onShared ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3 pl-6 max-sm:flex-col max-sm:items-start max-sm:gap-2">
            <span aria-hidden className="text-caption font-medium text-muted-foreground group-data-[mode=followUp]/sheet:font-normal">
              {t("meetings.sheet.shareLabel")}
            </span>
            <SegmentedSm<Sharing>
              legend={t("meetings.sheet.shareLabel")}
              value={sharing}
              onChange={(v) => !readOnly && onShared(v === "workspace")}
              options={[
                { value: "meeting", label: t("meetings.sheet.shareMeeting") },
                // The name lives in the hint below: a long workspace name would stretch the control.
                { value: "workspace", label: t("meetings.sheet.shareWorkspace") },
              ]}
              className="max-sm:w-full max-sm:[&>label]:flex-auto max-sm:group-data-[phone-sheet]/sheet:[&>label]:flex-1 max-sm:group-data-[mode=live]/sheet:w-auto max-sm:group-data-[mode=live]/sheet:[&>label]:flex-none"
            />
          </div>
          <p className="mt-1.5 pl-6 text-caption text-muted-foreground group-data-[fresh]/sheet:mt-2 group-data-[mode=edit]/sheet:mt-2 group-data-[mode=live]/sheet:mt-2">
            {t(shared ? "meetings.sheet.shareWorkspaceHint" : "meetings.sheet.shareMeetingHint", { name: workspaceName ?? "" })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
