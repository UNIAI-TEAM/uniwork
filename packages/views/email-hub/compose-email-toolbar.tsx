"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ChevronDown,
  HardDrive,
  Image,
  Link2,
  Lock,
  MoreVertical,
  Paperclip,
  PenLine,
  Smile,
  Trash2,
  Type,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { insertTextareaAtCursor, wrapTextareaSelection } from "./compose-text-helpers";

const QUICK_EMOJIS = ["😀", "😊", "👍", "🙏", "❤️", "🎉", "✅", "🔥", "😂", "🤔", "👋", "💡"];

function ToolbarIconButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
  className,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        pressed && "bg-muted text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

interface ComposeEmailToolbarProps {
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  body: string;
  onBodyChange: (value: string) => void;
  canSend: boolean;
  sending: boolean;
  onSend: () => void;
  onDiscard: () => void;
}

export function ComposeEmailToolbar({
  bodyRef,
  body,
  onBodyChange,
  canSend,
  sending,
  onSend,
  onDiscard,
}: ComposeEmailToolbarProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const comingSoon = () => {
    toast.info(t("email_hub.compose.coming_soon"));
  };

  const applyBodyEdit = (next: string, cursor: number, selectStart?: number, selectEnd?: number) => {
    onBodyChange(next);
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      if (selectStart !== undefined && selectEnd !== undefined) {
        el.setSelectionRange(selectStart, selectEnd);
      } else {
        el.setSelectionRange(cursor, cursor);
      }
    });
  };

  const wrapSelection = (before: string, after: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const { next, cursor, selectionStart, selectionEnd } = wrapTextareaSelection(
      body,
      el.selectionStart,
      el.selectionEnd,
      before,
      after,
    );
    applyBodyEdit(next, cursor, selectionStart, selectionEnd);
  };

  const insertAtCursor = (text: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const { next, cursor } = insertTextareaAtCursor(body, el.selectionStart, el.selectionEnd, text);
    applyBodyEdit(next, cursor);
  };

  const handleLinkOpenChange = (open: boolean) => {
    if (open) {
      const el = bodyRef.current;
      setLinkText(el ? body.slice(el.selectionStart, el.selectionEnd) : "");
      setLinkUrl("");
    }
    setLinkOpen(open);
  };

  const insertLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    const label = linkText.trim() || url;
    insertAtCursor(`${label} (${url})`);
    setLinkOpen(false);
    setLinkText("");
    setLinkUrl("");
  };

  const insertEmoji = (emoji: string) => {
    insertAtCursor(emoji);
    setEmojiOpen(false);
  };

  return (
    <>
      {formatOpen ? (
        <div
          className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-2"
          role="toolbar"
          aria-label={t("email_hub.compose.formatting")}
        >
          <Button type="button" size="sm" variant="ghost" className="h-8 min-w-8 px-2 font-bold" onClick={() => wrapSelection("*", "*")}>
            B
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 min-w-8 px-2 italic" onClick={() => wrapSelection("_", "_")}>
            I
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 min-w-8 px-2 underline" onClick={() => wrapSelection("<u>", "</u>")}>
            U
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2"
            onClick={() => handleLinkOpenChange(true)}
          >
            <Link2 className="size-3.5" aria-hidden />
            {t("email_hub.compose.link")}
          </Button>
          <p className="ml-1 text-caption text-muted-foreground">{t("email_hub.compose.format_plain_hint")}</p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg">
            <Button
              type="button"
              size="sm"
              disabled={!canSend}
              onClick={onSend}
              className="rounded-r-none px-4"
            >
              {sending ? t("email_hub.compose.sending") : t("email_hub.compose.send")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={!canSend}
              onClick={comingSoon}
              className="rounded-l-none border-l border-primary-foreground/25 px-2"
              aria-label={t("email_hub.compose.schedule_send")}
            >
              <ChevronDown className="size-4" aria-hidden />
            </Button>
          </div>

          <ToolbarIconButton
            label={t("email_hub.compose.formatting")}
            pressed={formatOpen}
            onClick={() => setFormatOpen((open) => !open)}
          >
            <Type className="size-5" aria-hidden />
          </ToolbarIconButton>

          <ToolbarIconButton label={t("email_hub.compose.attach")} onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="size-5" aria-hidden />
          </ToolbarIconButton>

          <Popover open={linkOpen} onOpenChange={handleLinkOpenChange}>
            <PopoverTrigger
              render={
                <ToolbarIconButton label={t("email_hub.compose.link")}>
                  <Link2 className="size-5" aria-hidden />
                </ToolbarIconButton>
              }
            />
            <PopoverContent align="start" side="top" className="w-80 space-y-3 p-3">
              <p className="text-body font-medium">{t("email_hub.compose.insert_link")}</p>
              <Input
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder={t("email_hub.compose.link_text_placeholder")}
                aria-label={t("email_hub.compose.link_text_placeholder")}
              />
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://"
                type="url"
                aria-label={t("email_hub.compose.link_url_placeholder")}
              />
              <Button type="button" size="sm" className="w-full" disabled={!linkUrl.trim()} onClick={insertLink}>
                {t("email_hub.compose.insert_link")}
              </Button>
            </PopoverContent>
          </Popover>

          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger
              render={
                <ToolbarIconButton label={t("email_hub.compose.emoji")}>
                  <Smile className="size-5" aria-hidden />
                </ToolbarIconButton>
              }
            />
            <PopoverContent align="start" side="top" className="w-auto p-2">
              <div className="grid grid-cols-6 gap-1" role="group" aria-label={t("email_hub.compose.emoji")}>
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={emoji}
                    className="flex size-9 items-center justify-center rounded-md text-lg hover:bg-muted"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <ToolbarIconButton label={t("email_hub.compose.drive")} onClick={comingSoon}>
            <HardDrive className="size-5" aria-hidden />
          </ToolbarIconButton>

          <ToolbarIconButton label={t("email_hub.compose.insert_image")} onClick={comingSoon}>
            <Image className="size-5" aria-hidden />
          </ToolbarIconButton>

          <ToolbarIconButton label={t("email_hub.compose.confidential")} onClick={comingSoon}>
            <Lock className="size-5" aria-hidden />
          </ToolbarIconButton>

          <ToolbarIconButton label={t("email_hub.compose.signature")} onClick={comingSoon}>
            <PenLine className="size-5" aria-hidden />
          </ToolbarIconButton>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <ToolbarIconButton label={t("email_hub.compose.more")}>
                  <MoreVertical className="size-5" aria-hidden />
                </ToolbarIconButton>
              }
            />
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={comingSoon}>{t("email_hub.compose.plain_text")}</DropdownMenuItem>
              <DropdownMenuItem onClick={comingSoon}>{t("email_hub.compose.print")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ToolbarIconButton label={t("email_hub.compose.discard")} onClick={onDiscard} className="shrink-0">
          <Trash2 className="size-5" aria-hidden />
        </ToolbarIconButton>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        multiple
        aria-hidden
        tabIndex={-1}
        onChange={() => {
          if (fileInputRef.current) fileInputRef.current.value = "";
          comingSoon();
        }}
      />
    </>
  );
}
