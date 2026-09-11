"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Copy } from "lucide-react";
import type { AuditEvent } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { copyText } from "@uniwork/ui/lib/clipboard";
import {
  ActionIcon,
  ActorIcon,
  changeEntries,
  ChangeValue,
  EventTime,
  useAuditLabels,
} from "../../audit/event-presenter";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3">
      <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

/** A monospace id with a copy button; a reader pastes it into the system log search. */
function CopyableId({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit.detail" });
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code className="text-caption break-all">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? t("copied") : `${t("copy")} ${label}`}
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </span>
  );
}

export function AuditDetailSheet({
  event,
  actorName,
  onClose,
}: {
  event: AuditEvent | null;
  actorName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const labels = useAuditLabels();
  const changes = event ? changeEntries(event) : [];

  return (
    <Sheet open={event !== null} onOpenChange={(open) => !open && onClose()}>
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
              <time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time>
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
                      <span className="text-caption font-medium">{field}</span>
                      <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-caption">
                        <span className="min-w-0">
                          <span className="block text-micro text-muted-foreground uppercase">{t("detail.from")}</span>
                          <ChangeValue value={change.from} className="text-muted-foreground" full />
                        </span>
                        <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block text-micro text-muted-foreground uppercase">{t("detail.to")}</span>
                          <ChangeValue value={change.to} full />
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            {Object.keys(event.metadata ?? {}).length > 0 ? (
              <Field label={t("detail.metadata")}>
                <pre className="overflow-x-auto rounded-md bg-muted p-2 text-caption">
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              </Field>
            ) : null}
            <Field label={t("detail.correlation")}>
              <CopyableId value={event.correlation_id} label={t("detail.correlation")} />
              <p className="mt-1 text-caption text-muted-foreground">{t("detail.correlation_hint")}</p>
            </Field>
            {/* The address is absent for an admin by design, and saying so is
                better than a blank row that looks like missing data. */}
            <Field label={t("detail.ip")}>
              {event.ip_address ? (
                <code className="text-caption">{event.ip_address}</code>
              ) : (
                <span className="text-muted-foreground">{t("detail.ip_owner_only")}</span>
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
