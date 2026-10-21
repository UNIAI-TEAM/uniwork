"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatDocumentShareLevel } from "@uniwork/core/api/endpoints/chat";
import { useSendChatDocumentLink } from "@uniwork/core/chat";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import { documentKeys } from "@uniwork/core/documents/keys";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { DocumentTypeIcon, documentIconFormat } from "../documents/document-type-icon";
import { formatSearchPath } from "../documents/documents-search-results";
import { CollectionPageState } from "../layout/collection-page";
import { MODULE_ICONS } from "../layout/module-icons";
import { MODULE_TONES } from "../layout/module-tones";
import { CHAT_DIALOG_BODY_CLASS, CHAT_DIALOG_CLASS, CHAT_DIALOG_WIDTH } from "./chat-dialog-look";
import { chatDocumentLinkError, isChatClientMsgIdSpent, isChatDocumentLinkStale } from "./chat-error-message";
import { ChatComposerShareLevelPicker } from "./chat-composer-share-level";
import { useChatDocumentPicker, type ChatPickerDocument } from "./use-chat-document-picker";
import { moveRowFocus, useMemberPickerFocus, WorkspaceMemberSearchField } from "./workspace-member-picker";

const SEARCH_ID = "chat-document-picker-search";

function DocumentRowButton({ row, onPick }: { row: ChatPickerDocument; onPick: (row: ChatPickerDocument) => void }) {
  const { t, i18n } = useTranslation();
  const place = formatSearchPath(row.path).display;
  // A root document has no path: the date tells same-titled ones apart.
  const caption =
    place ||
    (row.updated_at
      ? t("chat.document_picker.updated_at", {
          date: new Intl.DateTimeFormat(i18n.language || undefined, { dateStyle: "short" }).format(new Date(row.updated_at)),
        })
      : "");
  return (
    <li>
      <button
        type="button"
        data-member-picker-row=""
        className="pointer-coarse:min-h-11 flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:-outline-offset-2"
        onClick={() => onPick(row)}
      >
        <DocumentTypeIcon format={documentIconFormat(row.kind, row.title)} className="size-7" decorative />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-foreground">{row.title}</span>
          {caption ? <span className="block truncate text-caption text-muted-foreground">{caption}</span> : null}
        </span>
      </button>
    </li>
  );
}

function PickerList({
  picker,
  onPick,
  listRef,
}: {
  picker: ReturnType<typeof useChatDocumentPicker>;
  onPick: (row: ChatPickerDocument) => void;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  if (picker.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label={t("chat.document_picker.loading")} className="size-5 text-muted-foreground" />
      </div>
    );
  }
  if (picker.isError) {
    return (
      <CollectionPageState
        icon={CircleAlert}
        tone="destructive"
        role="alert"
        headingLevel={3}
        className="py-8"
        title={t("chat.document_picker.error_title")}
        description={t("chat.document_picker.error_description")}
        actions={
          <Button type="button" variant="outline" onClick={picker.refetch}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  }
  if (picker.rows.length === 0) {
    const query = picker.query.trim();
    return (
      <CollectionPageState
        icon={MODULE_ICONS.documents}
        tone={MODULE_TONES.documents}
        role="status"
        headingLevel={3}
        className="py-8"
        title={query ? t("chat.document_picker.empty_search_title", { query }) : t("chat.document_picker.empty_title")}
        description={t("chat.document_picker.empty_description")}
      />
    );
  }
  return (
    <div ref={listRef} className="space-y-2">
      {/* The list only forwards arrow keys to its row buttons; the rows are the interactive elements. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <ul
        aria-label={t("chat.document_picker.list_label")}
        className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border p-1"
        onKeyDown={moveRowFocus}
      >
        {picker.rows.map((row) => (
          <DocumentRowButton key={row.id} row={row} onPick={onPick} />
        ))}
      </ul>
      {picker.hasNextPage ? (
        <Button type="button" variant="ghost" size="sm" aria-disabled={picker.isFetchingNextPage || undefined} onClick={picker.fetchNextPage}>
          {picker.isFetchingNextPage ? <Spinner data-icon="inline-start" /> : null}
          {t("chat.document_picker.load_more")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * "Đính kèm từ Tài liệu" (UNI-2012 S5): send a document that already exists
 * into the open room. Step one lists what the sender may share (the picker
 * filters, it never greys — see canShareDocumentForChat); step two picks the
 * level the room gets, and the send goes by the document-link route.
 */
export function ChatDocumentPicker({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  replyToId,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  /** The message the composer is answering: the card goes out as its reply. */
  replyToId?: string;
  /** After a successful send: the host drops the reply it held. */
  onSent?: () => void;
}) {
  const { t } = useTranslation();
  const picker = useChatDocumentPicker(workspaceId, open);
  const sendLink = useSendChatDocumentLink(workspaceId);
  const qc = useQueryClient();
  const { inputRef: searchRef, listRef, focusInput, focusFirstRow } = useMemberPickerFocus();
  const levelRef = useRef<HTMLDivElement>(null);
  const wasSelected = useRef(false);
  const [selected, setSelected] = useState<ChatPickerDocument | null>(null);
  const [level, setLevel] = useState<ChatDocumentShareLevel>("comment");
  // One key per intent (document + level): a retry after a failure replays
  // the same send instead of minting a second card.
  const clientMsgId = useRef<string | null>(null);

  useEffect(() => {
    if (open) return;
    wasSelected.current = false;
    setSelected(null);
    setLevel("comment");
    clientMsgId.current = null;
  }, [open]);

  // The step swap unmounts the button that held focus: carry it to the level
  // control after a pick and back to the search field after Back.
  useEffect(() => {
    if (selected && !wasSelected.current) levelRef.current?.querySelector("button")?.focus();
    else if (!selected && wasSelected.current) focusInput();
    wasSelected.current = Boolean(selected);
  }, [selected, focusInput]);

  const pick = (row: ChatPickerDocument) => {
    setSelected(row);
    setLevel("comment");
    clientMsgId.current = newChatClientMsgId();
  };
  const changeLevel = (next: ChatDocumentShareLevel) => {
    setLevel(next);
    clientMsgId.current = newChatClientMsgId();
  };

  const submit = () => {
    if (!selected || sendLink.isPending) return;
    clientMsgId.current ??= newChatClientMsgId();
    void sendLink
      .mutateAsync({
        roomId,
        document_id: selected.id,
        share_level: level,
        client_msg_id: clientMsgId.current,
        reply_to_message_id: replyToId,
      })
      .then(() => {
        onSent?.();
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        toast.error(chatDocumentLinkError(err, t, t("chat.document_picker.send_failed")));
        // The key of a spent intent would only replay the same refusal.
        if (isChatClientMsgIdSpent(err)) clientMsgId.current = newChatClientMsgId();
        if (isChatDocumentLinkStale(err)) {
          // The document changed under the list (trashed, shelved, unshared):
          // refetch what the picker shows and send the person back to it, so
          // the row they chose is gone rather than failing again.
          void qc.invalidateQueries({ queryKey: documentKeys.recent(workspaceId) });
          void qc.invalidateQueries({ queryKey: documentKeys.listRoot(workspaceId) });
          setSelected(null);
        }
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="md" className={`${CHAT_DIALOG_CLASS} ${CHAT_DIALOG_WIDTH.form}`} initialFocus={selected ? undefined : searchRef}>
        <FormDialogHeader
          title={t("chat.document_picker.title")}
          description={selected ? t("chat.document_picker.level_description") : t("chat.document_picker.description")}
        />
        <FormDialogBody className={`${CHAT_DIALOG_BODY_CLASS} space-y-4`}>
          {selected ? (
            <>
              <div className="space-y-2">
                <p className="text-label font-semibold text-foreground">{t("chat.document_picker.selected_label")}</p>
                <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                  <DocumentTypeIcon format={documentIconFormat(selected.kind, selected.title)} className="size-7" decorative />
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">{selected.title}</span>
                </div>
              </div>
              <div ref={levelRef} className="space-y-1">
                <ChatComposerShareLevelPicker value={level} onChange={changeLevel} disabled={sendLink.isPending} />
                <p className="text-caption text-muted-foreground">{t("chat.document_picker.level_hint")}</p>
              </div>
            </>
          ) : (
            <>
              <WorkspaceMemberSearchField
                id={SEARCH_ID}
                label={t("chat.document_picker.search_label")}
                query={picker.query}
                onQueryChange={picker.setQuery}
                onSubmit={() => undefined}
                placeholder={t("chat.document_picker.search_placeholder")}
                inputRef={searchRef}
                onArrowDown={focusFirstRow}
              />
              <PickerList picker={picker} onPick={pick} listRef={listRef} />
            </>
          )}
        </FormDialogBody>
        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          cancelVariant="secondary"
          submitLabel={selected ? t("chat.document_picker.send") : undefined}
          submittingLabel={t("chat.document_picker.sending")}
          submitting={sendLink.isPending}
          onSubmit={submit}
          leading={
            selected ? (
              <Button type="button" variant="ghost" size="sm" aria-disabled={sendLink.isPending || undefined} onClick={() => setSelected(null)}>
                {t("common.back")}
              </Button>
            ) : undefined
          }
        />
      </FormDialogContent>
    </Dialog>
  );
}
