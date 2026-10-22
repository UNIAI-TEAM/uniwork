import type { useTranslation } from "react-i18next";
import type { MeetingEvidenceSource } from "@uniwork/core/api/endpoints/meeting-evidence";
import { formatMeetingClock } from "../meeting-datetime";

type TFunction = ReturnType<typeof useTranslation>["t"];

// Said in a meeting, not written as markdown: a "*" or "#" stays a character.
const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]<>#|~]/g, "\\$&");

function kindKey(kind: string): string {
  switch (kind) {
    case "segment":
    case "note":
    case "chat":
      return `meetings.evidence.kind_${kind}`;
    default:
      return "meetings.evidence.kind_other";
  }
}

/**
 * The task description a meeting action item opens the composer with: the
 * AI's prose restating it, then every line it rests on quoted with who said,
 * wrote or sent it and when (the meeting is the task's origin, so the clock
 * alone dates it). Markdown, as the composer reads it; undefined when the item
 * has neither.
 */
export function actionItemTaskDescription(
  prose: string | null | undefined,
  lines: readonly MeetingEvidenceSource[],
  t: TFunction,
  locale: string,
  timeZone?: string,
): string | undefined {
  const parts: string[] = [];
  const lead = prose?.trim();
  if (lead) parts.push(lead);
  if (lines.length > 0) {
    const quotes = lines.map((src) => {
      const at = Date.parse(src.at ?? "");
      const head = [`**${escapeMarkdown(src.author?.trim() || "—")}**`, t(kindKey(src.kind))];
      if (Number.isFinite(at)) head.push(formatMeetingClock(at, locale, timeZone));
      // One paragraph per line inside the quote: joined lines would run together.
      const body = src.text.split("\n").map((line) => `> ${escapeMarkdown(line)}`);
      return [`> ${head.join(" · ")}`, ...body].join("\n>\n");
    });
    parts.push(`**${t("meetings.actionItemsSection.evidenceHeading")}**`, ...quotes);
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
