"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, File, Image, Link, Users, Video, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOptionalNavigation } from "../navigation";
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
      <span className="w-5 text-center text-caption font-semibold text-muted-foreground">
        {t("chat.person_shared_gif_mark")}
      </span>
    );
  }
  if (kind === "group") return <Users className="size-4 text-muted-foreground" aria-hidden />;
  const Icon = ROW_ICON[kind];
  return <Icon className="size-4 text-muted-foreground" aria-hidden />;
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
    <ul className="border-t border-border">
      {kinds.map((kind) => (
        <li key={kind}>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-body text-foreground hover:bg-surface-hover"
            onClick={() => onPick(kind)}
          >
            <SharedMark kind={kind} />
            {t(rowLabelKey(kind), { count: counts[kind] })}
          </button>
        </li>
      ))}
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
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <button
          type="button"
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-foreground hover:bg-surface-hover"
          onClick={onBack}
          aria-label={t("chat.person_shared_back")}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <DialogTitle className="min-w-0 flex-1 truncate text-body font-semibold">{title}</DialogTitle>
      </div>
      <DialogDescription className="sr-only">{title}</DialogDescription>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {kind === "group" ? (
          groups.length === 0 ? (
            <p className="px-4 py-6 text-center text-caption text-muted-foreground">{t("chat.person_shared_empty")}</p>
          ) : (
            <ul>
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center px-4 py-2.5 text-left text-body hover:bg-surface-hover"
                    onClick={() => onOpenGroup(group.roomId)}
                  >
                    {group.name}
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
          <ul>
            {items.map((item) => (
              <li key={item.id} className="border-b border-border px-4 py-2.5">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-body text-foreground underline-offset-2 hover:underline"
                  >
                    {item.title}
                  </a>
                ) : (
                  <p className="truncate text-body text-foreground">{item.title}</p>
                )}
              </li>
            ))}
          </ul>
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
        <p className="border-t border-border px-4 py-3 text-caption text-muted-foreground" role="status">
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
        <p className="px-4 pb-3 text-caption text-muted-foreground">{t("chat.person_shared_unavailable")}</p>
      ) : null}
    </div>
  );
}
