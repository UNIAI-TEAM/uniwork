"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrgMembers } from "@uniwork/core/organizations";
import {
  BulkTransferFailure,
  useBulkTransferMemberDocuments,
  type BulkTransferProgress,
  type useMemberDocumentOwnership,
} from "@uniwork/core/organizations/document-ownership";
import type { OrgMember } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { SettingsLoadError } from "./settings-layout";

/**
 * The "transfer documents" step of DOC-06 (spec §2.2), shared by the
 * deactivation dialog and the "Chuyển tài liệu" action on a deactivated row:
 * the count, the recipient picker with "Để sau", and the progress / result of
 * the bulk run. It never decides what the dialog around it does.
 */

/** The picker's explicit "later" choice; an empty value (nothing picked) means the same. */
const LATER = "later";

/** The user id to transfer to, or "" for "later" / nothing picked. */
export const recipientOf = (value: string) => (value === LATER ? "" : value);

/**
 * Active members other than the one whose documents move. The member list is
 * cursor-paginated and has no search, so every page is read while the step is
 * on screen and the picker offers everyone. The caller may pick themselves.
 */
function useRecipients(orgSlug: string, sourceUserId: string) {
  const { data, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useOrgMembers(
    orgSlug,
    "active",
  );
  const recipients = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.members).filter((m) => !m.deactivated_at && m.user_id !== sourceUserId),
    [data, sourceUserId],
  );
  const wantMore = hasNextPage && !isError;
  useEffect(() => {
    if (wantMore && !isFetchingNextPage) void fetchNextPage();
  }, [wantMore, isFetchingNextPage, fetchNextPage]);
  return { recipients, loading: isLoading || Boolean(wantMore), isError, retry: () => void refetch() };
}

type Ownership = ReturnType<typeof useMemberDocumentOwnership>;

/**
 * Count, then the picker. Counting is a spinner and a failed count a warning
 * with "Thử lại": neither blocks the dialog around it, because deactivating is
 * a security action that does not wait for a number (§2.2, F-04). With no
 * documents the step is empty, or says so when `showNone` (the row action,
 * where the admin asked to transfer and deserves an answer).
 */
export function DocumentCountStep({
  orgSlug,
  userId,
  name,
  ownership,
  value,
  onValueChange,
  disabled = false,
  showNone = false,
}: {
  orgSlug: string;
  userId: string;
  name: string;
  ownership: Ownership;
  value: string;
  /** `label` is the picked person's name, which the result lines repeat. */
  onValueChange: (value: string, label: string) => void;
  disabled?: boolean;
  showNone?: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "org.members.transfer_docs" });
  const total = ownership.data?.total ?? 0;
  const { recipients, loading, isError, retry } = useRecipients(orgSlug, userId);
  if (ownership.isError) {
    return (
      <div className="rounded-lg border border-border bg-muted/40">
        <SettingsLoadError onRetry={() => void ownership.refetch()}>{t("count_failed")}</SettingsLoadError>
      </div>
    );
  }
  if (!ownership.data) {
    return (
      <p role="status" className="flex items-center gap-2 text-body text-muted-foreground">
        <Spinner className="size-3.5 shrink-0" />
        {t("count_loading")}
      </p>
    );
  }
  if (total === 0) {
    return showNone ? (
      <p role="status" className="text-body text-muted-foreground">
        {t("none", { name })}
      </p>
    ) : null;
  }
  const pickerId = `transfer-docs-${userId}`;
  const items = [
    ...recipients.map((m: OrgMember) => ({ value: m.user_id, label: m.display_name || m.email })),
    { value: LATER, label: t("later") },
  ];
  return (
    <section aria-labelledby={`${pickerId}-title`} className="space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <h3 id={`${pickerId}-title`} className="text-body font-medium">
          {t("title")}
        </h3>
        <p className="text-body text-muted-foreground text-pretty">{t("body", { name, count: total })}</p>
        {ownership.data.workspaces.length > 0 ? (
          <ul className="text-caption text-muted-foreground">
            {ownership.data.workspaces.map((w) => (
              <li key={w.workspace_id}>
                {w.workspace_name || w.workspace_id}: {w.count}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Field>
        <FieldLabel htmlFor={pickerId}>{t("recipient_label")}</FieldLabel>
        <Select
          id={pickerId}
          aria-label={t("recipient_label")}
          value={value}
          disabled={disabled}
          placeholder={t("recipient_placeholder")}
          onValueChange={(v) => {
            const picked = (v as string) ?? "";
            onValueChange(picked, items.find((item) => item.value === picked)?.label ?? "");
          }}
          items={items}
        />
        {isError ? (
          <SettingsLoadError onRetry={retry}>{t("recipients_error")}</SettingsLoadError>
        ) : loading ? (
          <FieldDescription role="status" className="flex items-center gap-2">
            <Spinner className="size-3.5 shrink-0" />
            {t("recipients_loading")}
          </FieldDescription>
        ) : null}
      </Field>
    </section>
  );
}

type TransferRun =
  | { status: "idle" }
  | { status: "running"; progress: BulkTransferProgress }
  | { status: "done"; progress: BulkTransferProgress }
  | { status: "failed"; progress: BulkTransferProgress };

const IDLE: TransferRun = { status: "idle" };
const ZERO: BulkTransferProgress = {
  bulkId: "",
  cursor: "",
  transferred: 0,
  skipped: { recipient_not_member: 0, self_restricted: 0 },
};

/**
 * Drives one bulk run and keeps what the screen shows: batches so far while
 * it runs, the totals when done, and where it stopped when a batch failed so
 * `retry` resumes from the last committed cursor instead of starting over.
 */
export function useTransferRun(orgSlug: string) {
  const bulk = useBulkTransferMemberDocuments(orgSlug);
  const [run, setRun] = useState<TransferRun>(IDLE);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const last = useRef<{ userId: string; toUserId: string } | null>(null);
  const go = useCallback(
    async (userId: string, toUserId: string, resume?: BulkTransferProgress) => {
      last.current = { userId, toUserId };
      const set = (next: TransferRun) => {
        if (mounted.current) setRun(next);
      };
      set({ status: "running", progress: resume ?? ZERO });
      try {
        const progress = await bulk.mutateAsync({
          userId,
          toUserId,
          resume,
          onProgress: (p) => set({ status: "running", progress: p }),
        });
        set({ status: "done", progress });
      } catch (err) {
        set({ status: "failed", progress: err instanceof BulkTransferFailure ? err.progress : (resume ?? ZERO) });
      }
    },
    [bulk],
  );
  const start = useCallback((userId: string, toUserId: string) => go(userId, toUserId), [go]);
  const retry = useCallback(() => {
    if (run.status !== "failed" || !last.current) return Promise.resolve();
    return go(last.current.userId, last.current.toUserId, run.progress);
  }, [go, run]);
  return { run, start, retry };
}

/**
 * Progress while it runs and the outcome after, in words (skips are text with
 * their reason, never colour alone) inside one polite live region. A failure
 * keeps what already moved and offers "Thử lại".
 */
export function TransferRunStatus({
  run,
  recipientName,
  deactivated,
  onRetry,
}: {
  run: TransferRun;
  recipientName: string;
  /** The account is already locked, which the failure line says so the admin knows nothing is half-done on that side. */
  deactivated: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "org.members.transfer_docs" });
  if (run.status === "idle") return null;
  const { progress } = run;
  const lines = [
    progress.transferred > 0 || run.status === "done"
      ? t("done", { count: progress.transferred, name: recipientName })
      : null,
    progress.skipped.recipient_not_member > 0
      ? t("skipped_not_member", { count: progress.skipped.recipient_not_member, name: recipientName })
      : null,
    progress.skipped.self_restricted > 0
      ? t("skipped_self", { count: progress.skipped.self_restricted, name: recipientName })
      : null,
  ].filter((line): line is string => line !== null);
  return (
    <div role="status" aria-live="polite" className="space-y-2 text-body">
      {run.status === "running" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-3.5 shrink-0" />
          {t("progress")}
        </p>
      ) : null}
      {run.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 text-pretty text-foreground">
            {t(deactivated ? "failed" : "failed_active")}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden className="size-3.5" />
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {lines.length > 0 ? (
        <ul className="space-y-1 text-pretty">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
