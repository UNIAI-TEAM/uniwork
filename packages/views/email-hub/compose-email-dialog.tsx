"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import type { EmailHubScheduledSend } from "@uniwork/core/api/endpoints/email-hub";
import { useEmailHubAccounts, useSendEmailHub } from "@uniwork/core/email-hub/hooks";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
import { EMAIL_RE, EmailChipsInput, parseEmails } from "../workspace/email-chips-input";
import { ComposeEmailToolbar, type ComposeDraftAttachment } from "./compose-email-toolbar";
import {
  buildForwardBody,
  buildReplyAllRecipients,
  composeModeDescriptionKey,
  composeModeTitleKey,
  forwardSubject,
  replySubject,
  type ComposeMode,
  type ForwardLabels,
} from "./compose-recipients";
import { plainTextToHtml, readFileAsBase64 } from "./compose-text-helpers";
import { emailHubLocale, formatEmailFullDate, senderDisplayName } from "./email-hub-format";

function isScheduledSend(result: EmailHubThread | EmailHubScheduledSend | null): result is EmailHubScheduledSend {
  return !!result && "scheduled" in result && result.scheduled === true;
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
    <div className="flex min-h-11 items-center gap-3 px-4 py-1">
      <label htmlFor={htmlFor} className="w-14 shrink-0 text-caption font-medium text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const fieldInputClass = "h-9 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0";
const chipsFrameClass =
  "min-h-9 rounded-none border-0 bg-transparent px-0 py-1 has-[>input:focus-visible]:ring-0 pointer-coarse:min-h-11";

type Draft = { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string };

function initialDraft(
  mode: ComposeMode,
  source: EmailHubThread | null | undefined,
  fromEmail: string | null,
  forwardLabels: ForwardLabels | null,
): Draft {
  if (source && mode === "reply") {
    return { to: [source.from_addr], cc: [], bcc: [], subject: replySubject(source.subject), body: "" };
  }
  if (source && mode === "replyAll") {
    const recipients = buildReplyAllRecipients(source, fromEmail);
    return {
      to: parseEmails(recipients.to),
      cc: parseEmails(recipients.cc),
      bcc: [],
      subject: replySubject(source.subject),
      body: "",
    };
  }
  if (source && mode === "forward" && forwardLabels) {
    return {
      to: [],
      cc: [],
      bcc: [],
      subject: forwardSubject(source.subject),
      body: buildForwardBody(source, forwardLabels),
    };
  }
  return { to: [], cc: [], bcc: [], subject: "", body: "" };
}

/** The email being answered, so a reply can be written against it: the compose dialog covers the reading pane. */
function QuotedOriginal({ source }: { source: EmailHubThread }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const text = (source.body_text?.trim() || source.snippet || "").slice(0, 4000);
  if (!text) return null;
  return (
    <div className="border-t border-border px-4 py-2">
      <button
        type="button"
        className="flex min-h-9 items-center gap-1.5 rounded-control px-1 text-caption font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform duration-(--duration-fast)", !open && "-rotate-90")}
          aria-hidden
        />
        {t("email_hub.compose.original", {
          name: senderDisplayName(source.from_name, source.from_addr),
          when: formatEmailFullDate(source.sent_at, emailHubLocale(i18n.language)),
        })}
      </button>
      {open ? (
        <blockquote className="mt-1 max-h-48 overflow-y-auto border-l-2 border-border pl-3 text-caption leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {text}
        </blockquote>
      ) : null}
    </div>
  );
}

interface ComposeEmailDialogProps {
  wsId: string;
  accountId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: ComposeMode;
  sourceThread?: EmailHubThread | null;
  /** Opens the scheduled folder from the "scheduled" toast. */
  onOpenScheduled?: () => void;
}

export function ComposeEmailDialog({
  wsId,
  accountId,
  open,
  onOpenChange,
  mode = "new",
  sourceThread,
  onOpenScheduled,
}: ComposeEmailDialogProps) {
  const { t, i18n } = useTranslation();
  const bodyId = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const send = useSendEmailHub(wsId);
  const { reset: resetSend } = send;
  const accounts = useEmailHubAccounts(wsId);
  const accountList = useMemo(() => accounts.data?.accounts ?? [], [accounts.data?.accounts]);
  // A reply leaves from the mailbox the email arrived in; anything else from the one in view.
  const defaultFromId = (sourceThread && mode !== "new" ? sourceThread.account_id : null) || accountId;
  const [fromId, setFromId] = useState<string | null>(defaultFromId);
  const fromEmail = accountList.find((account) => account.id === fromId)?.email_address ?? null;
  const defaultFromEmail = accountList.find((account) => account.id === defaultFromId)?.email_address ?? null;
  const locale = emailHubLocale(i18n.language);
  const forwardLabels = useMemo<ForwardLabels | null>(
    () =>
      sourceThread
        ? {
            header: t("email_hub.compose.forward_header"),
            from: t("email_hub.compose.from"),
            date: t("email_hub.compose.date"),
            subject: t("email_hub.compose.subject"),
            when: formatEmailFullDate(sourceThread.sent_at, locale),
          }
        : null,
    [locale, sourceThread, t],
  );

  const [draft, setDraft] = useState<Draft>(() => initialDraft(mode, sourceThread, defaultFromEmail, forwardLabels));
  const [initial, setInitial] = useState<Draft>(draft);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [attachments, setAttachments] = useState<ComposeDraftAttachment[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }));

  useEffect(() => {
    if (open) setFromId(defaultFromId);
  }, [open, defaultFromId]);

  useEffect(() => {
    if (!open) return;
    const next = initialDraft(mode, sourceThread, defaultFromEmail, forwardLabels);
    setDraft(next);
    setInitial(next);
    setShowCc(next.cc.length > 0);
    setShowBcc(false);
    setAttachments([]);
    setConfirmDiscard(false);
    // Each opening starts clean: the previous attempt's error is not this draft's.
    resetSend();
  }, [open, mode, sourceThread, defaultFromEmail, forwardLabels, resetSend]);

  const dirty = useMemo(
    () =>
      attachments.length > 0 ||
      draft.subject !== initial.subject ||
      draft.body !== initial.body ||
      draft.to.join() !== initial.to.join() ||
      draft.cc.join() !== initial.cc.join() ||
      draft.bcc.join() !== initial.bcc.join(),
    [attachments.length, draft, initial],
  );

  /** Closing never throws away writing silently: Esc, the backdrop, ✕ and the trash icon all ask first. */
  const requestClose = () => {
    if (send.isPending) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  const sendErrorKey = (() => {
    if (!send.isError) return null;
    switch (errorCode(send.error)) {
      case "email_hub_not_configured":
        return "email_hub.connect.error_not_configured";
      default:
        return "email_hub.compose.error";
    }
  })();

  const buildPayload = async (sendAt?: string) => {
    const trimmedBody = draft.body.trim();
    const attachmentInputs = await Promise.all(
      attachments.map(async (item) => ({
        filename: item.file.name,
        contentType: item.file.type || undefined,
        contentBase64: await readFileAsBase64(item.file),
      })),
    );
    return {
      accountId: fromId!,
      to: draft.to,
      cc: showCc && draft.cc.length ? draft.cc : undefined,
      bcc: showBcc && draft.bcc.length ? draft.bcc : undefined,
      subject: draft.subject.trim(),
      bodyText: trimmedBody,
      bodyHtml: plainTextToHtml(trimmedBody),
      attachments: attachmentInputs.length ? attachmentInputs : undefined,
      sendAt,
      replyToThreadId: mode === "reply" || mode === "replyAll" ? sourceThread?.id : undefined,
    };
  };

  const handleSendSuccess = (result: EmailHubThread | EmailHubScheduledSend | null) => {
    if (isScheduledSend(result)) {
      toast.success(
        t("email_hub.compose.schedule_success", { time: formatEmailFullDate(result.send_at, locale) }),
        onOpenScheduled ? { action: { label: t("email_hub.compose.view_scheduled"), onClick: onOpenScheduled } } : undefined,
      );
    } else {
      toast.success(t("email_hub.compose.sent"));
    }
    onOpenChange(false);
  };

  const submit = (sendAt?: string) => {
    if (!fromId) return;
    void buildPayload(sendAt).then(
      (payload) => send.mutate(payload, { onSuccess: handleSendSuccess }),
      () => toast.error(t("email_hub.compose.attach_read_error")),
    );
  };

  const isReplyLike = mode === "reply" || mode === "replyAll";
  const allRecipients = [...draft.to, ...(showCc ? draft.cc : []), ...(showBcc ? draft.bcc : [])];
  const recipientsValid = draft.to.length > 0 && allRecipients.every((addr) => EMAIL_RE.test(addr));
  const needsSubject = !isReplyLike && mode !== "forward";
  const canSend =
    !!fromId && recipientsValid && !!draft.body.trim() && (!needsSubject || !!draft.subject.trim()) && !send.isPending;
  const sendBlockedReason = !recipientsValid
    ? t("email_hub.compose.need_recipient")
    : needsSubject && !draft.subject.trim()
      ? t("email_hub.compose.need_subject")
      : !draft.body.trim()
        ? t("email_hub.compose.need_body")
        : null;

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
          className="h-8 rounded-control px-2 text-caption text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          onClick={() => setShowCc(true)}
        >
          {t("email_hub.compose.cc")}
        </button>
      ) : null}
      {!showBcc ? (
        <button
          type="button"
          className="h-8 rounded-control px-2 text-caption text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          onClick={() => setShowBcc(true)}
        >
          {t("email_hub.compose.bcc")}
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else requestClose();
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl"
          onKeyDown={handleKeyDown}
          closeLabel={t("common.close")}
        >
          <DialogHeader className="gap-1 border-b border-border py-3.5 pr-12 pl-4 text-left">
            <DialogTitle className="text-title-sm font-semibold">{t(composeModeTitleKey(mode))}</DialogTitle>
            <DialogDescription className="text-caption">{t(composeModeDescriptionKey(mode))}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto">
            <div className="divide-y divide-border border-b border-border">
              <FieldRow label={t("email_hub.compose.from")} htmlFor={accountList.length > 1 ? "email-hub-from" : undefined}>
                {accountList.length > 1 ? (
                  <Select
                    items={accountList.map((acc) => ({ value: acc.id, label: acc.email_address }))}
                    value={fromId ?? ""}
                    onValueChange={(next) => {
                      if (typeof next === "string" && next) setFromId(next);
                    }}
                  >
                    <SelectTrigger id="email-hub-from" size="sm" className="h-9 w-full max-w-none border-0 px-0 shadow-none">
                      <SelectValue>{fromEmail}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {accountList.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.email_address}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="truncate text-body text-foreground">{fromEmail ?? t("email_hub.connect_prompt")}</p>
                )}
              </FieldRow>
              <FieldRow label={t("email_hub.compose.to")} htmlFor="email-hub-to" action={extraFieldToggle}>
                <EmailChipsInput
                  id="email-hub-to"
                  value={draft.to}
                  onChange={(to) => patch({ to })}
                  placeholder={t("email_hub.compose.to_placeholder")}
                  className={chipsFrameClass}
                />
              </FieldRow>
              {showCc ? (
                <FieldRow label={t("email_hub.compose.cc")} htmlFor="email-hub-cc">
                  <EmailChipsInput
                    id="email-hub-cc"
                    value={draft.cc}
                    onChange={(cc) => patch({ cc })}
                    placeholder={t("email_hub.compose.cc_placeholder")}
                    className={chipsFrameClass}
                  />
                </FieldRow>
              ) : null}
              {showBcc ? (
                <FieldRow label={t("email_hub.compose.bcc")} htmlFor="email-hub-bcc">
                  <EmailChipsInput
                    id="email-hub-bcc"
                    value={draft.bcc}
                    onChange={(bcc) => patch({ bcc })}
                    placeholder={t("email_hub.compose.bcc_placeholder")}
                    className={chipsFrameClass}
                  />
                </FieldRow>
              ) : null}
              <FieldRow label={t("email_hub.compose.subject")} htmlFor="email-hub-subject">
                <Input
                  id="email-hub-subject"
                  value={draft.subject}
                  onChange={(e) => patch({ subject: e.target.value })}
                  placeholder={t("email_hub.compose.subject_placeholder")}
                  className={fieldInputClass}
                />
              </FieldRow>
            </div>

            <Textarea
              ref={bodyRef}
              id={bodyId}
              rows={10}
              value={draft.body}
              onChange={(e) => patch({ body: e.target.value })}
              placeholder={t("email_hub.compose.body_placeholder")}
              aria-label={t("email_hub.compose.body")}
              className={cn(
                "min-h-[12rem] resize-y rounded-none border-0 bg-transparent px-4 py-3 text-body shadow-none",
                "focus-visible:border-0 focus-visible:ring-0",
              )}
            />

            {isReplyLike && sourceThread ? <QuotedOriginal source={sourceThread} /> : null}
          </div>

          {sendErrorKey ? (
            <p className="border-t border-border px-4 py-2 text-caption text-destructive" role="alert">
              {t(sendErrorKey)}
            </p>
          ) : null}

          <ComposeEmailToolbar
            bodyRef={bodyRef}
            body={draft.body}
            onBodyChange={(body) => patch({ body })}
            fromEmail={fromEmail}
            to={draft.to.join(", ")}
            cc={showCc ? draft.cc.join(", ") : ""}
            subject={draft.subject}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            canSend={canSend}
            sendBlockedReason={send.isPending ? null : sendBlockedReason}
            sending={send.isPending}
            onSend={() => submit()}
            onScheduleSend={(sendAtIso) => submit(sendAtIso)}
            onDiscard={requestClose}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        nested
        title={t("email_hub.compose.discard_confirm_title")}
        description={t("email_hub.compose.discard_confirm_body")}
        confirmLabel={t("email_hub.compose.discard")}
        cancelLabel={t("email_hub.compose.keep_writing")}
        onConfirm={() => {
          setConfirmDiscard(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
