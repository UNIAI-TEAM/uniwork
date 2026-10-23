"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateChatRoomSettings } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { chatErrorMessage } from "./chat-error-message";
import { ChatInfoSection } from "./chat-info-panel-parts";

/** Mirrors chatChannelTopicMaxRunes on the server, which caps every room's topic. */
const TOPIC_MAX_LENGTH = 280;

/**
 * "Mô tả": the room's topic. Whoever may rename the room edits it in place;
 * `onEdit` sends the edit elsewhere instead (a channel's settings form).
 */
export function ChatInfoDescription({
  workspaceId,
  roomId,
  topic,
  canEdit,
  onEdit,
}: {
  workspaceId: string;
  roomId: string;
  topic: string;
  canEdit: boolean;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateChatRoomSettings(workspaceId);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = topic.trim();

  const startEdit = () => {
    if (onEdit) {
      onEdit();
      return;
    }
    setDraft(text);
    setError(null);
  };
  const save = () => {
    if (draft === null || update.isPending) return;
    const next = draft.trim();
    if (next === text) {
      setDraft(null);
      return;
    }
    void update
      .mutateAsync({ roomId, topic: next })
      .then(() => setDraft(null))
      .catch((err: unknown) => setError(chatErrorMessage(err, t, t("chat.info_panel.description_failed"))));
  };

  return (
    <ChatInfoSection title={t("chat.info_panel.description_title")}>
      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            maxLength={TOPIC_MAX_LENGTH}
            aria-label={t("chat.info_panel.description_title")}
            aria-invalid={error ? true : undefined}
            placeholder={t("chat.info_panel.description_placeholder")}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setDraft(null);
              }
            }}
          />
          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" size="sm" disabled={update.isPending} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : text && canEdit ? (
        // The canvas draws no pencil: whoever may edit taps the text itself.
        <button
          type="button"
          title={t("chat.info_panel.description_edit")}
          aria-label={`${t("chat.info_panel.description_edit")}: ${text}`}
          className="-mx-2 -my-1 block w-[calc(100%+1rem)] cursor-pointer rounded-lg px-2 py-1 text-left text-body whitespace-pre-line text-foreground hover:bg-surface-hover"
          onClick={startEdit}
        >
          {text}
        </button>
      ) : text ? (
        <p className="text-body whitespace-pre-line text-foreground">{text}</p>
      ) : canEdit ? (
        <button
          type="button"
          className="cursor-pointer text-body font-medium text-primary hover:underline"
          onClick={startEdit}
        >
          {t("chat.info_panel.description_add")}
        </button>
      ) : (
        <p className="text-body text-muted-foreground">{t("chat.info_panel.description_empty")}</p>
      )}
    </ChatInfoSection>
  );
}
