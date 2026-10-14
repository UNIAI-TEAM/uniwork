"use client";
import { useCallback, useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { useOrganizations } from "@uniwork/core/organizations";
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
  // With no organization left the answer is /get-started, not "create a
  // workspace" (ADR 0032), so the list is read before the page can redirect.
  const { data: organizations, isFetched: orgsFetched } = useOrganizations(status === "authed");
  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (status === "authed" && step === "verify") replace(paths.verify());
  }, [status, step, replace]);
  const onEmpty = useCallback(
    () => replace(resolvePostAuthDestination(workspaces, user, organizations)),
    [replace, workspaces, user, organizations],
  );
  if (status !== "authed" || step === "verify" || !orgsFetched) return null;
  // "Để sau" goes where an empty list would: onboarding, a workspace, or
  // /get-started.
  return <InvitationsView onEmpty={onEmpty} onSkip={onEmpty} />;
}
