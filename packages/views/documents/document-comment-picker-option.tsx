"use client";

import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MentionCandidate } from "@uniwork/core/types/document-access";
import { cn } from "@uniwork/ui/lib/utils";
import { CommentActorAvatar } from "../comments/comment-actor-avatar";
import { K } from "./document-comments-keys";
import type { PickerRow } from "./use-mention-picker";

// One row of the S14 mention listbox, and the chips the composer shows for
// picked people who cannot view the document (G8-18: lock icon + text, never
// colour alone).

/** The lock icon + `collabMentionNoAccessBadge` pill shared by the picker row and the chip. */
function NoAccessBadge({ className, testId }: { className?: string; testId?: string }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid={testId}
      className={cn("inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-micro font-medium text-muted-foreground", className)}
    >
      <Lock aria-hidden className="size-3" />
      {t(K.collabMentionNoAccessBadge)}
    </span>
  );
}

export function PickerOption({
  row,
  active,
  query,
  onPick,
}: {
  row: PickerRow;
  active: boolean;
  query: string;
  onPick: (row: PickerRow) => void;
}) {
  const { t } = useTranslation();
  const base = "flex min-h-6 items-center gap-2 rounded px-2 py-1 text-caption pointer-coarse:min-h-11";
  if (row.type === "message") {
    const key = {
      searching: K.collabMentionSearching,
      noMatch: K.collabMentionNoMatch,
      noCandidates: K.collabMentionNoCandidates,
      noMatchMembers: K.collabMentionNoMatchMembers,
      noCandidatesMembers: K.collabMentionNoCandidatesMembers,
      error: K.collabMentionError,
    }[row.key];
    return (
      <li id={row.id} role="option" aria-disabled="true" aria-selected={false} className={cn(base, "text-muted-foreground")}>
        {t(key, { query })}
      </li>
    );
  }
  const label = row.type === "retry" ? t(K.collabRetry) : row.candidate.display_name || row.candidate.user_id;
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <li
      id={row.id}
      role="option"
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(row)}
      className={cn(base, "cursor-pointer", active ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
    >
      {row.type === "person" ? (
        <>
          <CommentActorAvatar name={label} avatarUrl={row.candidate.avatar_url} kind="human" />
          <span className="min-w-0 truncate font-medium">{label}</span>
          {row.candidate.can_view === false ? (
            <NoAccessBadge testId={`mention-candidate-no-access-${row.candidate.user_id}`} />
          ) : null}
          {row.candidate.email ? <span className="min-w-0 truncate text-muted-foreground">{row.candidate.email}</span> : null}
        </>
      ) : (
        label
      )}
    </li>
  );
}

/** The inserted chips of picked people who cannot view the document yet. */
export function NoAccessChips({ people, testId }: { people: readonly MentionCandidate[]; testId: string }) {
  if (people.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={testId}>
      {people.map((person) => (
        <span
          key={person.user_id}
          data-testid={`composer-mention-chip-${person.user_id}`}
          data-mention-id={person.user_id}
          data-mention-state="no_access"
          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-caption font-medium text-muted-foreground"
        >
          <span>{`@${person.display_name || person.user_id}`}</span>
          <NoAccessBadge className="bg-background/80 px-1" />
        </span>
      ))}
    </div>
  );
}
