"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { AuditEvent } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import {
  ActionIcon,
  ActorIcon,
  changeEntries,
  ChangeValue,
  EventTime,
  useAuditLabels,
} from "../../audit/event-presenter";
import { CopyableId } from "./copyable-id";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3">
      <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

export function AuditDetailSheet({
  event: selected,
  actorName: selectedActorName,
  canSeeIp,
  onClose,
}: {
  event: AuditEvent | null;
  actorName: string;
  /** The server sends IP addresses to the organization owner only. */
  canSeeIp: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const labels = useAuditLabels();
  // The caller clears the selection the moment the sheet starts closing; keep
  // drawing the last entry so the content does not collapse mid-animation.
  const [shown, setShown] = useState({ event: selected, actorName: selectedActorName });
  if (selected && (selected !== shown.event || selectedActorName !== shown.actorName)) {
    setShown({ event: selected, actorName: selectedActorName });
  }
  const { event, actorName } = shown;
  const changes = event ? changeEntries(event) : [];

  return (
    <Sheet open={selected !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {event ? (
              <span className="flex items-center gap-2">
                <ActionIcon action={event.action} />
                {labels.action(event.action)}
              </span>
            ) : (
              t("detail.title")
            )}
          </SheetTitle>
          <SheetDescription>
            {event ? (
              <>
                <code className="text-caption">{event.action}</code>
                {" · "}
                <EventTime iso={event.occurred_at} />
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        {event ? (
          <dl className="divide-y divide-border px-4 pb-8">
            <Field label={t("table.time")}>
              <time dateTime={event.occurred_at}>
                {new Date(event.occurred_at).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "medium" })}
              </time>
            </Field>
            <Field label={t("table.actor")}>
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  <ActorIcon kind={event.actor_kind} />
                  {labels.actorKind(event.actor_kind)}
                </Badge>
                <span>{actorName}</span>
                <CopyableId value={event.actor_id} label={t("table.actor")} />
              </span>
            </Field>
            <Field label={t("table.resource")}>
              <span className="flex flex-wrap items-center gap-2">
                <span>{labels.resource(event.resource_type)}</span>
                <CopyableId value={event.resource_id} label={t("table.resource")} />
              </span>
            </Field>
            {event.workspace_id ? (
              <Field label={t("detail.workspace")}>
                <CopyableId value={event.workspace_id} label={t("detail.workspace")} />
              </Field>
            ) : null}
            <Field label={t("table.changes")}>
              {changes.length === 0 ? (
                <span className="text-muted-foreground">{t("table.no_changes")}</span>
              ) : (
                <ul className="grid gap-2">
                  {changes.map(([field, change]) => (
                    <li key={field} className="grid gap-1 rounded-md bg-muted p-2">
                      <span className="text-caption font-medium" title={field}>{labels.field(field)}</span>
                      <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-caption">
                        <span className="min-w-0">
                          <span className="block text-caption font-medium text-muted-foreground">{t("detail.from")}</span>
                          <ChangeValue
                            value={labels.value(field, change.from, event.resource_type)}
                            className="text-muted-foreground"
                            full
                          />
                        </span>
                        <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block text-caption font-medium text-muted-foreground">{t("detail.to")}</span>
                          <ChangeValue value={labels.value(field, change.to, event.resource_type)} full />
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            {Object.keys(event.metadata ?? {}).length > 0 ? (
              <Field label={t("detail.metadata")}>
                <pre
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard to scroll it (axe scrollable-region-focusable)
                  tabIndex={0}
                  role="region"
                  aria-label={t("detail.metadata")}
                  className="overflow-x-auto rounded-md bg-muted p-2 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              </Field>
            ) : null}
            <Field label={t("detail.correlation")}>
              <CopyableId value={event.correlation_id} label={t("detail.correlation")} />
              <p className="mt-1 text-caption text-muted-foreground">{t("detail.correlation_hint")}</p>
            </Field>
            {/* The address is withheld from an admin by design, and saying so is
                better than a blank row that looks like missing data. For the
                owner a blank means the request carried none. */}
            <Field label={t("detail.ip")}>
              {event.ip_address ? (
                <code className="text-caption">{event.ip_address}</code>
              ) : (
                <span className="text-muted-foreground">
                  {canSeeIp ? t("detail.ip_not_recorded") : t("detail.ip_owner_only")}
                </span>
              )}
            </Field>
            {event.user_agent ? (
              <Field label={t("detail.user_agent")}>
                <span className="text-caption break-all">{event.user_agent}</span>
              </Field>
            ) : null}
          </dl>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
