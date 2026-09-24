"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ChevronDown,
  Image,
  Link2,
  MoreVertical,
  Paperclip,
  PenLine,
  Printer,
  Smile,
  Trash2,
  Type,
  X,
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
import { DateTimeField } from "../common/datetime-field";
import { toDateOnly } from "../common/date-field";
import { insertTextareaAtCursor, printComposeDraft, wrapTextareaSelection } from "./compose-text-helpers";

const QUICK_EMOJIS = ["😀", "😊", "👍", "🙏", "❤️", "🎉", "✅", "🔥", "😂", "🤔", "👋", "💡"];
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;

export type ComposeDraftAttachment = {
  id: string;
  file: File;
};

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
  fromEmail: string | null;
  to: string;
  cc: string;
  subject: string;
  attachments: ComposeDraftAttachment[];
  onAttachmentsChange: (attachments: ComposeDraftAttachment[]) => void;
  canSend: boolean;
  sending: boolean;
  onSend: () => void;
  onScheduleSend: (sendAtIso: string) => void;
  onDiscard: () => void;
}

export function ComposeEmailToolbar({
  bodyRef,
  body,
  onBodyChange,
  fromEmail,
  to,
  cc,
  subject,
  attachments,
  onAttachmentsChange,
  canSend,
  sending,
  onSend,
  onScheduleSend,
  onDiscard,
}: ComposeEmailToolbarProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");

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

  const insertImageLink = () => {
    const url = imageUrl.trim();
    if (!url) return;
    insertAtCursor(`\n![](${url})\n`);
    setImageOpen(false);
    setImageUrl("");
  };

  const insertEmoji = (emoji: string) => {
    insertAtCursor(emoji);
    setEmojiOpen(false);
  };

  const insertSignature = () => {
    const email = fromEmail?.trim();
    if (!email) {
      toast.error(t("email_hub.connect_prompt"));
      return;
    }
    const block = `\n\n--\n${email}`;
    insertAtCursor(body.trim() ? block : email);
  };

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...attachments];
    for (const file of files) {
      if (next.length >= MAX_ATTACHMENT_COUNT) {
        toast.error(t("email_hub.compose.attach_limit"));
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(t("email_hub.compose.attach_too_large", { name: file.name }));
        continue;
      }
      next.push({ id: `${file.name}-${file.size}-${file.lastModified}`, file });
    }
    onAttachmentsChange(next);
  };

  const removeAttachment = (id: string) => {
    onAttachmentsChange(attachments.filter((item) => item.id !== id));
  };

  const submitSchedule = () => {
    if (!scheduleAt) return;
    const sendAt = new Date(scheduleAt);
    if (Number.isNaN(sendAt.getTime())) {
      toast.error(t("email_hub.compose.schedule_invalid"));
      return;
    }
    onScheduleSend(sendAt.toISOString());
    setScheduleOpen(false);
    setScheduleAt("");
  };

  const printDraft = () => {
    if (!fromEmail) return;
    printComposeDraft({ from: fromEmail, to, cc, subject, body });
  };

  return (
    <>
      {attachments.length ? (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
          {attachments.map((item) => (
            <span
              key={item.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-caption"
            >
              <Paperclip className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{item.file.name}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background"
                aria-label={t("email_hub.compose.remove_attachment")}
                onClick={() => removeAttachment(item.id)}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}

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
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2" onClick={() => handleLinkOpenChange(true)}>
            <Link2 className="size-3.5" aria-hidden />
            {t("email_hub.compose.link")}
          </Button>
          <p className="ml-1 text-caption text-muted-foreground">{t("email_hub.compose.format_plain_hint")}</p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg">
            <Button type="button" size="sm" disabled={!canSend} onClick={onSend} className="rounded-r-none px-4">
              {sending ? t("email_hub.compose.sending") : t("email_hub.compose.send")}
            </Button>
            <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    disabled={!canSend}
                    className="rounded-l-none border-l border-primary-foreground/25 px-2"
                    aria-label={t("email_hub.compose.schedule_send")}
                  >
                    <ChevronDown className="size-4" aria-hidden />
                  </Button>
                }
              />
              <PopoverContent align="start" side="top" className="w-80 space-y-3 p-3">
                <p className="text-body font-medium">{t("email_hub.compose.schedule_send")}</p>
                <DateTimeField
                  value={scheduleAt}
                  onChange={setScheduleAt}
                  minDate={toDateOnly(new Date())}
                  hourLabel={t("common.hour")}
                  minuteLabel={t("common.minute")}
                />
                <Button type="button" size="sm" className="w-full" disabled={!scheduleAt || !canSend} onClick={submitSchedule}>
                  {t("email_hub.compose.schedule_confirm")}
                </Button>
              </PopoverContent>
            </Popover>
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

          <Popover open={imageOpen} onOpenChange={setImageOpen}>
            <PopoverTrigger
              render={
                <ToolbarIconButton label={t("email_hub.compose.insert_image")}>
                  <Image className="size-5" aria-hidden />
                </ToolbarIconButton>
              }
            />
            <PopoverContent align="start" side="top" className="w-80 space-y-3 p-3">
              <p className="text-body font-medium">{t("email_hub.compose.insert_image")}</p>
              <p className="text-caption text-muted-foreground">{t("email_hub.compose.image_plain_hint")}</p>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://"
                type="url"
                aria-label={t("email_hub.compose.image_url_placeholder")}
              />
              <Button type="button" size="sm" className="w-full" disabled={!imageUrl.trim()} onClick={insertImageLink}>
                {t("email_hub.compose.insert_image")}
              </Button>
            </PopoverContent>
          </Popover>

          <ToolbarIconButton label={t("email_hub.compose.signature")} onClick={insertSignature}>
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
              <DropdownMenuItem onClick={printDraft}>
                <Printer className="size-4" aria-hidden />
                {t("email_hub.compose.print")}
              </DropdownMenuItem>
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
        onChange={(event) => {
          addAttachments(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}
