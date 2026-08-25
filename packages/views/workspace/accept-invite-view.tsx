"use client";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import type { Workspace } from "@uniwork/core/types";
import { useAcceptInvite } from "@uniwork/core/workspaces";

export function AcceptInviteView({
  token,
  onAccepted,
  onAnon,
}: {
  token: string;
  onAccepted: (ws: Workspace) => void;
  onAnon: () => void;
}) {
  const { t } = useTranslation();
  const { status } = useSession();
  const accept = useAcceptInvite();
  const fired = useRef(false);

  useEffect(() => {
    if (status === "anon") onAnon();
    if (status === "authed" && !fired.current) {
      fired.current = true;
      accept.mutate(token, { onSuccess: (d) => onAccepted(d.workspace) });
    }
  }, [status, token, accept, onAccepted, onAnon]);

  return (
    <p className="p-8 text-text-secondary">{accept.error ? t("common.error") : t("common.loading")}</p>
  );
}
