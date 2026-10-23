"use client";

import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { ComposeEmailToolbar, type ComposeDraftAttachment } from "@uniwork/views/email-hub/compose-email-toolbar";
import { EMAIL_RE, EmailChipsInput } from "@uniwork/views/workspace/email-chips-input";
import { DEMO_MAILBOX } from "./product-email-data";

export type DemoEmailDraft = { id?: string; to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; attachments: ComposeDraftAttachment[] };
export const emptyEmailDraft = (): DemoEmailDraft => ({ to: [], cc: [], bcc: [], subject: "", body: "", attachments: [] });

/** Production composing controls with a local outbox in place of a send mutation. */
export function ProductEmailCompose({ initial, onClose, onSave }: {
  initial: DemoEmailDraft; onClose: (draft: DemoEmailDraft | null) => void;
  onSave: (draft: DemoEmailDraft, sendAt?: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [extra, setExtra] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const recipientFields: ("to" | "cc" | "bcc")[] = extra ? ["to", "cc", "bcc"] : ["to"];
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const patch = (next: Partial<DemoEmailDraft>) => setDraft(value => ({ ...value, ...next }));
  const blocked = !draft.to.length || ![...draft.to, ...draft.cc, ...draft.bcc].every(address => EMAIL_RE.test(address)) ? t("email_hub.compose.need_recipient") : !draft.subject.trim() ? t("email_hub.compose.need_subject") : !draft.body.trim() ? t("email_hub.compose.need_body") : null;
  const close = () => onClose(draft.to.length || draft.subject.trim() || draft.body.trim() ? draft : null);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="product-email-compose max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl" closeLabel={t("common.close")} onKeyDown={event => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !blocked) { event.preventDefault(); onSave(draft); }
    }}>
      <DialogHeader className="gap-1 border-b border-border py-3.5 pr-12 pl-4 text-left"><DialogTitle className="text-title-sm">{t("email_hub.compose.title")}</DialogTitle><DialogDescription className="text-caption">{t("landing.productDemo.email.localOnly")}</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto">
        <div className="divide-y divide-border border-b border-border">
          <div className="product-email-field"><span>{t("email_hub.compose.from")}</span><p>{DEMO_MAILBOX.email_address}</p></div>
          {recipientFields.map(field => <div className="product-email-field" key={field}>
            <label htmlFor={`${id}-${field}`}>{t(`email_hub.compose.${field}`)}</label>
            <EmailChipsInput id={`${id}-${field}`} value={draft[field]} onChange={value => patch({ [field]: value })} placeholder={t(`email_hub.compose.${field}_placeholder`)} className="min-h-9 rounded-none border-0 bg-transparent px-0 py-1 has-[>input:focus-visible]:ring-0" />
            {field === "to" && <Button variant="ghost" size="sm" onClick={() => setExtra(value => !value)} aria-expanded={extra}>{t("email_hub.compose.cc")} / {t("email_hub.compose.bcc")}</Button>}
          </div>)}
          <div className="product-email-field"><label htmlFor={`${id}-subject`}>{t("email_hub.compose.subject")}</label><Input id={`${id}-subject`} value={draft.subject} onChange={event => patch({ subject: event.target.value })} placeholder={t("email_hub.compose.subject_placeholder")} className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" /></div>
        </div>
        <label className="sr-only" htmlFor={`${id}-body`}>{t("email_hub.compose.body")}</label>
        <Textarea id={`${id}-body`} ref={bodyRef} value={draft.body} onChange={event => patch({ body: event.target.value })} placeholder={t("email_hub.compose.body_placeholder")} className="min-h-48 resize-y rounded-none border-0 p-4 shadow-none focus-visible:ring-0" />
        <ComposeEmailToolbar bodyRef={bodyRef} body={draft.body} onBodyChange={body => patch({ body })} fromEmail={DEMO_MAILBOX.email_address} to={draft.to.join(", ")} cc={draft.cc.join(", ")} subject={draft.subject} attachments={draft.attachments} onAttachmentsChange={attachments => patch({ attachments })} canSend={!blocked} sendBlockedReason={blocked} sending={false} onSend={() => onSave(draft)} onScheduleSend={sendAt => onSave(draft, sendAt)} onDiscard={() => onClose(null)} />
      </div>
    </DialogContent>
  </Dialog>;
}
