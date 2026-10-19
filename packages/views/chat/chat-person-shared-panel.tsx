"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, File, Image, Link, Users, Video, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOptionalNavigation } from "../navigation";
import { tintClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import type { PersonSharedBuckets, PersonSharedGroup, PersonSharedItem, PersonSharedKind } from "./chat-person-shared";
import { SharedPhotoGallery } from "./shared-photo-gallery";
import { usePersonShared } from "./use-person-shared";

const ROW_ICON: Record<Exclude<PersonSharedKind, "gif" | "group">, LucideIcon> = {
  photo: Image,
  video: Video,
  file: File,
  link: Link,
};

function rowLabelKey(kind: PersonSharedKind): string {
  if (kind === "photo") return "chat.person_shared_photos";
  if (kind === "video") return "chat.person_shared_videos";
  if (kind === "file") return "chat.person_shared_files";
  if (kind === "link") return "chat.person_shared_links";
  if (kind === "gif") return "chat.person_shared_gifs";
  return "chat.person_shared_groups";
}

function SharedMark({ kind }: { kind: PersonSharedKind }) {
  const { t } = useTranslation();
  if (kind === "gif") {
    return (
      <span className="w-5 text-center text-micro font-bold text-muted-foreground">
        {t("chat.person_shared_gif_mark")}
      </span>
    );
  }
  const Icon = kind === "group" ? Users : ROW_ICON[kind];
  return <Icon className="size-4.5 shrink-0 text-muted-foreground" aria-hidden />;
}

/** One "N photos / N files…" row: mark, count, chevron to the list it opens. */
export function SharedKindRow({
  kind,
  label,
  onClick,
}: {
  kind: PersonSharedKind;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-11 w-full cursor-pointer items-center gap-3.5 py-2 pr-4 pl-5 text-left text-body-lg text-foreground tabular-nums transition-colors duration-(--duration-fast) hover:bg-surface-hover"
      onClick={onClick}
    >
      <span className="flex w-5 shrink-0 justify-center">
        <SharedMark kind={kind} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-faint-foreground" aria-hidden />
    </button>
  );
}

function SharedRows({
  counts,
  onPick,
}: {
  counts: Record<PersonSharedKind, number>;
  onPick: (kind: PersonSharedKind) => void;
}) {
  const { t } = useTranslation();
  const kinds: PersonSharedKind[] = ["photo", "video", "file", "link", "gif", "group"];
  return (
    <ul className="border-t border-border py-1">
      {kinds.map((kind) => (
        <li key={kind}>
          <SharedKindRow kind={kind} label={t(rowLabelKey(kind), { count: counts[kind] })} onClick={() => onPick(kind)} />
        </li>
      ))}
    </ul>
  );
}

const FILE_TINT: Record<string, Tint> = {
  PDF: "red",
  DOC: "blue",
  DOCX: "blue",
  XLS: "green",
  XLSX: "green",
  CSV: "green",
  PPT: "orange",
  PPTX: "orange",
};

/** "report.final.PDF" → "PDF"; nothing when the name carries no short extension. */
function sharedFileExtension(title: string): string {
  return /\.([a-z0-9]{1,4})$/i.exec(title.trim())?.[1]?.toUpperCase() ?? "";
}

/** The 40px tile in front of a shared file, link or video: tinted by type, a file says its extension. */
function SharedItemTile({ kind, title }: { kind: PersonSharedKind; title: string }) {
  const ext = kind === "file" ? sharedFileExtension(title) : "";
  const tint: Tint = kind === "link" ? "blue" : kind === "video" ? "violet" : (FILE_TINT[ext] ?? "gray");
  const Icon = kind === "link" ? Link : kind === "video" ? Video : File;
  return (
    <span
      aria-hidden
      className={cn("flex size-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg", tintClass[tint])}
    >
      <Icon className="size-4" />
      {ext ? <span className="text-micro leading-none font-bold">{ext}</span> : null}
    </span>
  );
}

/** Shared files, links or videos as rows: tile and name, the row opens it when it has an address. */
export function SharedItemList({ kind, items }: { kind: PersonSharedKind; items: readonly PersonSharedItem[] }) {
  return (
    <ul className="py-1">
      {items.map((item) => {
        const body = (
          <>
            <SharedItemTile kind={kind} title={item.title} />
            <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">{item.title}</span>
          </>
        );
        return (
          <li key={item.id} className="flex min-h-16 items-center px-4 py-1">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg underline-offset-2 hover:underline"
              >
                {body}
              </a>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SharedList({
  kind,
  items,
  groups,
  workspaceId,
  roomId,
  onBack,
  onOpenGroup,
}: {
  kind: PersonSharedKind;
  items: PersonSharedItem[];
  groups: PersonSharedGroup[];
  workspaceId: string;
  roomId: string;
  onBack: () => void;
  onOpenGroup: (roomId: string) => void;
}) {
  const { t } = useTranslation();
  const title = t(rowLabelKey(kind), { count: kind === "group" ? groups.length : items.length });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-15 shrink-0 items-center gap-1 border-b border-border pr-12 pl-1.5">
        <button
          type="button"
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground hover:bg-surface-hover"
          onClick={onBack}
          aria-label={t("chat.person_shared_back")}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <DialogTitle className="min-w-0 flex-1 truncate font-display text-title-sm font-bold">{title}</DialogTitle>
      </div>
      <DialogDescription className="sr-only">{title}</DialogDescription>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {kind === "group" ? (
          groups.length === 0 ? (
            <p className="px-4 py-6 text-center text-caption text-muted-foreground">{t("chat.person_shared_empty")}</p>
          ) : (
            <ul className="py-1">
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full cursor-pointer items-center gap-3 py-2 pr-4 pl-5 text-left text-body-lg text-foreground hover:bg-surface-hover"
                    onClick={() => onOpenGroup(group.roomId)}
                  >
                    <Users className="size-4.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <ChevronRight className="size-4 shrink-0 text-faint-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-caption text-muted-foreground">{t("chat.person_shared_empty")}</p>
        ) : kind === "photo" || kind === "gif" ? (
          <SharedPhotoGallery items={items} workspaceId={workspaceId} roomId={roomId} />
        ) : (
          <SharedItemList kind={kind} items={items} />
        )}
      </div>
    </div>
  );
}

/** The shared-media rows on a person card, and the list a row opens. */
export function PersonSharedSection({
  userId,
  roomId,
  onClose,
  profile,
}: {
  userId: string;
  roomId: string | null;
  onClose: () => void;
  profile: ReactNode;
}) {
  const { t } = useTranslation();
  const nav = useOptionalNavigation();
  const workspace = useOptionalWorkspace();
  const shared = usePersonShared(userId, roomId, true);
  const [kind, setKind] = useState<PersonSharedKind | null>(null);
  const buckets: PersonSharedBuckets = shared;
  const items = kind && kind !== "group" ? buckets[kind] : [];

  const openGroup = (roomId: string) => {
    if (nav) {
      const params = new URLSearchParams(nav.searchParams);
      params.delete("dm");
      params.set("room", roomId);
      const qs = params.toString();
      nav.push(qs ? `${nav.pathname}?${qs}` : nav.pathname);
    }
    onClose();
  };

  if (kind) {
    return (
      <SharedList
        kind={kind}
        items={items}
        groups={shared.groups}
        workspaceId={workspace?.workspace.id ?? ""}
        roomId={roomId ?? ""}
        onBack={() => setKind(null)}
        onOpenGroup={openGroup}
      />
    );
  }

  if (shared.loading) {
    return (
      <>
        {profile}
        <p className="border-t border-border px-5 py-3 text-caption text-muted-foreground" role="status">
          {t("chat.person_shared_loading")}
        </p>
      </>
    );
  }

  return (
    <div className={cn(shared.failed && "pb-2")}>
      {profile}
      <SharedRows
        counts={{
          photo: shared.photo.length,
          video: shared.video.length,
          file: shared.file.length,
          link: shared.link.length,
          gif: shared.gif.length,
          group: shared.groups.length,
        }}
        onPick={setKind}
      />
      {shared.failed ? (
        <p className="px-5 pb-3 text-caption text-muted-foreground">{t("chat.person_shared_unavailable")}</p>
      ) : null}
    </div>
  );
}
