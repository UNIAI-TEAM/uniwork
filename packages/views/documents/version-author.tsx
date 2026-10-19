"use client";

import { useTranslation } from "react-i18next";
import type { DocumentVersion } from "@uniwork/core/types/document";
import type { Member } from "@uniwork/core/types/workspace";
import { AgentBadge } from "../agents/agent-badge";
import { CommentActorAvatar } from "../comments/comment-actor-avatar";

/**
 * Who made a version, on one secondary line of its history row. The member
 * list is the sheet's single lookup, so a row costs no request of its own;
 * an old row with no `created_by` draws nothing.
 */
export function VersionAuthor({
  version,
  members,
  ready,
}: {
  version: Pick<DocumentVersion, "created_by" | "created_by_kind">;
  members: ReadonlyMap<string, Member>;
  /** A member list has loaded (a failed refetch keeps it); until then a name that is not in it is unknown, not "former". */
  ready: boolean;
}) {
  const { t } = useTranslation();
  if (!version.created_by) return null;

  const kind = version.created_by_kind;
  // With no list ever loaded (pending, or failed before the first success) a
  // former member cannot be told from a name not loaded yet, so the line waits
  // instead of guessing.
  if (kind !== "system" && !ready) return null;
  const member = members.get(version.created_by);
  const name =
    kind === "system"
      ? t("documents.versions.author_system")
      : (member?.display_name ??
        (kind === "agent" ? t("documents.home.editor_agent") : t("documents.comments.former_member")));
  // An agent the member list does not name is just "Agent"; the badge already
  // says that, so the label is not drawn a second time beside it.
  const showName = !(kind === "agent" && !member);
  const avatarUrl = typeof member?.avatar_url === "string" ? member.avatar_url : undefined;

  return (
    <div
      data-testid="version-author"
      className="flex min-h-5 min-w-0 items-center gap-1.5 text-caption text-muted-foreground"
    >
      <CommentActorAvatar name={name} avatarUrl={avatarUrl} kind={kind} size="xs" />
      {showName ? <span className="truncate">{name}</span> : null}
      {kind === "agent" ? <AgentBadge /> : null}
    </div>
  );
}
