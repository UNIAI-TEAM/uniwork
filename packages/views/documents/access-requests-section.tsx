"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import type { DocumentAccessRequest, DocumentAccessRequestLevel } from "@uniwork/core/documents/access-requests-adapter";
import {
  useApproveDocumentAccessRequest,
  useDeclineDocumentAccessRequest,
  useDocumentAccessRequests,
} from "@uniwork/core/documents/hooks-access-decisions";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { absoluteTime, relativeTime } from "../notifications/relative-time";

export interface AccessRequestsSectionProps {
  wsId: string;
  documentId: string;
  /** Opened from the inbox link (`?access=requests`): the heading takes focus. */
  focusOnOpen?: boolean;
}

// Low to high: an approval may keep the level that was asked or go above it,
// never below, and never to manage (that is the share list's job). "comment"
// is offered only to a request that asked for it: the share dialog has no
// comment level until DOC-05 lands, so it is never an upgrade target here.
const LEVEL_ORDER: readonly DocumentAccessRequestLevel[] = ["view", "comment", "edit"];

function askedLevel(value: string): DocumentAccessRequestLevel {
  return LEVEL_ORDER.find((level) => level === value) ?? "view";
}

type Notice =
  | { kind: "approved"; name: string; level: DocumentAccessRequestLevel }
  | { kind: "declined"; name: string }
  | { kind: "closed" };

/**
 * "Yêu cầu truy cập ({{count}})" in the share dialog (access addendum §3.4;
 * W-DOC07 B). The people who administer the document see who asked for what,
 * why and from where, and approve or decline. Both decisions are permission
 * changes, so each waits for the server: the row stays (button `aria-disabled`
 * with a spinner) until the answer is verified, and a 409 `access_request_closed`
 * (handled by someone else, expired, archived) says so and reloads the list.
 */
export function AccessRequestsSection({ wsId, documentId, focusOnOpen = false }: AccessRequestsSectionProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requests = useDocumentAccessRequests(wsId, documentId);
  const approve = useApproveDocumentAccessRequest(wsId, documentId);
  const decline = useDeclineDocumentAccessRequest(wsId, documentId);
  const [choices, setChoices] = useState<Record<string, DocumentAccessRequestLevel>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = approve.isPending || decline.isPending;
  const busyId = approve.isPending ? approve.variables?.requestId : decline.isPending ? decline.variables?.requestId : null;

  // The dialog hands focus to its first control after it mounts; take it back
  // for the section the link named, once on the next frame as well.
  useEffect(() => {
    if (!focusOnOpen) return;
    const focus = () => {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView?.({ block: "nearest" });
    };
    focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [focusOnOpen]);

  const rows = requests.data ?? [];
  const nameOf = (row: DocumentAccessRequest) => row.requester_name.trim() || t("documents.share.person_unknown");
  const levelLabel = (level: string) => t(`documents.share.level_${level}`, { defaultValue: level });

  const failed = (err: unknown) => {
    if (errorCode(err) === "access_request_closed") {
      setNotice({ kind: "closed" });
      return;
    }
    setError(apiErrorMessage(err) ?? t("documents.share.submit_failed"));
  };

  const decide = (row: DocumentAccessRequest, action: "approve" | "decline") => {
    if (busy) return;
    setNotice(null);
    setError(null);
    const name = nameOf(row);
    if (action === "approve") {
      const level = choices[row.id] ?? askedLevel(row.requested_level);
      approve.mutate({ requestId: row.id, level }, { onSuccess: () => setNotice({ kind: "approved", name, level }), onError: failed });
    } else {
      decline.mutate({ requestId: row.id }, { onSuccess: () => setNotice({ kind: "declined", name }), onError: failed });
    }
  };

  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2">
        <h3
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="text-label font-medium text-foreground outline-none focus-visible:underline"
        >
          {t("documents.access_request.section_title", { count: requests.isSuccess ? rows.length : "…" })}
        </h3>
      </div>
      <p
        role="status"
        className={notice ? "border-b border-border px-3 py-2 text-caption text-muted-foreground" : "sr-only"}
      >
        {notice?.kind === "approved"
          ? t("documents.access_request.approved", { name: notice.name, level: levelLabel(notice.level) })
          : notice?.kind === "declined"
            ? t("documents.access_request.declined", { name: notice.name })
            : notice?.kind === "closed"
              ? t("documents.access_request.closed")
              : ""}
      </p>
      {error ? (
        <p role="alert" className="border-b border-border px-3 py-2 text-caption text-destructive">
          {error}
        </p>
      ) : null}
      {requests.isPending ? (
        <div className="space-y-2 p-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : requests.isError ? (
        <div className="flex items-center justify-between gap-2 p-3">
          <p role="alert" className="text-caption text-destructive">
            {t("documents.share.error")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void requests.refetch()}>
            {t("documents.share.retry")}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="px-3 py-2 text-caption text-muted-foreground">{t("documents.access_request.none_pending")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const asked = askedLevel(row.requested_level);
            const choice = choices[row.id] ?? asked;
            const options = LEVEL_ORDER.filter(
              (level) => LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(asked) && (level !== "comment" || asked === "comment"),
            );
            const name = nameOf(row);
            const rowBusy = busyId === row.id;
            return (
              <li key={row.id} aria-labelledby={`${titleId}-${row.id}`} className="flex flex-col gap-2 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span id={`${titleId}-${row.id}`} className="min-w-0 truncate text-body font-medium text-foreground" title={name}>
                    {name}
                  </span>
                  <time
                    dateTime={row.created_at}
                    title={absoluteTime(row.created_at, i18n.language)}
                    className="shrink-0 text-caption text-muted-foreground"
                  >
                    {relativeTime(row.created_at, i18n.language)}
                  </time>
                </div>
                <p className="text-caption text-muted-foreground">
                  <span>{levelLabel(asked)}</span>
                  {" · "}
                  <span>
                    {row.source?.title
                      ? t("documents.access_request.row_source", { source: row.source.title })
                      : t("documents.access_request.row_source_unknown")}
                  </span>
                </p>
                {row.message ? <p className="text-body whitespace-pre-wrap break-words text-foreground">{row.message}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    items={options.map((value) => ({ value, label: levelLabel(value) }))}
                    value={choice}
                    onValueChange={(next) => setChoices((prev) => ({ ...prev, [row.id]: askedLevel(String(next)) }))}
                  >
                    <SelectTrigger
                      className="w-32"
                      aria-label={`${t("documents.share.level_label")} ${name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((value) => (
                        <SelectItem key={value} value={value}>
                          {levelLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    aria-disabled={busy || undefined}
                    aria-busy={(rowBusy && approve.isPending) || undefined}
                    onClick={() => decide(row, "approve")}
                  >
                    {rowBusy && approve.isPending ? <Spinner aria-hidden role="presentation" /> : null}
                    {t("documents.access_request.approve")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-disabled={busy || undefined}
                    aria-busy={(rowBusy && decline.isPending) || undefined}
                    onClick={() => decide(row, "decline")}
                  >
                    {rowBusy && decline.isPending ? <Spinner aria-hidden role="presentation" /> : null}
                    {t("documents.access_request.decline")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
