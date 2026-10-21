"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDocument } from "@uniwork/core/documents/hooks";
import { ShareDialog } from "../documents/share-dialog";

/**
 * "Chia sẻ" from a chat document card's menu: the documents share dialog for
 * this document. The dialog needs the document object, so the detail query
 * runs only once asked — no fetch for every card on the timeline. Mounted on
 * the first ask, outside the menu, so the menu closing never unmounts the
 * dialog; each later ask (`request`) opens it again.
 */
export function ChatDocumentShare({
  workspaceId,
  documentId,
  request,
}: {
  workspaceId: string;
  documentId: string;
  /** Bumped by every menu ask; each new value asks for the detail and opens the dialog. */
  request: number;
}) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState(false);
  const detail = useDocument(workspaceId, documentId, { enabled: asked });
  // Each error toasts once — keyed on the error object so a second failure
  // toasts again — and every ask resets the report before it re-asks.
  const reportedErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (request <= 0) return;
    // A new ask: the flag resets so a fresh failure toasts again and a
    // success opens the dialog (RFC-08).
    reportedErrorRef.current = null;
    setAsked(true);
    setOpen(true);
  }, [request]);
  useEffect(() => {
    if (!detail.isError || detail.error === reportedErrorRef.current) return;
    reportedErrorRef.current = detail.error;
    setAsked(false);
    toast.error(t("chat.errors.internal"));
  }, [detail.isError, detail.error, t]);
  return detail.data ? <ShareDialog open={open} onOpenChange={setOpen} wsId={workspaceId} doc={detail.data} /> : null;
}
