"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  RefreshCw,
  Send,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  emailHubHasReadableBody,
  prefetchEmailHubThread,
  useEmailHubAccounts,
  useEmailHubThread,
  useEmailHubThreads,
  useDownloadEmailHubAttachment,
  useEmailHubLiveSync,
  useMoveEmailHubThread,
  useSyncEmailHub,
  useToggleEmailHubStar,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { ComposeEmailDialog } from "./compose-email-dialog";
import { ConnectAccountDialog } from "./connect-account-dialog";
import { EmailHubStatsRail } from "./email-hub-stats-rail";
import { EmailHubThreadDetail } from "./email-hub-thread-detail";
import { EmptyPanel, formatWhen } from "./email-hub-view-parts";

type FolderKey = "INBOX" | "STARRED" | "SENT" | "DRAFTS" | "ARCHIVE" | "TRASH";

const FOLDERS: { key: FolderKey; icon: typeof Inbox; labelKey: string }[] = [
  { key: "INBOX", icon: Inbox, labelKey: "email_hub.folders.inbox" },
  { key: "STARRED", icon: Star, labelKey: "email_hub.folders.important" },
  { key: "SENT", icon: Send, labelKey: "email_hub.folders.sent" },
  { key: "DRAFTS", icon: Mail, labelKey: "email_hub.folders.drafts" },
  { key: "ARCHIVE", icon: Archive, labelKey: "email_hub.folders.archive" },
  { key: "TRASH", icon: Trash2, labelKey: "email_hub.folders.trash" },
];

export function EmailHubView() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const wsId = workspace.id;
  const qc = useQueryClient();
  const accounts = useEmailHubAccounts(wsId);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderKey>("INBOX");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [hasAttachmentsOnly, setHasAttachmentsOnly] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<EmailHubThread | null>(null);
  const sync = useSyncEmailHub(wsId);
  const moveThread = useMoveEmailHubThread(wsId);
  const toggleStar = useToggleEmailHubStar(wsId);
  const downloadAttachment = useDownloadEmailHubAttachment(wsId);
  const readingEmail = !!selectedId;
  useEmailHubLiveSync(wsId, accountId, folder === "INBOX" || folder === "STARRED", readingEmail);

  const filters = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      unreadOnly,
      hasAttachmentsOnly,
    }),
    [debouncedSearch, unreadOnly, hasAttachmentsOnly],
  );
  const threads = useEmailHubThreads(wsId, accountId, folder, filters);
  const rows = useMemo(
    () => threads.data?.pages.flatMap((page) => page.threads) ?? [],
    [threads.data],
  );
  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const detail = useEmailHubThread(wsId, accountId, selectedId, selectedRow);

  const accountList = useMemo(() => {
    const list = accounts.data?.accounts ?? [];
    const byEmail = new Map<string, (typeof list)[number]>();
    for (const acc of list) {
      byEmail.set(acc.email_address, acc);
    }
    return [...byEmail.values()];
  }, [accounts.data]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 500);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    const latest = accountList.at(-1)?.id;
    if (latest && !accountId) setAccountId(latest);
  }, [accountList, accountId]);

  const prefetchThread = useCallback(
    (threadId: string) => {
      if (!accountId || threadId === selectedId) return;
      prefetchEmailHubThread(qc, wsId, accountId, threadId, true);
    },
    [accountId, qc, wsId, selectedId],
  );

  const handleToggleStar = useCallback(
    (threadId: string, isStarred: boolean) => {
      if (!accountId) return;
      toggleStar.mutate({ accountId, threadId, isStarred: !isStarred });
    },
    [accountId, toggleStar],
  );

  useEffect(() => {
    if (!accountId || rows.length === 0) return;
    const candidates = rows.slice(0, 5);
    for (const row of candidates) {
      if (row.id === selectedId) continue;
      prefetchEmailHubThread(qc, wsId, accountId, row.id, true);
    }
  }, [accountId, rows, qc, wsId, selectedId]);

  const counts = threads.data?.pages[0]?.counts ?? { total: 0, unread: 0 };
  const searching = !!debouncedSearch && threads.isFetching && !threads.isFetchingNextPage;
  const activeThread =
    detail.data?.id === selectedId ? detail.data : selectedRow?.id === selectedId ? selectedRow : null;
  const readableBody = emailHubHasReadableBody(detail.data);
  const bodyLoading = detail.isBodyLoading;
  const bodyLoadFailed = detail.isBodyLoadFailed;
  const activeAccount = accountList.find((acc) => acc.id === accountId);
  const tone = moduleTone("email");

  return (
    <div className="flex h-[calc(100dvh-var(--header-height,3.5rem))] min-h-0 flex-col gap-0 lg:flex-row">
      {/* Folder rail */}
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col border-b border-border bg-sidebar lg:w-56 lg:border-b-0 lg:border-r",
          readingEmail && "hidden 2xl:flex",
        )}
      >
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <IconTile icon={Mail} tone={tone} size="sm" />
            <span className="text-title font-medium">{t("email_hub.title")}</span>
          </div>
          <p className="mt-1 pl-9 text-caption text-muted-foreground">{t("email_hub.subtitle")}</p>
        </div>
        <div className="space-y-2 p-3">
          <Button
            className="w-full justify-start gap-2"
            disabled={!accountId}
            onClick={() => {
              setReplyTo(null);
              setComposeOpen(true);
            }}
          >
            <Mail className="size-4" />
            {t("email_hub.compose_label")}
          </Button>
          <Button variant="outline" className="w-full justify-start gap-2" disabled>
            <Tag className="size-4" />
            {t("email_hub.labels_rules")}
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
          {FOLDERS.map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              type="button"
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-body text-muted-foreground hover:bg-sidebar-accent/70",
                folder === key && "bg-surface-selected text-brand",
              )}
              onClick={() => {
                setFolder(key);
                setSelectedId(null);
              }}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 truncate text-left">{t(labelKey)}</span>
              {key === "INBOX" ? (
                <span className="text-caption tabular-nums">{counts.unread}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="border-t border-border px-3 py-2">
          <p className="mb-1 px-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t("email_hub.labels_section")}
          </p>
          <p className="px-1 text-caption text-muted-foreground">{t("email_hub.no_labels")}</p>
        </div>
        <div className="mt-auto border-t border-border p-3">
          <p className="mb-2 px-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t("email_hub.accounts")}
          </p>
          {accountList.length ? (
            <ul className="space-y-1">
              {accountList.map((acc) => (
                <li key={acc.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full truncate rounded-md px-2 py-1.5 text-left text-caption hover:bg-sidebar-accent/70",
                      accountId === acc.id && "bg-surface-selected text-brand",
                    )}
                    onClick={() => {
                      setAccountId(acc.id);
                      setSelectedId(null);
                    }}
                  >
                    {acc.email_address}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-caption text-muted-foreground">{t("email_hub.no_accounts")}</p>
          )}
        </div>
      </aside>

      {/* Thread list — hidden while reading so detail can use the width */}
      <section
        className={cn(
          "flex w-full min-w-0 flex-col border-b border-border lg:w-64 lg:max-w-[30%] lg:border-b-0 lg:border-r xl:w-72",
          readingEmail && "hidden",
        )}
      >
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("email_hub.search_placeholder")}
            className="h-9"
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            disabled={!accountId || sync.isPending}
            aria-label={t("email_hub.refresh")}
            onClick={() =>
              accountId &&
              sync.mutate({ accountId, folder: folder === "STARRED" ? undefined : folder, force: true })
            }
          >
            <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} />
          </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={unreadOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setUnreadOnly((v) => !v)}
            >
              {t("email_hub.filters.unread")}
            </Button>
            <Button
              variant={hasAttachmentsOnly ? "default" : "outline"}
              size="sm"
              className="gap-1"
              onClick={() => setHasAttachmentsOnly((v) => !v)}
            >
              <Paperclip className="size-3.5" />
              {t("email_hub.filters.attachments")}
            </Button>
          </div>
          {accountId && !threads.isLoading ? (
            <p className="text-caption text-muted-foreground">
              {t("email_hub.list_count", { count: counts.total, unread: counts.unread })}
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!accountId ? (
            <EmptyPanel message={t("email_hub.connect_prompt")} />
          ) : (threads.isLoading || searching) && rows.length === 0 ? (
            <div className="space-y-2 p-3">
              {searching ? (
                <p className="px-1 py-2 text-body text-muted-foreground">{t("email_hub.search_loading")}</p>
              ) : null}
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyPanel
              message={debouncedSearch ? t("email_hub.search_empty") : t("email_hub.empty_list")}
            />
          ) : (
            <ul>
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    "flex border-b border-border",
                    selectedId === row.id && "bg-surface-selected",
                  )}
                >
                  <button
                    type="button"
                    className="inline-flex size-11 shrink-0 items-center justify-center self-start hover:bg-muted/60"
                    aria-label={row.is_starred ? t("email_hub.unstar") : t("email_hub.star")}
                    onClick={() => handleToggleStar(row.id, row.is_starred)}
                  >
                    <Star
                      className={cn(
                        "size-4",
                        row.is_starred ? "fill-brand text-brand" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                  </button>
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 py-3 pr-3 text-left hover:bg-muted/40"
                    onClick={() => setSelectedId(row.id)}
                    onMouseEnter={() => prefetchThread(row.id)}
                    onFocus={() => prefetchThread(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(row.id);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {!row.is_read ? (
                        <Mail className="size-3.5 shrink-0 text-brand" />
                      ) : (
                        <MailOpen className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className={cn("flex-1 truncate text-body", !row.is_read && "font-medium")}>
                        {row.folder === "SENT" || row.folder === "DRAFTS"
                          ? row.to_addrs[0] ?? row.from_addr
                          : row.from_name || row.from_addr}
                      </span>
                      <span className="text-caption text-muted-foreground">{formatWhen(row.sent_at)}</span>
                    </div>
                    <p className={cn("truncate text-body", !row.is_read && "font-medium")}>{row.subject || t("email_hub.no_subject")}</p>
                    {row.snippet ? (
                      <p className="truncate text-caption text-muted-foreground">{row.snippet}</p>
                    ) : null}
                    {row.has_attachments ? (
                      <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
                        <Paperclip className="size-3" />
                        {t("email_hub.has_attachments")}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {threads.hasNextPage && folder !== "STARRED" ? (
            <div className="p-3">
              <Button
                variant="outline"
                className="w-full"
                disabled={threads.isFetchingNextPage}
                onClick={() => threads.fetchNextPage()}
              >
                {threads.isFetchingNextPage ? t("email_hub.load_more_loading") : t("email_hub.load_more")}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {/* Detail */}
      <section
        className={cn(
          "min-w-0 flex-1 overflow-y-auto p-4 lg:min-h-0",
          readingEmail ? "flex w-full min-h-0 flex-1 flex-col" : "hidden min-h-[240px] lg:block",
        )}
      >
        {!selectedId ? (
          <EmptyPanel message={t("email_hub.empty_detail")} icon={MailOpen} />
        ) : detail.isError && !activeThread ? (
          <EmptyPanel message={t("email_hub.load_error")} />
        ) : !activeThread && detail.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : activeThread && accountId && selectedId ? (
          <EmailHubThreadDetail
            activeThread={activeThread}
            accountId={accountId}
            selectedId={selectedId}
            detailData={detail.data}
            readableBody={readableBody}
            bodyLoading={bodyLoading}
            bodyLoadFailed={bodyLoadFailed}
            isError={detail.isError}
            starPending={toggleStar.isPending}
            movePending={moveThread.isPending}
            downloadPending={downloadAttachment.isPending}
            onBack={() => setSelectedId(null)}
            onToggleStar={() => handleToggleStar(selectedId, activeThread.is_starred)}
            onReply={() => {
              setReplyTo(detail.data ?? activeThread);
              setComposeOpen(true);
            }}
            onArchive={() => {
              moveThread.mutate(
                { accountId, threadId: selectedId, moveTo: "ARCHIVE" },
                { onSuccess: () => setSelectedId(null) },
              );
            }}
            onTrash={() => {
              moveThread.mutate(
                { accountId, threadId: selectedId, moveTo: "TRASH" },
                { onSuccess: () => setSelectedId(null) },
              );
            }}
            onRefetch={() => void detail.refetch()}
            onDownloadAttachment={(att) => {
              downloadAttachment.mutate(
                { accountId, threadId: selectedId, attachmentId: att.id },
                {
                  onSuccess: (blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = att.filename || "attachment";
                    a.click();
                    URL.revokeObjectURL(url);
                  },
                },
              );
            }}
          />
        ) : (
          <EmptyPanel message={t("email_hub.load_error")} />
        )}
      </section>

      <EmailHubStatsRail
        readingEmail={readingEmail}
        counts={counts}
        activeAccount={activeAccount}
        accountList={accountList}
        accountId={accountId}
        onSelectAccount={(id) => {
          setAccountId(id);
          setSelectedId(null);
        }}
        onConnect={() => setConnectOpen(true)}
      />

      <ConnectAccountDialog
        wsId={wsId}
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={(id) => {
          setAccountId(id);
          setSelectedId(null);
          setFolder("INBOX");
        }}
      />
      <ComposeEmailDialog
        wsId={wsId}
        accountId={accountId}
        open={composeOpen}
        onOpenChange={setComposeOpen}
        replyTo={replyTo}
        onSent={(thread) => {
          setFolder("SENT");
          setSelectedId(thread.id);
        }}
      />
    </div>
  );
}
