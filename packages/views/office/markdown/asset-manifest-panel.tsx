"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { assetManifestRows, type AssetManifestLike, type AssetStatus } from "../asset-manifest";

function statusLabel(status: AssetStatus, t: (key: string) => string): string {
  if (status === "ready") return t("asset.ready");
  if (status === "missing") return t("asset.missing");
  if (status === "unauthorised") return t("asset.unauthorised");
  return t("asset.failed");
}

/** The Markdown document's image/asset list: every manifest row plus the
 * uploads that failed in this session, each with its id or a status label. */
export function AssetManifestPanel({ manifest, failures }: { manifest: AssetManifestLike; failures?: Readonly<Record<string, AssetStatus | boolean>> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown" });
  const rows = assetManifestRows(manifest);
  const extra = Object.entries(failures ?? {}).map(([path, status]) => ({
    path,
    assetId: null,
    status: status === true || status === false ? "failed" as const : status,
    reason: null,
  }));
  if (rows.length === 0 && extra.length === 0) {
    return <p className="p-3 text-caption text-muted-foreground" data-testid="asset-manifest-empty">{t("asset.empty")}</p>;
  }
  return (
    <ul className="divide-y divide-border" data-testid="asset-manifest">
      {[...rows, ...extra].map((row, index) => (
        <li className="flex min-w-0 items-center justify-between gap-2 px-3 py-2 text-caption" key={`${row.path}-${index}`}>
          <span className="min-w-0 truncate font-mono" title={row.path}>{row.path}</span>
          <span className={cn("shrink-0", row.status === "ready" ? "text-muted-foreground" : "text-destructive")}>
            {row.assetId ?? statusLabel(row.status, t)}
          </span>
        </li>
      ))}
    </ul>
  );
}
