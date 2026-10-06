"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@uniwork/ui/components/ui/pagination";
import { PAGE_GUTTER } from "../layout/page-header";

export const PROJECTS_PAGE_SIZE = 20;

export function ProjectsListPagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (pageCount <= 1) return null;

  const previousDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  return (
    <Pagination
      aria-label={t("projects.page.pagination_label")}
      className={`shrink-0 border-t border-border py-2 ${PAGE_GUTTER}`}
    >
      <PaginationContent>
        <PaginationItem>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={t("ui.pagination_previous")}
            aria-disabled={previousDisabled}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
        </PaginationItem>
        <PaginationItem>
          <span
            aria-live="polite"
            className="min-w-20 px-2 text-center text-caption tabular-nums text-muted-foreground"
          >
            {t("projects.page.pagination_status", { page, pageCount })}
          </span>
        </PaginationItem>
        <PaginationItem>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={t("ui.pagination_next")}
            aria-disabled={nextDisabled}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
