import type { useTranslation } from "react-i18next";
import type { MeetingEvidenceSource } from "@uniwork/core/api/endpoints/meeting-evidence";
import { formatMeetingClock } from "../meeting-datetime";

type TFunction = ReturnType<typeof useTranslation>["t"];

// Said in a meeting, not written as markdown: a "*" or "#" stays a character.
const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]<>#|~]/g, "\\$&");

// A task description carries a taste of the evidence; the meeting's evidence
// chip keeps every line whole.
const MAX_QUOTES = 3;
const MAX_QUOTE_CHARS = 300;

// Context kept before the task's own words when a long line is cut there.
const LEAD_CHARS = 40;

/**
 * The lines to quote, each with the text shown: cut to the task, each wording
 * once (a repeated line, or two that read the same once cut, say nothing new),
 * at most MAX_QUOTES.
 */
function quotedLines(lines: readonly MeetingEvidenceSource[], title: string): { src: MeetingEvidenceSource; text: string }[] {
  const probe = titleProbe(title);
  const seen = new Set<string>();
  const out: { src: MeetingEvidenceSource; text: string }[] = [];
  for (const src of lines) {
    const text = clip(src.text.trim(), probe);
    // Compared from the task's own words on: the context cut in before them may differ.
    const at = probe ? text.toLowerCase().indexOf(probe) : -1;
    const key = (at >= 0 ? text.slice(at) : text).replace(/\s+/g, " ").replace(/^…|…$/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ src, text });
    if (out.length === MAX_QUOTES) break;
  }
  return out;
}

/** How a line names the task: the first words of its title, lower-cased. */
const titleProbe = (title: string) => title.trim().toLowerCase().split(/\s+/).slice(0, 3).join(" ");

/**
 * A long line cut to MAX_QUOTE_CHARS where it speaks of the task (probe),
 * else from its start: one speaker's long turn often covers several tasks.
 */
function clip(text: string, probe: string): string {
  if (text.length <= MAX_QUOTE_CHARS) return text;
  const at = probe ? text.toLowerCase().indexOf(probe) : -1;
  let start = at > LEAD_CHARS ? at - LEAD_CHARS : 0;
  // Start on a word, not inside one.
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  const end = start + MAX_QUOTE_CHARS;
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}


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
 * AI's prose restating it, then the lines it rests on (each wording once, three
 * at most, a long one cut short) quoted with who said, wrote or sent it and
 * when (the meeting is the task's origin, so the clock alone dates it).
 * Markdown, as the composer reads it; undefined when the item has neither.
 */
export function actionItemTaskDescription(
  item: { title: string; description?: string | null },
  lines: readonly MeetingEvidenceSource[],
  t: TFunction,
  locale: string,
  timeZone?: string,
): string | undefined {
  const parts: string[] = [];
  const lead = item.description?.trim();
  if (lead) parts.push(lead);
  const shown = quotedLines(lines, item.title);
  if (shown.length > 0) {
    const quotes = shown.map(({ src, text }) => {
      const at = Date.parse(src.at ?? "");
      const head = [`**${escapeMarkdown(src.author?.trim() || "—")}**`, t(kindKey(src.kind))];
      if (Number.isFinite(at)) head.push(formatMeetingClock(at, locale, timeZone));
      // One paragraph per line inside the quote: joined lines would run together.
      const body = text.split("\n").map((line) => `> ${escapeMarkdown(line)}`);
      return [`> ${head.join(" · ")}`, ...body].join("\n>\n");
    });
    parts.push(`**${t("meetings.actionItemsSection.evidenceHeading")}**`, ...quotes);
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
