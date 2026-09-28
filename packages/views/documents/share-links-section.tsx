"use client";

import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import {
  useCreateDocumentLink,
  useDocumentShares,
  useRevokeDocumentLink,
} from "@uniwork/core/documents/hooks-sharing";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { formatWhen } from "./document-format";

export interface ShareLinksSectionProps {
  wsId: string;
  doc: Document;
  /** Where an admin turns the organization switch on. */
  onOpenSettings: () => void;
  /** Active locale, for the created/expiry times. */
  locale: string;
}

/**
 * The public-links half of the share dialog (C-01 §5.3; G1-08, UNI-682).
 *
 * A minted link's raw URL exists here once and only once: the list below
 * holds metadata (created, expiry, views) and never reconstructs a token. The
 * server's refusals are named individually — the live-link limit, the
 * organization switch, the plan entitlement — so the reader knows which
 * action is theirs. Revoking is immediate; losing the URL means creating
 * another link.
 */
export function ShareLinksSection({ wsId, doc, onOpenSettings, locale }: ShareLinksSectionProps) {
  const { t } = useTranslation();
  const [expiry, setExpiry] = useState("7");
  const [created, setCreated] = useState<{ url: string } | null>(null);
  const [createError, setCreateError] = useState<{ text: string; settings?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const access = useDocumentShares(wsId, doc.id);
  const createLink = useCreateDocumentLink(wsId, doc.id);
  const revokeLink = useRevokeDocumentLink(wsId, doc.id);
  const links = access.data?.links ?? [];
  const now = Date.now();

  const submitCreate = async () => {
    if (createLink.isPending) return;
    setCreateError(null);
    setCopied(false);
    const days = Number.parseInt(expiry, 10);
    try {
      const envelope = await createLink.mutateAsync(
        Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : undefined,
      );
      // The server may answer a path (`/share/{token}`); the one-time URL the
      // user copies must work outside the app, so resolve it on the app origin.
      setCreated({ url: new URL(envelope.url, runtimeConfig().appUrl).toString() });
    } catch (err) {
      const cls = classifyDocumentError(err);
      if (cls.code === "document_link_limit") {
        setCreateError({ text: t("documents.share.link_limit") });
      } else if (cls.code === "document_links_disabled") {
        setCreateError({ text: t("documents.share.links_off"), settings: true });
      } else if (cls.cls === "permission") {
        setCreateError({ text: t("documents.share.link_entitlement") });
      } else {
        setCreateError({ text: apiErrorMessage(err) ?? t("documents.share.link_create_failed") });
      }
    }
  };

  const copy = () => {
    if (!created) return;
    void navigator.clipboard?.writeText(created.url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section aria-labelledby="share-links-title" className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="share-links-title" className="text-label font-medium text-foreground">
          {t("documents.share.links_title")}
        </h3>
        <span className="text-caption text-muted-foreground">{t("documents.share.links_description")}</span>
      </div>

      {created ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-label font-medium text-foreground">{t("documents.share.link_created_title")}</p>
          <p className="break-all font-mono text-caption text-foreground" data-testid="share-created-url">
            {created.url}
          </p>
          <p className="text-caption text-muted-foreground">{t("documents.share.link_url_once")}</p>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
              {copied ? t("documents.share.link_copied") : t("documents.share.link_copy")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor="share-link-expiry">{t("documents.share.link_expiry_label")}</Label>
          <Input
            id="share-link-expiry"
            type="number"
            min={1}
            max={90}
            value={expiry}
            disabled={createLink.isPending}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={createLink.isPending}
          aria-busy={createLink.isPending || undefined}
          onClick={() => void submitCreate()}
        >
          {createLink.isPending ? (
            <>
              <Spinner aria-hidden role="presentation" />
              {t("documents.share.submitting")}
            </>
          ) : (
            <>
              <Link2 aria-hidden className="size-3.5" />
              {t("documents.share.link_create")}
            </>
          )}
        </Button>
        <p className="w-full text-caption text-muted-foreground sm:w-auto">
          {t("documents.share.link_lost_hint")}
        </p>
      </div>

      {createError ? (
        <p role="alert" className="flex items-center gap-2 text-caption text-destructive">
          {createError.text}
          {createError.settings ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenSettings}>
              {t("documents.share.links_off_action")}
            </Button>
          ) : null}
        </p>
      ) : null}

      {access.isError ? (
        <p role="alert" className="text-caption text-destructive">
          {t("documents.share.error")}
        </p>
      ) : links.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("documents.share.links_empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {links.map((link) => {
            const expiresAt = link.expires_at ? new Date(link.expires_at) : null;
            const expired = expiresAt !== null && expiresAt.getTime() <= now;
            return (
              <li key={link.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 text-body text-foreground">
                    <Link2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    {formatWhen(link.created_at, locale)}
                    {expired ? (
                      <span className="text-caption text-muted-foreground">
                        {t("documents.share.link_expired_badge")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {expiresAt
                      ? t("documents.share.link_expires_at", { time: formatWhen(link.expires_at, locale) })
                      : t("documents.share.link_no_expiry")}
                    {` · ${t("documents.share.link_views", { count: link.view_count })}`}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`${t("documents.share.link_revoke")} ${formatWhen(link.created_at, locale)}`}
                  disabled={revokeLink.isPending}
                  aria-busy={(revokeLink.isPending && revokeLink.variables === link.id) || undefined}
                  onClick={() => revokeLink.mutate(link.id)}
                >
                  {revokeLink.isPending && revokeLink.variables === link.id ? (
                    <Spinner aria-hidden role="presentation" />
                  ) : null}
                  {t("documents.share.link_revoke")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
