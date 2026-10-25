"use client";
import { useContext, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingEvidence } from "@uniwork/core/meetings/summary";
import { paths } from "@uniwork/core/paths";
import type { MeetingEvidenceRef } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@uniwork/ui/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../../../layout/workspace-context";
import { useOptionalNavigation } from "../../../navigation";
import { MeetingPersonAvatar } from "../../meeting-person";
import { MeetingSectionError, MeetingSectionLoading } from "../../meeting-section-state";
import { meetingAvatarTint } from "../avatar-tint";
import { DetailContext } from "../detail-context";
import { clock } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { TimeChipButton } from "../ui/time-chip";
import { useEvidenceAt } from "./evidence-times";

// The evidence endpoint answers at most 20 refs per call.
const MAX_REFS = 20;

/** "09:06:31": the popover names the second the line was said. */
function clockWithSeconds(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(ms);
}

/**
 * The time chip on an AI claim (brief "Time chip (signature)"): the wall clock
 * of the first line it rests on. It opens a 360 popover — a bottom sheet on a
 * phone — with that line, who said it, what else it rests on and the way into
 * the transcript at that line. `time` overrides the derived clock.
 */
export function EvidenceTimeChip({
  meetingId,
  refs,
  time,
}: {
  meetingId: string;
  refs: readonly MeetingEvidenceRef[];
  time?: string;
}) {
  const { t } = useTranslation();
  const detail = useContext(DetailContext);
  const derived = useEvidenceAt(meetingId, time === undefined ? refs : []);
  const shown = time ?? clock(derived.at);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const label = !shown
    ? t("meetings.detail.evidence.chipNoTime")
    : refs.length > 1
      ? t("meetings.detail.evidence.chipLabelMany", { time: shown, count: refs.length })
      : t("meetings.detail.ui.evidenceAt", { time: shown });
  const text = shown || (derived.settled ? "--:--" : "00:00");
  // Held invisible (not removed) while the time resolves, so the row does not shift.
  const pending = !shown && !derived.settled;
  const chip = (props: object) => (
    <TimeChipButton
      ref={chipRef}
      time={text}
      ariaLabel={label}
      className={cn(pending && "invisible")}
      {...props}
    />
  );
  if (refs.length === 0) return chip({});
  const body = (
    <EvidenceBody meetingId={meetingId} refs={refs} phone={detail?.isPhone ?? false} onClose={() => setOpen(false)} />
  );

  if (detail?.isPhone) {
    return (
      <>
        {chip({ "aria-haspopup": "dialog", "aria-expanded": open, onClick: () => setOpen(true) })}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="px-4 pb-8.5 shadow-floating data-[vaul-drawer-direction=bottom]:border-t-0">
            <DrawerTitle className="sr-only">{t("meetings.detail.evidence.title", { time: shown })}</DrawerTitle>
            {open ? body : null}
          </DrawerContent>
        </Drawer>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={chip({})} />
      <PopoverContent
        // Below the whole row, so the claim it explains stays readable (kit `.popover-ev`).
        anchor={() => chipRef.current?.closest("li") ?? chipRef.current}
        align="start"
        alignOffset={-6}
        sideOffset={6}
        aria-label={t("meetings.detail.evidence.title", { time: shown })}
        className="w-90 gap-0 border border-border bg-popover p-4 ring-0 dark:shadow-floating"
      >
        {open ? body : null}
      </PopoverContent>
    </Popover>
  );
}

function EvidenceBody({
  meetingId,
  refs,
  phone,
  onClose,
}: {
  meetingId: string;
  refs: readonly MeetingEvidenceRef[];
  phone: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const detail = useContext(DetailContext);
  const nav = useOptionalNavigation();
  const workspace = useOptionalWorkspace()?.workspace;
  const query = useMeetingEvidence(meetingId, refs.slice(0, MAX_REFS), true);
  if (query.isPending) {
    return (
      <MeetingSectionLoading label={t("meetings.evidence.loading")}>
        <Spinner />
      </MeetingSectionLoading>
    );
  }
  if (query.isError) {
    return <MeetingSectionError message={t("meetings.evidence.error")} onRetry={() => void query.refetch()} />;
  }
  const [first, ...rest] = query.data;
  if (!first) return <p className="text-caption text-muted-foreground">{t("meetings.evidence.gone")}</p>;

  const members = detail?.memberIndex.members ?? [];
  const authorId = members.find((m) => m.display_name === first.author)?.user_id;
  const lines = rest.filter((s) => s.kind === "segment").length;
  const notes = rest.filter((s) => s.kind === "note");
  const others = rest.length - lines - notes.length;
  const noteAuthors = [...new Set(notes.map((n) => n.author).filter(Boolean))].join(", ");
  const parts = [
    lines > 0 ? t("meetings.detail.evidence.moreLines", { count: lines }) : null,
    notes.length > 0
      ? noteAuthors
        ? t("meetings.detail.evidence.moreNotesBy", { count: notes.length, names: noteAuthors })
        : t("meetings.detail.evidence.moreNotes", { count: notes.length })
      : null,
    others > 0 ? t("meetings.detail.evidence.moreOther", { count: others }) : null,
  ].filter(Boolean);
  const meetingPath = workspace ? paths.workspace(workspace.organization_slug, workspace.slug).meeting(meetingId) : null;
  const openTranscript =
    first.kind === "segment" && nav && meetingPath
      ? () => {
          onClose();
          nav.push(`${meetingPath}?tab=transcript&segment=${encodeURIComponent(first.id)}`);
        }
      : null;

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-2 text-body font-medium">
          <MeetingPersonAvatar name={first.author || "?"} size={20} tint={meetingAvatarTint(authorId, members)} />
          {first.author || "—"}
          {phone ? null : <span aria-hidden>·</span>}
          <time dateTime={first.at ?? undefined} className="font-mono text-caption font-medium text-muted-foreground tabular-nums">
            {clockWithSeconds(first.at)}
          </time>
        </div>
        {phone ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("ml-auto", kitButton.icon)}
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <blockquote className={cn(phone ? "mt-1" : "mt-2", "text-body-lg whitespace-pre-wrap text-pretty")}>
        {t("meetings.detail.evidence.quote", { text: first.text })}
      </blockquote>
      {parts.length > 0 ? (
        <p className="mt-2 text-caption text-muted-foreground">
          {t("meetings.detail.evidence.more", { list: parts.join(" · ") })}
        </p>
      ) : null}
      {openTranscript ? (
        phone ? (
          <Button type="button" variant="outline" size="lg" className={cn("mt-4 h-11 w-full", kitButton.outline)} onClick={openTranscript}>
            {t("meetings.detail.evidence.openInTranscript")}
          </Button>
        ) : (
          <div className="mt-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={openTranscript}
              className="inline-flex items-center gap-0.5 rounded-xs text-body font-medium text-primary underline-offset-2 hover:underline"
            >
              {t("meetings.detail.evidence.openInTranscript")}
              <ChevronRight aria-hidden className="size-3" />
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
