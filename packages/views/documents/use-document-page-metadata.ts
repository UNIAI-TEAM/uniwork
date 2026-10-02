"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useUpdateDocument } from "@uniwork/core/documents/hooks";
import type { Document } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";

/** Metadata uses the existing PATCH hook; the content save machine stays in its owner. */
export function useDocumentPageMetadata(
  wsId: string,
  doc: Document,
  editable: boolean,
  onTitleChange: (title: string) => void,
  options?: { canPersist?: boolean; getRevision?: () => string;
    onPendingChange?: (pending: boolean) => void; onSaved?: (doc: Document) => void },
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
  const active = useRef(true);
  const editableRef = useRef(editable);
  const mutationRef = useRef(update.mutateAsync);
  const changeRef = useRef(onTitleChange);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  editableRef.current = editable;
  mutationRef.current = update.mutateAsync;
  changeRef.current = onTitleChange;

  useEffect(() => {
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
  }, [doc.title, doc.icon, doc.revision]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; clearTimeout(timer.current); };
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!editableRef.current || saving.current || optionsRef.current?.canPersist === false) return;
    const requestedTitle = current.current.title.trim() || t("documents.detail.untitled");
    if (requestedTitle === acknowledged.current.title && current.current.icon === acknowledged.current.icon) return;
    saving.current = true;
    setPending(true);
    optionsRef.current?.onPendingChange?.(true);
    try {
      // Serialize title/icon edits so a second metadata write always uses the
      // revision acknowledged by the first, including edits typed in flight.
      while (active.current && editableRef.current) {
        const next = {
          title: current.current.title.trim() || t("documents.detail.untitled"),
          icon: current.current.icon,
        };
        const base = acknowledged.current;
        const patch = {
          revision: optionsRef.current?.getRevision?.() ?? base.revision,
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
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? t("documents.page_ui.metadata_failed"));
    } finally {
      saving.current = false;
      optionsRef.current?.onPendingChange?.(false);
      if (active.current) setPending(false);
    }
  }, [t]);

  useEffect(() => {
    if (options?.canPersist) void flush();
  }, [options?.canPersist, flush]);

  const changeTitle = useCallback((value: string) => {
    const next = value.replace(/[\r\n]+/g, " ");
    current.current.title = next;
    setTitle(next);
    changeRef.current(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  }, [flush]);

  const changeIcon = useCallback((value: string) => {
    if (!editableRef.current) return;
    current.current.icon = value;
    setIcon(value);
    void flush();
  }, [flush]);

  return { title, icon, pending, changeTitle, changeIcon, flush };
}
