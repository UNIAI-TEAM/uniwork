"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import type { EmailHubScheduledSend } from "@uniwork/core/api/endpoints/email-hub";
import { useEmailHubAccounts, useSendEmailHub } from "@uniwork/core/email-hub/hooks";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";
import { ComposeEmailToolbar, type ComposeDraftAttachment } from "./compose-email-toolbar";
import {
  buildForwardBody,
  buildReplyAllRecipients,
  composeModeDescriptionKey,
  composeModeTitleKey,
  forwardSubject,
  replySubject,
  type ComposeMode,
} from "./compose-recipients";
import { buildComposeBodyHtml, readFileAsBase64 } from "./compose-text-helpers";

function isScheduledSend(result: EmailHubThread | EmailHubScheduledSend | null): result is EmailHubScheduledSend {
  return !!result && "scheduled" in result && result.scheduled === true;
}

function parseRecipients(raw: string) {
  return raw
    .split(/[,;]/)
    .map((addr) => addr.trim())
    .filter(Boolean);
}

function FieldRow({
  label,
  htmlFor,
  action,
  children,
}: {
  label: string;
  htmlFor?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1.5">
      <label
        htmlFor={htmlFor}
        className="w-16 shrink-0 text-caption font-medium text-muted-foreground"
      >
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const fieldInputClass =
  "h-9 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0";

interface ComposeEmailDialogProps {
  wsId: string;
  accountId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: ComposeMode;
  sourceThread?: EmailHubThread | null;
  onSent?: (thread: EmailHubThread) => void;
}

export function ComposeEmailDialog({
  wsId,
  accountId,
  open,
  onOpenChange,
  mode = "new",
  sourceThread,
  onSent,
}: ComposeEmailDialogProps) {
  const { t } = useTranslation();
  const bodyId = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const send = useSendEmailHub(wsId);
  const accounts = useEmailHubAccounts(wsId);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<ComposeDraftAttachment[]>([]);

  const fromEmail =
    accounts.data?.accounts.find((account) => account.id === accountId)?.email_address ?? null;

  useEffect(() => {
    if (!open) return;
    setShowCc(false);
    setShowBcc(false);
    setCc("");
    setBcc("");
    setAttachments([]);

    if (sourceThread && mode === "reply") {
      setTo(sourceThread.from_addr);
      setSubject(replySubject(sourceThread.subject));
      setBody("");
      return;
    }
    if (sourceThread && mode === "replyAll") {
      const recipients = buildReplyAllRecipients(sourceThread, fromEmail);
      setTo(recipients.to);
      setCc(recipients.cc);
      setShowCc(!!recipients.cc);
      setSubject(replySubject(sourceThread.subject));
      setBody("");
      return;
    }
    if (sourceThread && mode === "forward") {
      setTo("");
      setSubject(forwardSubject(sourceThread.subject));
      setBody(buildForwardBody({ ...sourceThread, body_text: sourceThread.body_text ?? "" }));
      return;
    }
    setTo("");
    setSubject("");
    setBody("");
  }, [open, mode, sourceThread, fromEmail]);

  const sendErrorKey = (() => {
    if (!send.isError) return null;
    switch (errorCode(send.error)) {
      case "email_hub_not_configured":
        return "email_hub.connect.error_not_configured";
      case "email_hub_send_failed":
        return "email_hub.compose.error";
      default:
        return "email_hub.compose.error";
    }
  })();

  const buildPayload = async (sendAt?: string) => {
    const trimmedBody = body.trim();
    const files = attachments.map((item) => item.file);
    const [attachmentInputs, bodyHtml] = await Promise.all([
      Promise.all(
        attachments.map(async (item) => ({
          filename: item.file.name,
          contentType: item.file.type || undefined,
          contentBase64: await readFileAsBase64(item.file),
        })),
      ),
      buildComposeBodyHtml(trimmedBody, files),
    ]);
    return {
      accountId: accountId!,
      to: parseRecipients(to),
      cc: showCc ? parseRecipients(cc) : undefined,
      bcc: showBcc ? parseRecipients(bcc) : undefined,
      subject: subject.trim(),
      bodyText: trimmedBody,
      bodyHtml,
      attachments: attachmentInputs.length ? attachmentInputs : undefined,
      sendAt,
      replyToThreadId: mode === "reply" || mode === "replyAll" ? sourceThread?.id : undefined,
    };
  };

  const handleSendSuccess = (result: EmailHubThread | EmailHubScheduledSend | null) => {
    if (isScheduledSend(result)) {
      toast.success(
        t("email_hub.compose.schedule_success", {
          time: new Date(result.send_at).toLocaleString(),
        }),
      );
    } else if (result) {
      onSent?.(result);
    }
    onOpenChange(false);
  };

  const submit = () => {
    if (!accountId) return;
    void buildPayload().then((payload) => {
      send.mutate(payload, { onSuccess: handleSendSuccess });
    });
  };

  const scheduleSubmit = (sendAtIso: string) => {
    if (!accountId) return;
    void buildPayload(sendAtIso).then((payload) => {
      send.mutate(payload, { onSuccess: handleSendSuccess });
    });
  };

  const isReplyLike = mode === "reply" || mode === "replyAll";
  const canSend =
    !!accountId && !!to.trim() && !!body.trim() && (!isReplyLike && mode !== "forward" ? !!subject.trim() : true) && !send.isPending;

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSend) {
      event.preventDefault();
      submit();
    }
  };

  const extraFieldToggle = !showCc || !showBcc ? (
    <div className="flex gap-1">
      {!showCc ? (
        <button
          type="button"
          className="h-8 px-2 text-caption text-muted-foreground hover:text-foreground"
          onClick={() => setShowCc(true)}
        >
          {t("email_hub.compose.cc")}
        </button>
      ) : null}
      {!showBcc ? (
        <button
          type="button"
          className="h-8 px-2 text-caption text-muted-foreground hover:text-foreground"
          onClick={() => setShowBcc(true)}
        >
          {t("email_hub.compose.bcc")}
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <div className="flex items-start gap-3 border-b border-border px-4 py-4">
          <IconTile icon={Mail} tone={moduleTone("email")} size="sm" className="mt-0.5 shrink-0" />
          <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
            <DialogTitle className="text-title">{t(composeModeTitleKey(mode))}</DialogTitle>
            <DialogDescription className="text-caption text-muted-foreground">
              {t(composeModeDescriptionKey(mode))}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="divide-y divide-border border-b border-border">
          <FieldRow label={t("email_hub.compose.from")}>
            <p className="truncate text-body text-foreground">{fromEmail ?? t("email_hub.connect_prompt")}</p>
          </FieldRow>

          <FieldRow label={t("email_hub.compose.to")} htmlFor="email-hub-to" action={extraFieldToggle}>
            <Input
              id="email-hub-to"
              type="email"
              autoComplete="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t("email_hub.compose.to_placeholder")}
              className={fieldInputClass}
            />
          </FieldRow>

          {showCc ? (
            <FieldRow label={t("email_hub.compose.cc")} htmlFor="email-hub-cc">
              <Input
                id="email-hub-cc"
                type="email"
                autoComplete="email"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder={t("email_hub.compose.cc_placeholder")}
                className={fieldInputClass}
              />
            </FieldRow>
          ) : null}

          {showBcc ? (
            <FieldRow label={t("email_hub.compose.bcc")} htmlFor="email-hub-bcc">
              <Input
                id="email-hub-bcc"
                type="email"
                autoComplete="email"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder={t("email_hub.compose.bcc_placeholder")}
                className={fieldInputClass}
              />
            </FieldRow>
          ) : null}

          <FieldRow label={t("email_hub.compose.subject")} htmlFor="email-hub-subject">
            <Input
              id="email-hub-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("email_hub.compose.subject_placeholder")}
              className={fieldInputClass}
            />
          </FieldRow>
        </div>

        <Textarea
          ref={bodyRef}
          id={bodyId}
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("email_hub.compose.body_placeholder")}
          aria-label={t("email_hub.compose.body")}
          className={cn(
            "min-h-[220px] resize-y rounded-none border-0 bg-transparent px-4 py-3 text-body shadow-none",
            "focus-visible:border-0 focus-visible:ring-0",
          )}
        />

        {sendErrorKey ? (
          <p className="border-t border-border px-4 py-2 text-caption text-destructive" role="alert">
            {t(sendErrorKey)}
          </p>
        ) : null}

        <ComposeEmailToolbar
          bodyRef={bodyRef}
          body={body}
          onBodyChange={setBody}
          fromEmail={fromEmail}
          to={to}
          cc={showCc ? cc : ""}
          subject={subject}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          canSend={canSend}
          sending={send.isPending}
          onSend={submit}
          onScheduleSend={scheduleSubmit}
          onDiscard={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
