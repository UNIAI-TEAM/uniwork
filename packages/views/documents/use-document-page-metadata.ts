"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useUpdateDocument } from "@uniwork/core/documents/hooks";
import type { Document } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";

export interface DocumentPageMetadataStatus { dirty: boolean; pending: boolean; failed: boolean }
export interface DocumentPageMetadataHandle {
  hasUnsavedWork: () => boolean;
  flush: () => Promise<boolean>;
}

/** Revisions are decimal counters; a React snapshot can lag a PATCH acknowledgement. */
export function newerPageRevision(acknowledged: string, candidate: string) {
  return /^\d+$/.test(acknowledged) && /^\d+$/.test(candidate)
    && BigInt(acknowledged) > BigInt(candidate) ? acknowledged : candidate;
}

/** Metadata uses the existing PATCH hook; the content save machine stays in its owner. */
export function useDocumentPageMetadata(
  wsId: string,
  doc: Document,
  editable: boolean,
  onTitleChange: (title: string) => void,
  options?: { canPersist?: boolean; getRevision?: () => string;
    onPendingChange?: (pending: boolean) => void; onSaved?: (doc: Document) => void;
    onStatusChange?: (status: DocumentPageMetadataStatus) => void },
) {
  const { t } = useTranslation();
  const update = useUpdateDocument(wsId, doc.id);
  const [title, setTitle] = useState(doc.title);
  const [icon, setIcon] = useState(doc.icon ?? "");
  const [pending, setPending] = useState(false);
  const current = useRef({ title: doc.title, icon: doc.icon ?? "" });
  const acknowledged = useRef({ title: doc.title, icon: doc.icon ?? "", revision: doc.revision });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef(false);
  const flight = useRef<Promise<boolean> | null>(null);
  const failed = useRef(false);
  const active = useRef(true);
  const editableRef = useRef(editable);
  const mutationRef = useRef(update.mutateAsync);
  const changeRef = useRef(onTitleChange);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  editableRef.current = editable;
  mutationRef.current = update.mutateAsync;
  changeRef.current = onTitleChange;

  const hasChanges = useCallback(() =>
    (current.current.title.trim() || t("documents.detail.untitled")) !== acknowledged.current.title
      || current.current.icon !== acknowledged.current.icon,
  [t]);
  const hasUnsavedWork = useCallback(() => saving.current || hasChanges(), [hasChanges]);
  const publishStatus = useCallback((isPending: boolean) => {
    optionsRef.current?.onStatusChange?.({ dirty: hasChanges(), pending: isPending, failed: failed.current });
  }, [hasChanges]);

  useEffect(() => {
    if (newerPageRevision(acknowledged.current.revision, doc.revision) !== doc.revision) return;
    // A refetch may arrive while the title is being edited. Adopt only fields
    // without a local change, so realtime never erases the user's typed title.
    if (current.current.title === acknowledged.current.title) {
      current.current.title = doc.title;
      setTitle(doc.title);
      changeRef.current(doc.title);
    }
    if (current.current.icon === acknowledged.current.icon) {
      current.current.icon = doc.icon ?? "";
      setIcon(doc.icon ?? "");
    }
    acknowledged.current = { title: doc.title, icon: doc.icon ?? "", revision: doc.revision };
    publishStatus(saving.current);
  }, [doc.title, doc.icon, doc.revision, publishStatus]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; clearTimeout(timer.current); };
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (flight.current) return flight.current;
    if (!editableRef.current || optionsRef.current?.canPersist === false) return Promise.resolve(!hasChanges());
    if (!hasChanges()) return Promise.resolve(true);
    saving.current = true;
    failed.current = false;
    setPending(true);
    optionsRef.current?.onPendingChange?.(true);
    publishStatus(true);
    const operation = (async () => {
      try {
        // Serialize title/icon edits so a second metadata write always uses the
        // revision acknowledged by the first, including edits typed in flight.
        while (active.current && editableRef.current) {
          if (optionsRef.current?.canPersist === false) break;
          const next = {
            title: current.current.title.trim() || t("documents.detail.untitled"),
            icon: current.current.icon,
          };
          const base = acknowledged.current;
          const patch = {
            revision: newerPageRevision(base.revision, optionsRef.current?.getRevision?.() ?? base.revision),
            ...(next.title !== base.title ? { title: next.title } : {}),
            ...(next.icon !== base.icon ? { icon: next.icon } : {}),
          };
          if (!patch.title && patch.icon === undefined) break;
          const saved = await mutationRef.current({ patch, idempotencyKey: createSafeId() });
          acknowledged.current = { title: saved.title, icon: saved.icon ?? "", revision: saved.revision };
          optionsRef.current?.onSaved?.(saved);
          if (current.current.title.trim() === "" && active.current) {
            current.current.title = saved.title;
            setTitle(saved.title);
            changeRef.current(saved.title);
          }
        }
        return !hasChanges();
      } catch (error) {
        failed.current = true;
        toast.error(apiErrorMessage(error) ?? t("documents.page_ui.metadata_failed"));
        return false;
      } finally {
        saving.current = false;
        flight.current = null;
        optionsRef.current?.onPendingChange?.(false);
        publishStatus(false);
        if (active.current) setPending(false);
      }
    })();
    flight.current = operation;
    return operation;
  }, [t, hasChanges, publishStatus]);

  useEffect(() => {
    if (options?.canPersist) void flush();
  }, [options?.canPersist, flush]);

  const changeTitle = useCallback((value: string) => {
    const next = value.replace(/[\r\n]+/g, " ");
    current.current.title = next;
    setTitle(next);
    changeRef.current(next);
    failed.current = false;
    publishStatus(saving.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  }, [flush, publishStatus]);

  const changeIcon = useCallback((value: string) => {
    if (!editableRef.current) return;
    current.current.icon = value;
    setIcon(value);
    failed.current = false;
    publishStatus(saving.current);
    void flush();
  }, [flush, publishStatus]);

  return { title, icon, pending, changeTitle, changeIcon, flush, hasUnsavedWork };
}
