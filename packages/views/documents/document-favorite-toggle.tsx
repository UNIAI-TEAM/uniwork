"use client";

import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useDocumentFavorites,
  useFavoriteDocument,
  useUnfavoriteDocument,
} from "@uniwork/core/documents/hooks-favorites";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";

/**
 * Star toggle for the document detail header (G1-07c).
 *
 * The server keeps no per-document favorite flag: the org-scoped favorites
 * list is the only record, so the control's state is derived from that list
 * and the icon flips only after the list is re-read (the mutation invalidates
 * it). Until the list has loaded the button stays disabled rather than
 * guessing "not favorited" — a wrong star that flips on its own would be a
 * lie about what the server holds.
 */
export function DocumentFavoriteToggle({
  documentId,
  orgId,
  className,
}: {
  documentId: string;
  orgId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const favorites = useDocumentFavorites(orgId, { enabled: !!orgId });
  const favorite = useFavoriteDocument();
  const unfavorite = useUnfavoriteDocument();

  const known = favorites.isSuccess;
  const favorited = !!favorites.data?.some((f) => f.document_id === documentId);
  const pending = favorite.isPending || unfavorite.isPending;
  const disabled = !orgId || !known || pending;

  const toggle = () => {
    if (disabled) return;
    const fail = { onError: (err: unknown) => toastApiError(err, t("documents.comments.favorite_failed")) };
    if (favorited) unfavorite.mutate(documentId, fail);
    else favorite.mutate(documentId, fail);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      disabled={disabled}
      aria-pressed={favorited}
      aria-busy={pending || undefined}
      aria-label={favorited ? t("documents.comments.favorite_remove") : t("documents.comments.favorite_add")}
      onClick={toggle}
    >
      <Star className={cn("size-4", favorited && "fill-current text-brand")} aria-hidden />
    </Button>
  );
}
