"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api/http";
import { useGraphNeighbors, useGraphUI } from "@uniwork/core/graph";
import type { GraphNeighbor } from "@uniwork/core/types/graph";
import { Button } from "@uniwork/ui/components/ui/button";
import { SidebarSection } from "../common/sidebar-section";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { graphNodeHref, graphNodeIcon, groupNeighbors } from "./graph-labels";

/**
 * "Liên quan": the node's one-step neighbors on the Work Graph (C-11 §7).
 * The graph trails its sources by seconds (ADR 0019), so the section says
 * when it read them instead of presenting itself as live.
 */
export function RelatedSection({ workspaceId, nodeType, nodeId }: { workspaceId: string; nodeType: string; nodeId: string }) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const ui = useGraphUI(workspace.organization_id);
  const query = useGraphNeighbors(workspaceId, nodeType, nodeId, { enabled: ui === "on" });
  const groups = useMemo(() => groupNeighbors(query.data?.items ?? []), [query.data?.items]);
  if (ui !== "on") return null;
  // 404 = not projected yet (or hidden, deliberately indistinguishable): nothing related to show.
  const missing = query.error instanceof ApiError && query.error.status === 404;

  return (
    <SidebarSection title={t("graph.related.title")}>
      <div data-testid="graph-related" className="space-y-3">
        {query.isPending ? (
          <p role="status" className="text-caption text-muted-foreground">{t("graph.related.loading")}</p>
        ) : query.isError && !missing ? (
          <div className="space-y-2">
            <p className="text-caption text-muted-foreground">{t("graph.related.error")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("graph.related.empty")}</p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="space-y-1">
              <h3 className="text-overline text-muted-foreground">
                {t(`graph.groups.${group.key}`, { defaultValue: t("graph.groups.other") })}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <RelatedRow
                    key={`${item.edge_type}:${item.direction}:${item.node.type}:${item.node.id}`}
                    item={item}
                    orgSlug={workspace.organization_slug}
                    wsSlug={workspace.slug}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
        {query.dataUpdatedAt ? (
          <p className="text-caption text-muted-foreground">
            {t("graph.related.updated", {
              time: new Date(query.dataUpdatedAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }),
            })}
          </p>
        ) : null}
      </div>
    </SidebarSection>
  );
}

function RelatedRow({ item, orgSlug, wsSlug }: { item: GraphNeighbor; orgSlug: string; wsSlug: string }) {
  const { t } = useTranslation();
  const Icon = graphNodeIcon(item.node);
  const href = graphNodeHref(item.node, orgSlug, wsSlug);
  const title = item.node.title || t("graph.related.untitled");
  return (
    <li className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-caption hover:bg-accent/50">
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      {href ? (
        <AppLink href={href} className="min-w-0 flex-1 truncate text-foreground">{title}</AppLink>
      ) : (
        <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
      )}
      {item.origin === "SYSTEM" ? <span className="shrink-0 text-muted-foreground">{t("graph.related.system")}</span> : null}
    </li>
  );
}
