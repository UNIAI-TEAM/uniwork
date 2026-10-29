"use client";

import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { DocumentMinutesMeeting } from "@uniwork/core/types/document";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../layout/module-icons";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";

const MeetingsIcon = MODULE_ICONS.meetings;

export interface DocumentMinutesSourceLinkProps {
  minutesMeeting: DocumentMinutesMeeting | null | undefined;
  className?: string;
  stopPropagation?: boolean;
}

/**
 * Source label for a meeting minutes UniNote page (UNI-2288).
 * When the viewer may open the meeting (`title` is present), renders a link to
 * the meeting (`/{orgSlug}/{wsSlug}/meetings/{meetingId}`); otherwise renders
 * plain text without a link.
 */
export function DocumentMinutesSourceLink({
  minutesMeeting,
  className,
  stopPropagation = false,
}: DocumentMinutesSourceLinkProps) {
  const { t } = useTranslation();
  const context = useOptionalWorkspace();
  if (!minutesMeeting?.id) return null;

  const title = minutesMeeting.title?.trim() ?? "";
  const hasTitle = title.length > 0;
  const label = hasTitle
    ? t("documents.page_ui.minutes_source_named", { title })
    : t("documents.page_ui.minutes_source");

  const orgSlug = context?.workspace.organization_slug ?? "";
  const wsSlug = context?.workspace.slug ?? "";

  if (hasTitle && orgSlug && wsSlug) {
    return (
      <AppLink
        href={paths.workspace(orgSlug, wsSlug).meeting(minutesMeeting.id)}
        data-minutes-meeting
        title={label}
        onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1 text-caption text-muted-foreground hover:text-foreground hover:underline",
          className,
        )}
      >
        <MeetingsIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </AppLink>
    );
  }

  // No title, or no workspace to build a path from: plain text, never a guessed link.
  return (
    <span
      data-minutes-meeting
      title={label}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 text-caption text-muted-foreground",
        className,
      )}
    >
      <MeetingsIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
