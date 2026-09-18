"use client";

import { ArrowRight, Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useReadHomeNotification } from "@uniwork/core/home";
import { useArchive } from "@uniwork/core/notifications";
import { paths } from "@uniwork/core/paths";
import type { HomeSummary } from "@uniwork/core/types/home";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../common/panel-card";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { NotificationRow } from "../notifications/notification-row";
import { resourceHref } from "../notifications/resource-href";
import { HomePartialNotice } from "./home-partial-notice";

/**
 * The newest unread notifications of this workspace, in the same rows the
 * inbox uses. Opening one marks it read and follows it to its resource.
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

  return (
    <PanelCard
      id="home-inbox"
      title={t("home.section.inbox")}
      icon={Inbox}
      iconTone={moduleTone("inbox")}
      flush
      className="h-full"
      action={
        <AppLink href={ws.inbox()} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          {t("home.inbox.view_all")}
          <ArrowRight aria-hidden data-icon="inline-end" />
        </AppLink>
      }
    >
      {summary?.partial.includes("notifications") ? (
        <HomePartialNotice source="notifications" onRetry={onRetry} retrying={retrying} />
      ) : null}
      {loading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
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
        <ul aria-label={t("home.section.inbox")}>
          {items.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              href={resourceHref(n, workspace)}
              compact
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
