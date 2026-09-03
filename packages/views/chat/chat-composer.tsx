"use client";

import { useRef, useState } from "react";
import {
  Grid2X2,
  MapPin,
  Mic,
  Paperclip,
  Send,
  Sticker,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { QuickEmojiPicker } from "@uniwork/ui/components/common/quick-emoji-picker";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";

type ComposerAttachAction = "stickers" | "voice" | "poll" | "location";

const ATTACH_ACTIONS: {
  id: ComposerAttachAction;
  icon: typeof Sticker;
  labelKey: "composer_stickers" | "composer_voice" | "composer_poll" | "composer_location";
}[] = [
  { id: "stickers", icon: Sticker, labelKey: "composer_stickers" },
  { id: "voice", icon: Mic, labelKey: "composer_voice" },
  { id: "poll", icon: Grid2X2, labelKey: "composer_poll" },
  { id: "location", icon: MapPin, labelKey: "composer_location" },
];

function ComposerToolbarButton({
  label,
  disabled,
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function ComposerAttachMenu({
  disabled,
  onAction,
  align = "end",
}: {
  disabled?: boolean;
  onAction: (action: ComposerAttachAction) => void;
  align?: "start" | "end";
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <ComposerToolbarButton label={t("chat.composer_attach")} disabled={disabled}>
            <Paperclip aria-hidden className="size-5" />
          </ComposerToolbarButton>
        }
      />
      <PopoverContent align={align} side="top" className="w-56 p-1">
        <ul className="flex flex-col" role="menu" aria-label={t("chat.composer_attach_menu")}>
          {ATTACH_ACTIONS.map(({ id, icon: Icon, labelKey }) => (
            <li key={id} role="none">
              <button
                type="button"
                role="menuitem"
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-body text-foreground",
                  "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                )}
                onClick={() => {
                  setOpen(false);
                  onAction(id);
                }}
              >
                <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span>{t(`chat.${labelKey}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function ChatComposer({
  draft,
  onDraftChange,
  onSend,
  disabled,
  placeholder,
  sendLabel,
  typingLabel,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder: string;
  sendLabel: string;
  typingLabel?: string | null;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && draft.trim().length > 0;

  const handleAttachAction = (_action: ComposerAttachAction) => {
    toast.info(t("chat.composer_coming_soon"));
  };

  const insertEmoji = (emoji: string) => {
    onDraftChange(`${draft}${emoji}`);
    textareaRef.current?.focus();
  };

  const submit = () => {
    if (!canSend) return;
    onSend();
  };

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-border bg-surface px-3 py-3">
      {typingLabel ? (
        <p className="px-2 text-caption text-muted-foreground" aria-live="polite">
          {typingLabel}
        </p>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2 rounded-full border border-border bg-muted/40 px-2 py-1.5 shadow-sm">
          <div className="flex shrink-0 items-center">
            <div className="flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11">
              <QuickEmojiPicker
                onSelect={insertEmoji}
                align="start"
                className="size-9 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-5"
              />
            </div>
            <ComposerAttachMenu disabled={disabled} onAction={handleAttachAction} align="start" />
          </div>

          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            disabled={disabled}
            rows={1}
            className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 md:text-body"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />

          <div className="flex shrink-0 items-center pb-0.5">
            {canSend ? (
              <Button
                type="submit"
                size="icon"
                className="size-9 shrink-0 rounded-full"
                aria-label={sendLabel}
              >
                <Send className="size-4" aria-hidden />
              </Button>
            ) : (
              <ComposerToolbarButton
                label={t("chat.composer_voice")}
                disabled={disabled}
                onClick={() => handleAttachAction("voice")}
              >
                <Mic aria-hidden className="size-5" />
              </ComposerToolbarButton>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export type { ComposerAttachAction };
