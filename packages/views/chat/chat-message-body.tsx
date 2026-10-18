"use client";

import { Fragment, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatAnimatedImage, isAnimatedChatImage } from "./chat-animated-image";
import {
  describeChatMediaBody,
  isChatMediaMessageBody,
  parseChatMediaMessageBody,
} from "./chat-expression-utils";

/**
 * A sticker, GIF or image is already parsed to a URL and a name, so it is
 * drawn as a plain <img>: no markdown bundle to wait for, no empty bubble
 * while it loads. A sticker keeps its 128px height from the first paint; a
 * GIF or image shows a muted plate until it arrives; a broken link says so
 * in words.
 */
function ChatMediaMessageBody({ body }: { body: string }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const parsed = parseChatMediaMessageBody(body);
  if (!parsed) return null;
  const isSticker = parsed.alt.startsWith("sticker:");
  const label =
    describeChatMediaBody(body, {
      sticker: t("chat.media_sticker"),
      gif: t("chat.media_gif"),
      image: t("chat.media_image"),
    }) ?? t("chat.media_image");

  if (failed) {
    return (
      <p className="rounded-lg bg-muted px-3 py-2 text-caption text-muted-foreground">
        {t("chat.media_unavailable", { name: label })}
      </p>
    );
  }
  const imgClass = cn(
    "block max-w-full object-contain",
    // Fixed height (no jump when it loads), natural width: many "stickers"
    // from GIF services are landscape and would letterbox in a square.
    isSticker ? "h-32 w-auto max-w-56" : cn("max-h-60 rounded-xl", !loaded && "min-h-32 min-w-48 bg-muted"),
  );
  if (isAnimatedChatImage(parsed.url, parsed.alt)) {
    return (
      <ChatAnimatedImage
        src={parsed.url}
        alt={label}
        imgClassName={imgClass}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <img
      src={parsed.url}
      alt={label}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={imgClass}
    />
  );
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/**
 * Plain text with its web addresses made into links. A cheap pass on the
 * common path, so a message with a URL does not pull in the markdown bundle.
 */
function linkify(text: string, linkClass: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) out.push(<Fragment key={`${keyPrefix}t${last}`}>{text.slice(last, start)}</Fragment>);
    out.push(
      <a key={`${keyPrefix}a${start}`} href={match[0]} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {match[0]}
      </a>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`${keyPrefix}t${last}`}>{text.slice(last)}</Fragment>);
  return out;
}

const MENTION_PATTERN = /\[@([^\]]+)\]\(mention:\/\/(member|all)\/([^)]+)\)/g;

function sameMentionId(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

/** The name written on the message, or the name we know now when that text is the id. */
function mentionLabel(label: string, id: string, nameContext: ChatNameContextEntry[]): string {
  const written = label.trim();
  if (written && !sameMentionId(written, id)) return written;
  const match = nameContext.find((entry) => sameMentionId(entry.user_id, id));
  const known = match?.display_name?.trim() ?? "";
  if (known && !sameMentionId(known, id)) return known;
  const local = match?.email?.split("@")[0]?.trim() ?? "";
  if (local && !sameMentionId(local, id)) return local;
  return written || id;
}

/**
 * Text with its mentions drawn as chips and its links made clickable. One
 * path for every message: the same words render the same whether or not
 * they mention someone. A mention of someone no longer in the room keeps
 * the name written into the message, never their id.
 */
function renderMessageText(
  body: string,
  nameContext: ChatNameContextEntry[],
  classes: { link: string; mention: string },
  allLabel: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) out.push(...linkify(body.slice(last, start), classes.link, `s${last}`));
    const [, label = "", kind, id = ""] = match;
    const name = kind === "all" ? allLabel : mentionLabel(label, id, nameContext);
    out.push(
      <span key={`m${start}`} className={classes.mention}>
        @{name}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < body.length) out.push(...linkify(body.slice(last), classes.link, `s${last}`));
  return out;
}

export function ChatMessageBody({
  body,
  isOwn,
  nameContext,
  trailing,
}: {
  body: string;
  isOwn: boolean;
  nameContext: ChatNameContextEntry[];
  /** Floated after the last word: the bubble's time and delivery state. */
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  // The body takes the bubble's text colour (white on my brand bubble, ink on
  // theirs); long words and URLs wrap anywhere instead of pushing the bubble
  // past its column.
  const textClass = "min-w-0 whitespace-pre-wrap text-body-lg text-pretty [overflow-wrap:anywhere]";
  // On the brand bubble a link is the bubble's own text, underlined; a
  // mention is a translucent chip of the same colour.
  const linkClass = cn(
    "font-medium underline decoration-1 underline-offset-2 hover:decoration-2",
    isOwn ? "text-chat-bubble-own-foreground" : "text-brand-subtle-foreground",
  );

  if (isChatMediaMessageBody(body)) {
    return (
      <div className="text-foreground">
        <ChatMediaMessageBody body={body} />
      </div>
    );
  }

  const mentionClass = cn(
    "rounded-sm px-1 font-semibold",
    isOwn
      ? "bg-chat-bubble-own-foreground/20 text-chat-bubble-own-foreground"
      : "bg-brand-subtle text-brand-subtle-foreground",
  );
  return (
    <p className={textClass}>
      {renderMessageText(body, nameContext, { link: linkClass, mention: mentionClass }, t("chat.mention_all"))}
      {trailing}
    </p>
  );
}
