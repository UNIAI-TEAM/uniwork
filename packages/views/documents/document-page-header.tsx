"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import { useDocumentComments } from "@uniwork/core/documents/hooks-comments";
import type { Document } from "@uniwork/core/types/document";
import { DocumentPageIcon } from "./document-page-icon";
import { useDocumentPageMetadata } from "./use-document-page-metadata";

interface DocumentPageHeaderProps {
  wsId: string;
  doc: Document;
  editable: boolean;
  titleRef?: RefObject<HTMLTextAreaElement | null>;
  onTitleChange: (title: string) => void;
  onFocusBody: () => void;
  canPersist?: boolean;
  getRevision?: () => string;
  onPendingChange?: (pending: boolean) => void;
  onSaved?: (doc: Document) => void;
}

export function DocumentPageHeader({ wsId, doc, editable, titleRef, onTitleChange, onFocusBody,
  canPersist, getRevision, onPendingChange, onSaved }: DocumentPageHeaderProps) {
  const { t, i18n } = useTranslation();
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = titleRef ?? ownRef;
  const metadata = useDocumentPageMetadata(wsId, doc, editable, onTitleChange, { canPersist, getRevision, onPendingChange, onSaved });
  const members = useMembers(wsId);
  const comments = useDocumentComments(wsId, doc.id);
  const author = members.data?.find((member) => member.user_id === doc.updated_by)?.display_name;
  const date = doc.updated_at ? new Date(doc.updated_at) : null;
  const time = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(date)
    : null;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [inputRef, metadata.title, editable]);

  useEffect(() => {
    if (!editable || doc.title !== t("documents.page.new_page")) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    // Select the default title once on arrival, never on a metadata refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="group mb-8 min-w-0">
      {editable ? <DocumentPageIcon icon={metadata.icon} onChange={metadata.changeIcon} />
        : metadata.icon ? <div className="mb-4 text-display" aria-hidden>{metadata.icon}</div> : null}
      {editable ? (
        <textarea ref={inputRef} rows={1} value={metadata.title}
          aria-label={t("documents.page_ui.title_label")} placeholder={t("documents.detail.untitled")}
          aria-busy={metadata.pending || undefined}
          className="block min-h-10 w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0 font-heading text-display-sm font-semibold tracking-tight text-foreground placeholder:text-muted-foreground sm:text-display"
          onChange={(event) => metadata.changeTitle(event.target.value)} onBlur={() => void metadata.flush()}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void metadata.flush();
            onFocusBody();
          }}
        />
      ) : <h1 className="break-words text-display-sm font-semibold tracking-tight sm:text-display">{doc.title || t("documents.detail.untitled")}</h1>}
      {time || comments.data ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          {time ? <time dateTime={doc.updated_at} title={date?.toLocaleString(i18n.language)}>
            {author ? t("documents.page_ui.updated_by", { time, name: author }) : t("documents.page_ui.updated_at", { time })}
          </time> : null}
          {comments.data ? <span>{t("documents.page_ui.comment_count", { count: comments.data.length })}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
