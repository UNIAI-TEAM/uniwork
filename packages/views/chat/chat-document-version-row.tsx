"use client";

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import type { ChatMessage } from "./chat-messages";

/**
 * UNI-1966 (contract §4.4 / L7): the compact system line a version commit
 * from a card writes — "{{name}} đã tải lên phiên bản {{version}}" with the
 * ordinal in the body. It clicks through to the document only while the
 * viewer's block says they still have access; without a block or without
 * access it stays plain text.
 */
function ChatDocumentVersionRowImpl({
  message,
  senderLabel,
  compactTop,
  highlighted = false,
}: {
  message: ChatMessage;
  /** The resolved display name of the committer (layout.senderLabel). */
  senderLabel: string;
  compactTop?: boolean;
  highlighted?: boolean;
}) {
  const { t } = useTranslation();
  const workspace = useOptionalWorkspace()?.workspace;
  const navigation = useNavigation();
  const doc = message.document;
  const canOpen = doc?.viewer_has_access === true && Boolean(workspace);
  const line = t("chat.document_version_line", {
    name: senderLabel,
    version: message.body,
  });
  const openDocument = () => {
    if (!doc || !workspace) return;
    navigation.push(paths.workspace(workspace.organization_slug, workspace.slug).document(doc.document_id));
  };

  return (
    <article
      id={`chat-msg-${message.id}`}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full justify-center rounded-lg",
        compactTop ? "mt-1" : "mt-2",
        highlighted && "bg-brand-subtle ring-2 ring-brand",
      )}
    >
      {canOpen ? (
        <button
          type="button"
          onClick={openDocument}
          className="pointer-coarse:min-h-11 truncate rounded-md px-2 py-0.5 text-center text-caption text-muted-foreground hover:text-foreground hover:underline"
        >
          {line}
        </button>
      ) : (
        <p className="truncate px-2 py-0.5 text-center text-caption text-muted-foreground">{line}</p>
      )}
    </article>
  );
}

/** One document_version line. Memoised like the other rows. */
export const ChatDocumentVersionRow = memo(ChatDocumentVersionRowImpl);
