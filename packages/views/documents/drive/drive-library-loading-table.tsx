"use client";

import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";

export function DriveLibraryLoadingTable() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="overflow-hidden rounded-lg border border-border bg-background"
      aria-busy="true"
      aria-label={t("documents.library.loading")}
    >
      <table className="w-full table-fixed border-collapse text-body md:table-auto md:min-w-[44rem]">
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            <th scope="col" className="w-full px-4 py-3 font-medium">
              {t("driveLibrary.list.columns.name")}
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
              {t("driveLibrary.list.columns.account")}
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
              {t("driveLibrary.list.columns.access")}
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
              {t("driveLibrary.list.columns.used_in")}
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
              {t("driveLibrary.list.columns.tasks_created")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, index) => (
            <tr key={index}>
              <td className="w-full max-w-0 px-4 py-3">
                <Skeleton className="h-5 w-48 max-w-full rounded-md" />
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <Skeleton className="h-4 w-36 rounded-md" />
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <Skeleton className="h-5 w-24 rounded-md" />
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <Skeleton className="h-4 w-28 rounded-md" />
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <Skeleton className="h-4 w-16 rounded-md" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
