"use client";
import { Plus } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import type { Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";

/** Chọn workspace, nhóm theo tổ chức. 0 workspace → đẩy sang tạo mới. */
export function WorkspacePickerView({ onPick, onCreate }: { onPick: (w: Workspace) => void; onCreate: () => void }) {
  const { t } = useTranslation();
  const { data: workspaces, isFetched } = useWorkspaces();
  const host = appHost();
  useEffect(() => {
    if (isFetched && workspaces && workspaces.length === 0) onCreate();
  }, [isFetched, workspaces, onCreate]);
  if (!workspaces?.length) return null;

  const groups = new Map<string, { name: string; slug: string; items: Workspace[] }>();
  for (const w of workspaces) {
    const g = groups.get(w.organization_id) ?? { name: w.organization_name, slug: w.organization_slug, items: [] };
    g.items.push(w);
    groups.set(w.organization_id, g);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-6 sm:p-8">
      <h1 className="text-title-lg font-semibold text-foreground">{t("workspace.pickTitle")}</h1>
      {[...groups.entries()].map(([orgId, g]) => (
        <section key={orgId} className="flex flex-col gap-3">
          {/* flex-wrap: tên tổ chức do người dùng đặt, dài bao nhiêu cũng được;
              không cho xuống dòng thì slug đẩy tiêu đề ra ngoài màn hình hẹp. */}
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-label font-medium text-muted-foreground">
            {g.name}
            <span className="font-mono text-caption text-muted-foreground">/{g.slug}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* `min-w-0` trên nút: đây là một grid item, mà grid item mặc định
                `min-width: auto` — nó từ chối co xuống dưới bề rộng nội dung.
                Đường dẫn workspace là một chuỗi `nowrap` dài, nên nếu không mở
                khoá chỗ này thì `truncate` bên trong không bao giờ có tác dụng
                và cả hàng đẩy trang tràn ngang ở 375px. */}
            {g.items.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onPick(w)}
                className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-input hover:bg-muted/60"
              >
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-body font-semibold text-primary-foreground">
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-body font-medium text-foreground">{w.name}</span>
                  <span className="block truncate font-mono text-caption text-muted-foreground">
                    {host}/{g.slug}/{w.slug}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <div>
        <Button variant="outline" size="lg" onClick={onCreate}>
          <Plus className="size-4" />
          {t("workspace.new")}
        </Button>
      </div>
    </div>
  );
}
