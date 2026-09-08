"use client";

import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { messageBodyHasMention } from "./chat-mention-utils";
import { isChatMediaMessageBody, parseChatMediaMessageBody } from "./chat-expression-utils";

// The markdown renderer drags KaTeX, Shiki and the whole unified stack — about
// 140 KB gzip — into whatever route imports it. Most chat messages are plain
// text and return before reaching it (see ChatMessageBody), so it loads with
// the first message that carries a mention or an image, not with the route
// (scripts/bundle-budget.mjs).
const Markdown = lazy(() =>
  import("@uniwork/ui/markdown").then((m) => ({ default: m.Markdown })),
);

function ChatMediaMessageBody({ body }: { body: string }) {
  const parsed = parseChatMediaMessageBody(body);
  if (!parsed) return null;
  const isSticker = parsed.alt.startsWith("sticker:");
  const isGif = parsed.alt.startsWith("gif:") || parsed.url.toLowerCase().includes(".gif");

  return (
    // The image is the whole message, so the fallback reserves nothing: a
    // placeholder would flash for one frame on a picture about to appear.
    <Suspense fallback={null}>
      <Markdown
        mode="minimal"
        className="[&_p]:my-0"
        renderImage={({ src, alt }) => (
          <img
            src={src}
            alt={alt}
            className={cn(
              "my-0 max-w-full object-contain",
              isSticker ? "size-32" : isGif ? "max-h-48 rounded-md" : "max-h-48 rounded-md",
            )}
            loading="lazy"
          />
        )}
      >
        {body}
      </Markdown>
    </Suspense>
  );
}

export function ChatMessageBody({
  body,
  isOwn,
  nameContext,
}: {
  body: string;
  isOwn: boolean;
  nameContext: ChatNameContextEntry[];
}) {
  const { t } = useTranslation();
  const textClass = cn(
    "whitespace-pre-wrap break-words text-body leading-relaxed",
    isOwn ? "text-brand-foreground" : "text-foreground",
  );

  if (isChatMediaMessageBody(body)) {
    return (
      <div className={cn(isOwn ? "text-brand-foreground" : "text-foreground")}>
        <ChatMediaMessageBody body={body} />
      </div>
    );
  }

  if (!messageBodyHasMention(body)) {
    return <p className={textClass}>{body}</p>;
  }

  const mentionClass = cn(
    "font-semibold rounded-sm px-0.5",
    isOwn ? "bg-brand-foreground/15 text-brand-foreground" : "bg-primary/10 text-primary",
  );

  return (
    // Until the renderer lands the raw body shows in the same paragraph style a
    // plain message uses, so the only visible change is the mention becoming a
    // chip.
    <Suspense fallback={<p className={textClass}>{body}</p>}>
      <Markdown
        mode="minimal"
        className={cn(textClass, "[&_p]:my-0 [&_p]:leading-relaxed [&_p]:whitespace-pre-wrap")}
        renderMention={({ type, id }) => {
          if (type === "all") {
            return <span className={mentionClass}>@{t("chat.mention_all")}</span>;
          }
          if (type === "member") {
            const entry = nameContext.find((item) => item.user_id === id);
            const name = entry?.display_name ?? id;
            return <span className={mentionClass}>@{name}</span>;
          }
          return null;
        }}
      >
        {body}
      </Markdown>
    </Suspense>
  );
}
