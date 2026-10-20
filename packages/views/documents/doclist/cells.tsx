"use client";

import { Lock, Share2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentShareScope } from "@uniwork/core/types/document";
import { cn } from "@uniwork/ui/lib/utils";
import { CommentActorAvatar } from "../../comments/comment-actor-avatar";
import { DocumentTypeIcon, documentIconFormat } from "../document-type-icon";
import { docAccessKind, docAccessLevel } from "./access";
import { EMPTY_CELL } from "./format";

// The cells every list screen shares. They return the cell's content, not the
// `<td>`: the row owns the cell element (its container-query classes, its
// padding and its click target).

/** Type icon by extension (or kind), the title, and the location line under it. */
export function DocNameCell({
  kind,
  title,
  format,
  location,
}: {
  kind: string;
  title: string;
  /** The format the row already resolved (`rowFormat`); absent, the title's extension decides. */
  format?: string | null;
  /** The folder the document sits in, or where a file came from; absent draws no line. */
  location?: string | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <DocumentTypeIcon format={kind === "folder" ? "folder" : (format ?? documentIconFormat(kind, title))} className="size-6 shrink-0" />
      <span className="min-w-0 flex-1">
        {/* The truncated name still reads in full on hover. */}
        <span title={title} className="block truncate text-body text-foreground">
          {title}
        </span>
        {location ? (
          <span data-testid="doclist-location" className="block truncate text-caption text-muted-foreground">
            {location}
          </span>
        ) : null}
      </span>
    </span>
  );
}

const ACCESS_ICON = { restricted: Lock, workspace: Users, shared: Share2 } as const;

/** The scope pill (Riêng tư / Workspace / Được chia sẻ) and, under it, "Chủ sở hữu" or "Bạn: Xem|Bình luận|Sửa|Quản lý". */
export function DocAccessCell({
  visibility,
  shareScope,
  myLevel,
  adminScope,
  isOwner,
}: {
  visibility: string | null | undefined;
  shareScope: DocumentShareScope | null | undefined;
  myLevel: string | null | undefined;
  adminScope?: boolean | null;
  /** From the server (SV-5); absent reads as false, so the level line shows. */
  isOwner?: boolean | null;
}) {
  const { t } = useTranslation();
  const kind = docAccessKind(visibility, shareScope);
  const Icon = ACCESS_ICON[kind];
  const level = docAccessLevel(myLevel, adminScope);
  const sub = isOwner === true ? t("documents.list.access.owner") : level ? t("documents.list.access.you", { level: t(`documents.list.access.level.${level}`) }) : null;
  return (
    <span className="flex min-w-0 flex-col gap-0.5 text-caption">
      <span data-access-kind={kind} className="inline-flex min-w-0 items-center gap-1 text-foreground">
        <Icon aria-hidden className={cn("size-3.5 shrink-0", kind === "restricted" ? "text-warning" : "text-muted-foreground")} />
        <span className="truncate">{t(`documents.list.access.${kind}`)}</span>
      </span>
      {sub ? <span className="truncate text-muted-foreground">{sub}</span> : null}
    </span>
  );
}

/** Avatar 24 and the display name; the viewer's own name is written like anyone's. No name reads as "—". */
export function DocPersonCell({
  name,
  avatarUrl,
  kind,
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  /** `agent` / `system` draw the matching avatar. */
  kind?: string;
}) {
  const label = name?.trim();
  if (!label) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
      <CommentActorAvatar name={label} avatarUrl={avatarUrl ?? undefined} kind={kind} size="md" />
      <span className="truncate">{label}</span>
    </span>
  );
}
