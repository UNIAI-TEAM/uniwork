"use client";
import { useCallback, useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination, usePendingAuthStep } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { useNavigation } from "@uniwork/views/navigation";
import { InvitationsView } from "@uniwork/views/workspace/invitations-view";

export default function InvitationsPage() {
  const { replace } = useNavigation();
  const { status, user } = useSession();
  const step = usePendingAuthStep();
  // Danh sách thật, không phải `[]`: hết lời mời không có nghĩa là hết workspace.
  // Truyền mảng rỗng cứng vào resolver khiến mọi người đi qua đây bị đẩy sang
  // "tạo workspace mới" kể cả khi họ đã có workspace — gặp ngay khi lời mời vừa
  // bị thu hồi, hoặc khi mở thẳng /invitations từ bookmark.
  const { data: workspaces = [] } = useWorkspaces();
  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (status === "authed" && step === "verify") replace(paths.verify());
  }, [status, step, replace]);
  const onEmpty = useCallback(
    () => replace(resolvePostAuthDestination(workspaces, user)),
    [replace, workspaces, user],
  );
  if (status !== "authed" || step === "verify") return null;
  return (
    <InvitationsView
      onJoined={(ws) =>
        replace(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.workspaces())
      }
      onEmpty={onEmpty}
    />
  );
}
