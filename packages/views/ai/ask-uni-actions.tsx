"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiCitation } from "@uniwork/core/types";
import { useClearAiFeedback, useSetAiFeedback } from "@uniwork/core/ai";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { answerPlainText } from "./ask-uni-text";

const REASONS = ["wrong_facts", "missing_sources", "not_helpful", "other"] as const;
const NOTE_MAX = 500;

function ActionButton({ label, pressed, disabled, onClick, children }: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={label}
            aria-pressed={pressed}
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function DownFeedback({ active, onSend }: { active: boolean; onSend: (reason: string, note: string) => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.actions" });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const label = t("not_helpful");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={label} aria-pressed={active} />}
      >
        <ThumbsDown aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <p className="text-body font-medium">{t("feedback_title")}</p>
        <RadioGroup value={reason} onValueChange={(v) => setReason(String(v))} aria-label={t("feedback_title")}>
          {REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-body">
              <RadioGroupItem value={r} />
              {t(`reason.${r}`)}
            </label>
          ))}
        </RadioGroup>
        <label className="flex flex-col gap-1 text-caption text-muted-foreground">
          {t("note_label")}
          <Textarea
            value={note}
            maxLength={NOTE_MAX}
            rows={3}
            placeholder={t("note_placeholder")}
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="self-end">{t("note_count", { count: note.length, max: NOTE_MAX })}</span>
        </label>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            onSend(reason, note.trim());
            setOpen(false);
          }}
        >
          {t("send_feedback")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Copy, regenerate (last answer only) and feedback under one finished answer. */
export function AskUniActions({ conversationId, messageId, content, sources, onRegenerate, regenerateDisabled }: {
  conversationId: string;
  messageId: string;
  content: string;
  sources: Map<string, AiCitation>;
  onRegenerate?: () => void;
  regenerateDisabled?: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.actions" });
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = useSetAiFeedback();
  const clear = useClearAiFeedback();
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    try {
      // No clipboard (insecure context) throws here, a denied one rejects; either leaves the button unchanged.
      // [S#] markers mean nothing outside the panel: names stand in for them.
      await navigator.clipboard.writeText(answerPlainText(content, sources));
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const up = () => {
    const before = rating;
    if (before === "up") {
      setRating(null);
      clear.mutate({ conversationId, messageId }, { onError: () => setRating(before) });
      return;
    }
    setRating("up");
    set.mutate({ conversationId, messageId, body: { rating: "up" } }, { onError: () => setRating(before) });
  };
  const down = (reason: string, note: string) => {
    const before = rating;
    setRating("down");
    set.mutate(
      { conversationId, messageId, body: { rating: "down", ...(reason ? { reason } : {}), ...(note ? { note } : {}) } },
      { onError: () => setRating(before) },
    );
  };

  // An answer with no text has nothing to copy or rate; regenerate stays.
  const hasText = content !== "";
  if (!hasText && !onRegenerate) return null;
  return (
    <div className="mt-1 flex items-center gap-0.5">
      {hasText ? (
        <ActionButton label={copied ? t("copied") : t("copy")} onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </ActionButton>
      ) : null}
      {onRegenerate ? (
        <ActionButton label={t("regenerate")} disabled={regenerateDisabled} onClick={onRegenerate}>
          <RefreshCw aria-hidden />
        </ActionButton>
      ) : null}
      {hasText ? (
        <>
          <ActionButton label={t("helpful")} pressed={rating === "up"} onClick={up}>
            <ThumbsUp aria-hidden />
          </ActionButton>
          <DownFeedback active={rating === "down"} onSend={down} />
        </>
      ) : null}
    </div>
  );
}
