"use client";

import { Image as ImageIcon, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { formatBytes } from "../documents/doclist/format";
import { DocumentTypeIcon, fileExtension } from "../documents/document-type-icon";
import type { AskUniAttachments } from "./use-ask-uni-attachments";

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * An upload's progress as a ring that fills clockwise from the top. Neutral strokes: `--primary` and `--border` are
 * re-pointed by a provider's look (tokens.css), and the Anthropic orange is under 3:1 on the chip's `bg-muted`.
 */
function Ring({ progress }: { progress: number }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="size-5 -rotate-90 fill-none stroke-2">
      <circle cx="10" cy="10" r={RADIUS} className="stroke-muted-foreground/25" />
      <circle
        cx="10"
        cy="10"
        r={RADIUS}
        className="stroke-muted-foreground"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
      />
    </svg>
  );
}

/**
 * One file of an Ask UNI question: its type icon, a name that truncates, its
 * size, a ring while it uploads and a red frame with the reason and a retry
 * when it failed. Without `onRemove` and `onRetry` it is a plain label;
 * `onOpen` makes the name and size one button (a stored attachment downloads).
 */
export function AskUniAttachmentChip({
  name,
  size,
  mime,
  status,
  progress = 0,
  error,
  onRemove,
  onRetry,
  onOpen,
}: {
  name: string;
  size: number;
  mime: string;
  status: "uploading" | "ready" | "error";
  /** 0..1 of the upload, read while `status` is "uploading". */
  progress?: number;
  /** Why a failed upload failed, already worded; the general failure when absent. */
  error?: string;
  onRemove?: () => void;
  onRetry?: () => void;
  onOpen?: () => void;
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "ai.attachments" });
  const percent = Math.round(Math.min(Math.max(progress, 0), 1) * 100);
  const failed = status === "error";
  let lead;
  if (status === "uploading") {
    // Until the first progress event the ring would sit empty: the spinner shows the upload is alive.
    lead = (
      <span
        role="progressbar"
        aria-label={`${t("uploading")}: ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
      >
        {percent > 0 ? <Ring progress={percent / 100} /> : <Spinner />}
      </span>
    );
  } else if (mime.startsWith("image/")) {
    lead = <ImageIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />;
  } else {
    lead = <DocumentTypeIcon decorative format={fileExtension(name) || "file"} className="size-5" />;
  }
  const body = (
    <>
      {lead}
      <span className="min-w-0">
        <span className="block truncate font-medium" title={name}>
          {name}
        </span>
        <span className={cn("block truncate tabular-nums", failed ? "text-destructive" : "text-muted-foreground")}>
          {failed ? (error ?? t("failed")) : formatBytes(size, i18n.language)}
        </span>
      </span>
    </>
  );
  const bodyClass = "flex min-w-0 items-center gap-1.5 text-left";
  return (
    <span
      data-slot="ask-uni-attachment"
      data-status={status}
      className={cn(
        "inline-flex max-w-64 items-center gap-1 rounded-lg border bg-muted py-1 pl-2 text-caption text-foreground",
        failed ? "border-destructive" : "border-transparent",
        !onRemove && "pr-2",
      )}
    >
      {onOpen ? (
        <button type="button" aria-label={t("download", { name })} className={bodyClass} onClick={onOpen}>
          {body}
        </button>
      ) : (
        <span className={bodyClass}>{body}</span>
      )}
      {/* The primitive carries the 44px coarse-pointer target. */}
      {failed && onRetry ? (
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("retry")} className="rounded-full text-muted-foreground" onClick={onRetry}>
          <RefreshCw aria-hidden />
        </Button>
      ) : null}
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("remove", { name })} className="rounded-full text-muted-foreground" onClick={onRemove}>
          <X aria-hidden />
        </Button>
      ) : null}
    </span>
  );
}

/** What a failed upload's server code says, as one of the copies: the upload route's refusals by name, anything else (a proxy's HTML page too) the general failure. */
function failure(code: string): "too_large" | "type_unsupported" | "unreadable" | "failed" {
  switch (code) {
    case "ai_attachment_unreadable":
      return "unreadable";
    case "too_large":
    case "file_too_large":
    case "ai_attachments_too_large":
      return "too_large";
    case "file_type_rejected":
    case "media_unsupported":
      return "type_unsupported";
    default:
      return "failed";
  }
}

/** The staged files as chips, and under them each reason a file was turned away, once. Nothing at all when both are empty. */
export function AskUniAttachmentRow({ attachments }: { attachments: AskUniAttachments }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.attachments" });
  const { files, refused, remove, retry } = attachments;
  if (files.length === 0 && refused.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((x) => (
            <li key={x.key} className="max-w-full">
              <AskUniAttachmentChip
                name={x.file.name}
                size={x.file.size}
                mime={x.file.type}
                status={x.status}
                progress={x.progress}
                error={x.error ? t(failure(x.error)) : undefined}
                onRemove={() => remove(x.key)}
                // Sending the same file again cannot open it: only removing it helps.
                onRetry={x.error === "ai_attachment_unreadable" ? undefined : () => retry(x.key)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {refused.map((why) => (
        <p key={why} role="alert" className="text-caption text-destructive">
          {t(why)}
        </p>
      ))}
    </div>
  );
}
