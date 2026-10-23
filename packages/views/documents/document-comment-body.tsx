"use client";

import { Fragment, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentCommentMention } from "@uniwork/core/types/document";
import { cn } from "@uniwork/ui/lib/utils";
import { K } from "./document-comments-keys";

// The comment body renderer of the G8 addendum §4.2 (contract-collab 3): a
// small Markdown subset - paragraphs, line breaks, **bold**, *italic*, inline
// `code`, http(s) links - plus the mention token
// `[@Label](mention://member/<ULID>)`. Anything else is shown as typed; no
// HTML is ever interpreted (React escapes every text node). A chip shows the
// person's CURRENT name from the list's name table; the label written in the
// token is only the fallback for an account that is gone or not in the table.
// A long body is folded behind an expand toggle, and a body with no text says so.

const TOKEN = new RegExp(
  [
    "`([^`\\n]+)`", // 1: inline code
    "\\[@((?:[^\\[\\]\\\\]|\\\\.)*)\\]\\(mention://member/([0-9A-Za-z]{26})\\)", // 2, 3: mention
    "\\[([^\\]\\n]+)\\]\\((https?://[^\\s)]+)\\)", // 4, 5: link with a label
    "(https?://[^\\s<>()]+[^\\s<>().,;:!?'\"])", // 6: bare link
    "\\*\\*([^*\\n]+)\\*\\*", // 7: bold
    "\\*([^*\\n]+)\\*", // 8: italic
  ].join("|"),
  "g",
);

/** A body past either bound is folded (S12: the long-body collapse kept on D). */
const COLLAPSE_CHARS = 600;
const COLLAPSE_LINES = 8;

/** `\[`, `\]`, `\(`, `\)` and `\\` in a token label are Markdown escapes. */
const unescapeLabel = (label: string) => label.replace(/\\(.)/g, "$1");

export type MentionNames = ReadonlyMap<string, DocumentCommentMention>;
type Names = MentionNames;

function MentionChip({ id, label, names }: { id: string; label: string; names: Names }) {
  const entry = names.get(id.toUpperCase());
  const current = entry && entry.state === "ok" && entry.display_name ? entry.display_name : null;
  return (
    <span
      data-mention-id={id}
      data-mention-state={current ? "ok" : "unavailable"}
      className={cn(
        "rounded px-1 font-medium",
        current ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      @{current ?? label}
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 break-all">
      {children}
    </a>
  );
}

function renderInline(text: string, names: Names, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${n++}`;
    const [whole, code, mentionLabel, mentionId, linkLabel, linkHref, bare, bold, italic] = match;
    if (code !== undefined) {
      out.push(<code key={key} className="rounded bg-muted px-1 font-mono text-caption">{code}</code>);
    } else if (mentionId !== undefined) {
      out.push(<MentionChip key={key} id={mentionId} label={unescapeLabel(mentionLabel ?? "")} names={names} />);
    } else if (linkHref !== undefined) {
      out.push(<ExternalLink key={key} href={linkHref}>{linkLabel}</ExternalLink>);
    } else if (bare !== undefined) {
      out.push(<ExternalLink key={key} href={bare}>{bare}</ExternalLink>);
    } else if (bold !== undefined) {
      out.push(<strong key={key}>{renderInline(bold, names, key)}</strong>);
    } else if (italic !== undefined) {
      out.push(<em key={key}>{renderInline(italic, names, key)}</em>);
    } else {
      out.push(whole);
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The name table of one list answer, keyed by user id (ids compare upper-case, as the server stores them). */
export function mentionNames(mentions: readonly DocumentCommentMention[]): Names {
  return new Map(mentions.map((m) => [m.user_id.toUpperCase(), m] as const));
}

export function DocumentCommentBody({
  body,
  names,
  className,
}: {
  body: string;
  names: Names;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const paragraphs = body.replace(/\r\n?/g, "\n").split(/\n{2,}/).filter((p) => p.trim() !== "");
  if (paragraphs.length === 0) {
    return (
      <p className={cn("text-caption italic text-muted-foreground", className)} data-testid="document-comment-body">
        {t(K.commentPreviewEmpty)}
      </p>
    );
  }
  const long = body.length > COLLAPSE_CHARS || body.split("\n").length > COLLAPSE_LINES;
  return (
    <div>
      <div
        id={regionId}
        className={cn("space-y-2 break-words text-body text-foreground", long && !open && "max-h-40 overflow-hidden", className)}
        data-testid="document-comment-body"
      >
        {paragraphs.map((paragraph, p) => (
          <p key={p} className="whitespace-pre-wrap">
            {paragraph.split("\n").map((line, l) => (
              <Fragment key={l}>
                {l > 0 ? <br /> : null}
                {renderInline(line, names, `${p}-${l}`)}
              </Fragment>
            ))}
          </p>
        ))}
      </div>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((current) => !current)}
          className="mt-1 inline-flex min-h-6 items-center rounded text-micro font-medium text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11"
        >
          {t(open ? K.commentCollapse : K.commentExpand)}
        </button>
      ) : null}
    </div>
  );
}
