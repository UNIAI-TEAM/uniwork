"use client";

import { ArrowRight, Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useReadHomeNotification } from "@uniwork/core/home";
import { useArchive } from "@uniwork/core/notifications";
import { paths } from "@uniwork/core/paths";
import type { HomeSummary } from "@uniwork/core/types/home";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../common/panel-card";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { NotificationRow } from "../notifications/notification-row";
import { resourceHref } from "../notifications/resource-href";
import { HomePartialNotice } from "./home-partial-notice";
import { HomeInboxRowsSkeleton } from "./home-skeletons";

/**
 * The newest unread notifications of this workspace, in the same rows the
 * inbox uses, without the unread bar that every row here would carry. Opening one marks it read and follows it to its resource.
 */
export function HomeInbox({
  summary,
  loading,
  retrying,
  onRetry,
}: {
  summary: HomeSummary | undefined;
  loading: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const read = useReadHomeNotification(workspace.id);
  const archive = useArchive();
  const items = summary?.inbox ?? [];
  const failed = summary?.partial.includes("notifications") ?? false;

  return (
    <PanelCard
      id="home-inbox"
      title={t("home.section.inbox")}
      icon={Inbox}
      iconTone={moduleTone("inbox")}
      flush
      className="shadow-none"
      action={
        <AppLink href={ws.inbox()} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          {t("home.inbox.view_all")}
          <ArrowRight aria-hidden data-icon="inline-end" />
        </AppLink>
      }
    >
      {failed ? <HomePartialNotice source="notifications" onRetry={onRetry} retrying={retrying} /> : null}
      {loading ? (
        <HomeInboxRowsSkeleton />
      ) : failed && items.length === 0 ? null : items.length === 0 ? (
        <CollectionPageState
          className="py-6"
          icon={Inbox}
          tone={moduleTone("inbox")}
          title={t("home.inbox.empty_title")}
          description={t("home.inbox.empty_description")}
          actions={
            <AppLink href={ws.inbox()} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("home.inbox.empty_action")}
            </AppLink>
          }
        />
      ) : (
        <ul aria-label={t("home.section.inbox")} className="p-1.5 [--row-fill:var(--surface)]">
          {items.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              href={resourceHref(n, workspace)}
              compact
              // Every row here is unread, so the unread bar would mark them all.
              unreadBar={false}
              onOpen={(row) => {
                if (!row.read_at) read(row.id);
              }}
              onToggleRead={(row) => read(row.id)}
              onArchive={(row) => archive.mutate([row.id])}
            />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}
