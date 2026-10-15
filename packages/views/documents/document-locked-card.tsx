"use client";

// Shared with DOC-05 (b): when it lands, keep one component (merge step)

import { useEffect, useId, useState } from "react";
import { CircleX, LockKeyhole, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  accessRequestOutcome,
  readDocumentAccessRequestSent,
  useRequestDocumentAccess,
  type AccessRequestOutcome,
} from "@uniwork/core/documents/hooks-access-requests";
import type { CreateDocumentAccessRequestBody } from "@uniwork/core/api/endpoints/documents-access-requests";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { useAdminManageAccess } from "./admin-manage-access";

/** Where the link that opened the document lives (access addendum §3.1; meeting deferred, Q5). */
export interface DocumentAccessRequestSource {
  kind: "task" | "meeting";
  id: string;
}

interface CommonProps {
  wsId: string;
  documentId: string;
  /** "Back": the host's way out (the library). */
  onBack: () => void;
  className?: string;
}

export type DocumentLockedCardProps =
  | (CommonProps & {
      variant: "member";
      /** Read once from `?from=task:<id>` by the host; sent with the request. */
      source: DocumentAccessRequestSource | null;
      /** "Try opening again": refetch the document (F-07). */
      onRetryOpen: () => void;
      /** The refetch is running. */
      retrying?: boolean;
    })
  | (CommonProps & { variant: "admin" });

const MESSAGE_MAX = 500;
type Level = "view" | "edit";
const LEVELS: readonly Level[] = ["view", "edit"];
// Send-side states of the member card; `sent`/`already_pending` replace the form.
type CardState = AccessRequestOutcome["state"] | "idle";

const SHELL = "mx-auto flex w-full max-w-xl flex-col gap-5 px-6 py-12 md:py-16";

/**
 * The screen a signed-in person sees instead of a document they cannot open.
 * `member` (DOC-07): a 404 — missing, unshared or another organization's,
 * deliberately indistinguishable — with a way to ask the managers for access.
 * `admin` (DOC-05): a 403 document_restricted, where an admin manages access
 * but never reads the content. Neither variant shows anything of the document.
 */
export function DocumentLockedCard(props: DocumentLockedCardProps) {
  return props.variant === "admin" ? <AdminLockedCard {...props} /> : <MemberLockedCard {...props} />;
}

function AdminLockedCard({ wsId, documentId, onBack, className }: CommonProps) {
  const { t } = useTranslation();
  const manage = useAdminManageAccess(wsId, documentId);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn(SHELL, "items-center text-center", className)} data-document-locked-card="admin">
      <IconTile icon={CircleX} size="lg" tone="destructive" />
      <div className="space-y-1.5">
        <h2 id={headingId} className="text-title font-semibold">{t("documents.detail.revoked_title")}</h2>
        <p className="text-body text-muted-foreground">{t("documents.detail.revoked_description")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {manage.available ? (
          <Button type="button" size="sm" onClick={manage.open}>
            {t("documents.share.admin_manage_button")}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t("documents.detail.back_to_library")}
        </Button>
      </div>
      {manage.dialog}
    </section>
  );
}

function MemberLockedCard({
  wsId,
  documentId,
  source,
  onRetryOpen,
  retrying = false,
  onBack,
  className,
}: CommonProps & { source: DocumentAccessRequestSource | null; onRetryOpen: () => void; retrying?: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "documents.access_request" });
  const { t: tRoot } = useTranslation();
  const headingId = useId();
  const fieldId = useId();
  const counterId = `${fieldId}-counter`;
  const errorId = `${fieldId}-error`;
  const send = useRequestDocumentAccess(wsId, documentId);
  const [level, setLevel] = useState<Level>("view");
  const [message, setMessage] = useState("");
  // The device flag only decides the first paint; the server's 409 restores it.
  const [state, setState] = useState<CardState>(() =>
    readDocumentAccessRequestSent(documentId) ? "already_pending" : "idle",
  );
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Count the cooldown down; the form comes back by itself when it ends.
  useEffect(() => {
    if (state !== "cooldown") return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= cooldownUntil) setState("idle");
    }, 1000);
    return () => clearInterval(timer);
  }, [state, cooldownUntil]);

  const trimmed = message.trim();
  const tooLong = trimmed.length > MESSAGE_MAX;
  const sending = send.isPending;
  const blocked = sending || tooLong || state === "cooldown";
  const done = state === "sent" || state === "already_pending";

  const submit = () => {
    if (blocked) return;
    const body: CreateDocumentAccessRequestBody = { requested_level: level };
    if (trimmed) body.message = trimmed;
    if (source) {
      body.source_kind = source.kind;
      body.source_id = source.id;
    }
    setState("idle");
    send.mutate(body, {
      onSuccess: (outcome) => setState(outcome.state),
      onError: (err) => {
        const outcome = accessRequestOutcome(err);
        if (outcome.state === "cooldown") {
          const at = Date.now();
          setNow(at);
          setCooldownUntil(at + outcome.retryAfterSeconds * 1000);
        }
        setState(outcome.state);
      },
    });
  };

  const minutesLeft = Math.max(1, Math.ceil(Math.max(0, cooldownUntil - now) / 60_000));
  const feedback =
    state === "cooldown"
      ? t("cooldown", { minutes: minutesLeft })
      : state === "rate_limited"
        ? t("rate_limited")
        : state === "send_failed"
          ? t("send_failed")
          : null;
  const levelLabel = (l: string) => tRoot(`documents.share.level_${l === "edit" ? "edit" : "view"}`);

  return (
    <section aria-labelledby={headingId} className={cn(SHELL, className)} data-document-locked-card="member">
      <div className="flex flex-col items-center gap-3 text-center">
        <IconTile icon={LockKeyhole} size="lg" tone="muted" />
        <h2 id={headingId} className="text-title font-semibold">{t("locked_title")}</h2>
        <p className="text-body text-muted-foreground">{t("locked_body")}</p>
      </div>

      {done ? (
        <div role="status" className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-body">
          <p className="font-medium">{t(state === "sent" ? "sent" : "already_pending")}</p>
          {state === "sent" ? (
            <dl className="space-y-1 text-muted-foreground">
              <div className="flex gap-2">
                <dt>{t("level_label")}:</dt>
                <dd>{levelLabel(level)}</dd>
              </div>
              {trimmed ? (
                <div className="flex gap-2">
                  <dt>{t("message_label")}:</dt>
                  <dd className="min-w-0 break-words">{trimmed}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body font-medium">{t("level_label")}</legend>
            <RadioGroup
              value={level}
              onValueChange={(v) => {
                if (LEVELS.includes(v as Level)) setLevel(v as Level);
              }}
              className="flex flex-wrap gap-x-6 gap-y-1"
            >
              {LEVELS.map((l) => (
                <label key={l} className="flex cursor-pointer items-center gap-2 text-body pointer-coarse:min-h-11">
                  <RadioGroupItem value={l} />
                  {levelLabel(l)}
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="text-body font-medium">{t("message_label")}</label>
            <Textarea
              id={fieldId}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("message_placeholder")}
              rows={3}
              aria-invalid={tooLong || undefined}
              aria-describedby={tooLong ? `${counterId} ${errorId}` : counterId}
            />
            <div className="flex items-start justify-between gap-3 text-caption">
              <p id={errorId} className="text-destructive">{tooLong ? t("message_too_long") : null}</p>
              <p id={counterId} className={cn("shrink-0 tabular-nums", tooLong ? "text-destructive" : "text-muted-foreground")}>
                {t("message_counter", { count: trimmed.length })}
              </p>
            </div>
          </div>
          {feedback ? (
            <p role="alert" className={cn("text-body", state === "cooldown" ? "text-muted-foreground" : "text-destructive")}>
              {feedback}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" aria-disabled={blocked || undefined}>
              {sending ? <Spinner /> : null}
              {sending ? t("sending") : t("send")}
            </Button>
            <RetryAndBack retrying={retrying} onRetryOpen={onRetryOpen} onBack={onBack} />
          </div>
        </form>
      )}
      {done ? (
        <div className="flex flex-wrap gap-2">
          <RetryAndBack retrying={retrying} onRetryOpen={onRetryOpen} onBack={onBack} />
        </div>
      ) : null}
    </section>
  );
}

function RetryAndBack({ retrying, onRetryOpen, onBack }: { retrying: boolean; onRetryOpen: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-disabled={retrying || undefined}
        onClick={() => {
          if (!retrying) onRetryOpen();
        }}
      >
        {retrying ? <Spinner /> : <RefreshCw aria-hidden className="size-3.5" />}
        {t("documents.access_request.retry_open")}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        {t("documents.detail.back_to_library")}
      </Button>
    </>
  );
}
